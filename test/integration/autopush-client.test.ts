import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { registerNew, connect, unregister } from '../../src/core/autopush/handshake.js';
import { nodeWsTransportFactory } from '../../src/node/ws-transport.js';
import { NoopLogger } from '../../src/core/logger.js';
import { BackoffError } from '../../src/core/errors.js';

describe('AutoPush handshake and client integration', () => {
  let server: ReturnType<typeof createServer>;
  let wss: WebSocketServer;
  let serverUrl: string;

  beforeEach(async () => {
    server = createServer();
    wss = new WebSocketServer({ server });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as AddressInfo;
        serverUrl = `ws://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  afterEach(async () => {
    for (const client of wss.clients) {
      client.terminate();
    }
    await new Promise<void>((resolve) => wss.close(() => resolve()));
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('should successfully perform registerNew flow', async () => {
    const receivedMessages: unknown[] = [];

    wss.on('connection', (ws: WebSocket) => {
      ws.on('message', (data: Buffer) => {
        const msg = JSON.parse(data.toString('utf-8'));
        receivedMessages.push(msg);

        if (msg.messageType === 'hello') {
          ws.send(JSON.stringify({ messageType: 'hello', status: 200, uaid: 'mock-uaid-1' }));
        } else if (msg.messageType === 'register') {
          ws.send(
            JSON.stringify({
              messageType: 'register',
              status: 200,
              pushEndpoint: 'https://push.example.com/mock-sub',
              channelID: msg.channelID,
            })
          );
        }
      });
    });

    const reg = await registerNew({
      transportFactory: nodeWsTransportFactory,
      logger: new NoopLogger(),
      url: serverUrl,
    });

    expect(reg.uaid).toBe('mock-uaid-1');
    expect(reg.endpoint).toBe('https://push.example.com/mock-sub');
    expect(reg.channelId).toBeDefined();

    // Verify messages sent by client
    expect(receivedMessages.length).toBe(2);
    expect(receivedMessages[0]).toMatchObject({
      messageType: 'hello',
      uaid: '',
      use_webpush: true,
      broadcasts: {},
    });
    expect(receivedMessages[1]).toMatchObject({
      messageType: 'register',
      channelID: reg.channelId,
    });
  });

  it('should receive notification, deduplicate, ignore unknown messages, and send ack', async () => {
    let serverWs: WebSocket | null = null;
    const acksReceived: unknown[] = [];

    wss.on('connection', (ws: WebSocket) => {
      serverWs = ws;
      ws.on('message', (data: Buffer) => {
        const msg = JSON.parse(data.toString('utf-8'));
        if (msg.messageType === 'hello') {
          ws.send(JSON.stringify({ messageType: 'hello', status: 200, uaid: 'existing-uaid' }));
        } else if (msg.messageType === 'ack') {
          acksReceived.push(msg);
        }
      });
    });

    const conn = await connect(
      { uaid: 'existing-uaid', channelId: 'ch-1' },
      {
        transportFactory: nodeWsTransportFactory,
        logger: new NoopLogger(),
        url: serverUrl,
        timers: { appPingMs: 60_000, pongTimeoutMs: 5_000, wsPingMs: 30_000 },
      }
    );

    expect(conn.kind).toBe('connected');
    if (conn.kind !== 'connected') return;

    const client = conn.client;

    // Send unknown message first (Q2 parity: should not disconnect)
    serverWs!.send(JSON.stringify({ messageType: 'broadcast', data: 'something' }));

    // Send valid notification
    serverWs!.send(
      JSON.stringify({
        messageType: 'notification',
        channelID: 'ch-1',
        version: 'ver-100',
        data: 'mockData',
      })
    );

    const notification = await client.nextNotification();
    expect(notification).not.toBeNull();
    expect(notification?.channelId).toBe('ch-1');
    expect(notification?.version).toBe('ver-100');
    expect(notification?.data).toBe('mockData');

    const waitForAcks = async (count: number, timeoutMs = 2000) => {
      const start = Date.now();
      while (acksReceived.length < count) {
        if (Date.now() - start > timeoutMs) {
          throw new Error(`timed out waiting for ${count} acks, got ${acksReceived.length}`);
        }
        await new Promise((r) => setTimeout(r, 10));
      }
    };

    // Send ACK from client
    await client.ack('ch-1', 'ver-100', 100);
    await waitForAcks(1);
    expect(acksReceived.length).toBe(1);
    expect(acksReceived[0]).toMatchObject({
      messageType: 'ack',
      updates: [{ channelID: 'ch-1', version: 'ver-100', code: 100 }],
    });

    // Send DUPLICATE notification from server
    serverWs!.send(
      JSON.stringify({
        messageType: 'notification',
        channelID: 'ch-1',
        version: 'ver-100',
        data: 'mockData',
      })
    );

    // Send a second, new notification
    serverWs!.send(
      JSON.stringify({
        messageType: 'notification',
        channelID: 'ch-1',
        version: 'ver-200',
        data: 'mockData2',
      })
    );

    // nextNotification should skip ver-100 and yield ver-200
    const nextNotif = await client.nextNotification();
    expect(nextNotif?.version).toBe('ver-200');

    // Duplicate should have triggered an automatic ACK (code 100)
    await waitForAcks(2);
    expect(acksReceived.length).toBe(2);
    expect(acksReceived[1]).toMatchObject({
      messageType: 'ack',
      updates: [{ channelID: 'ch-1', version: 'ver-100', code: 100 }],
    });

    await client.close();
  });

  it('should throw BackoffError on close code 4774', async () => {
    wss.on('connection', (ws: WebSocket) => {
      ws.on('message', (data: Buffer) => {
        const msg = JSON.parse(data.toString('utf-8'));
        if (msg.messageType === 'hello') {
          ws.send(JSON.stringify({ messageType: 'hello', status: 200, uaid: 'uaid-backoff' }));
          setTimeout(() => {
            ws.close(4774, 'server requested backoff');
          }, 20);
        }
      });
    });

    const conn = await connect(
      { uaid: 'uaid-backoff', channelId: 'ch-1' },
      {
        transportFactory: nodeWsTransportFactory,
        logger: new NoopLogger(),
        url: serverUrl,
      }
    );

    if (conn.kind === 'connected') {
      await expect(conn.client.nextNotification()).rejects.toThrow(BackoffError);
    }
  });

  it('should detect UAID invalidation and trigger re-registration', async () => {
    let helloCount = 0;

    wss.on('connection', (ws: WebSocket) => {
      ws.on('message', (data: Buffer) => {
        const msg = JSON.parse(data.toString('utf-8'));
        if (msg.messageType === 'hello') {
          helloCount++;
          // First connect uses old UAID 'old-uaid', return a new UAID 'new-uaid'
          // Second connect during registerNew uses empty UAID, return 'new-uaid'
          ws.send(JSON.stringify({ messageType: 'hello', status: 200, uaid: 'new-uaid' }));
        } else if (msg.messageType === 'register') {
          ws.send(
            JSON.stringify({
              messageType: 'register',
              status: 200,
              pushEndpoint: 'https://push.example.com/new-sub',
              channelID: msg.channelID,
            })
          );
        }
      });
    });

    const conn = await connect(
      { uaid: 'old-uaid', channelId: 'ch-1' },
      {
        transportFactory: nodeWsTransportFactory,
        logger: new NoopLogger(),
        url: serverUrl,
      }
    );

    expect(conn.kind).toBe('needs_reregistration');
    if (conn.kind === 'needs_reregistration') {
      expect(conn.registration.uaid).toBe('new-uaid');
      expect(conn.registration.endpoint).toBe('https://push.example.com/new-sub');
      expect(conn.keys.publicKey.length).toBe(65);
    }
    expect(helloCount).toBe(2);
  });

  it('should successfully unregister channel', async () => {
    const receivedMessages: unknown[] = [];

    wss.on('connection', (ws: WebSocket) => {
      ws.on('message', (data: Buffer) => {
        const msg = JSON.parse(data.toString('utf-8'));
        receivedMessages.push(msg);
        if (msg.messageType === 'hello') {
          ws.send(JSON.stringify({ messageType: 'hello', status: 200, uaid: 'uaid-unreg' }));
        }
      });
    });

    await unregister(
      { uaid: 'uaid-unreg', channelId: 'ch-unreg' },
      {
        transportFactory: nodeWsTransportFactory,
        logger: new NoopLogger(),
        url: serverUrl,
      }
    );

    expect(receivedMessages.length).toBe(2);
    expect(receivedMessages[0]).toMatchObject({ messageType: 'hello', uaid: 'uaid-unreg' });
    expect(receivedMessages[1]).toMatchObject({
      messageType: 'unregister',
      channelID: 'ch-unreg',
      code: 200,
    });
  });
});
