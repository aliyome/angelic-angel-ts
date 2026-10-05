import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import * as nodeCrypto from 'node:crypto';
import { createRequire } from 'node:module';
import { handleNotification } from '../../src/core/notification.js';
import { generateKeys } from '../../src/core/keys.js';
import { toBase64Url } from '../../src/core/bytes.js';
import { NoopLogger } from '../../src/core/logger.js';
import { AckCode } from '../../src/core/autopush/protocol.js';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const httpEce = require('http_ece') as any;

describe('notification handling & webhook forwarding', () => {
  let webhookServer: ReturnType<typeof createServer>;
  let webhookUrl: string;
  let receivedPayloads: unknown[] = [];
  let webhookResponseStatus = 200;

  beforeEach(async () => {
    receivedPayloads = [];
    webhookResponseStatus = 200;

    webhookServer = createServer((req, res) => {
      let data = '';
      req.on('data', (chunk) => {
        data += chunk;
      });
      req.on('end', () => {
        try {
          receivedPayloads.push(JSON.parse(data));
        } catch {
          receivedPayloads.push(data);
        }
        res.writeHead(webhookResponseStatus, { 'Content-Type': 'application/json' });
        res.end('{}');
      });
    });

    await new Promise<void>((resolve) => {
      webhookServer.listen(0, '127.0.0.1', () => {
        const addr = webhookServer.address() as AddressInfo;
        webhookUrl = `http://127.0.0.1:${addr.port}/webhook`;
        resolve();
      });
    });
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => webhookServer.close(() => resolve()));
  });

  it('should return AckCode.Delivered for empty notification without sending to webhook', async () => {
    const keys = await generateKeys();
    const ack = await handleNotification(
      { channelId: 'ch-1', version: 'v1' },
      keys,
      {
        logger: new NoopLogger(),
        getWebhookEndpoint: () => webhookUrl,
      }
    );

    expect(ack).toBe(AckCode.Delivered);
    expect(receivedPayloads.length).toBe(0);
  });

  it('should decrypt valid notification and POST JSON to webhook (AckCode.Delivered)', async () => {
    const keys = await generateKeys();
    const payload = { event: 'tweet', user: 'hero', text: 'Hello!' };

    const sender = nodeCrypto.createECDH('prime256v1');
    sender.generateKeys();
    const salt = nodeCrypto.randomBytes(16);

    const encrypted = httpEce.encrypt(Buffer.from(JSON.stringify(payload), 'utf-8'), {
      version: 'aes128gcm',
      privateKey: sender,
      dh: Buffer.from(keys.publicKey),
      salt,
      authSecret: Buffer.from(keys.authSecret),
    });

    const ack = await handleNotification(
      {
        channelId: 'ch-1',
        version: 'v1',
        data: toBase64Url(new Uint8Array(encrypted)),
        headers: { encoding: 'aes128gcm' },
      },
      keys,
      {
        logger: new NoopLogger(),
        getWebhookEndpoint: () => webhookUrl,
      }
    );

    expect(ack).toBe(AckCode.Delivered);
    expect(receivedPayloads.length).toBe(1);
    expect(receivedPayloads[0]).toEqual(payload);
  });

  it('should return AckCode.DecryptionError on corrupt ciphertext', async () => {
    const keys = await generateKeys();
    const ack = await handleNotification(
      {
        channelId: 'ch-1',
        version: 'v1',
        data: 'aW52YWxpZC1kYXRh', // invalid ciphertext
        headers: { encoding: 'aes128gcm' },
      },
      keys,
      {
        logger: new NoopLogger(),
        getWebhookEndpoint: () => webhookUrl,
      }
    );

    expect(ack).toBe(AckCode.DecryptionError);
    expect(receivedPayloads.length).toBe(0);
  });

  it('should return AckCode.NotDelivered if WEBHOOK_ENDPOINT is not configured', async () => {
    const keys = await generateKeys();
    const payload = { test: true };

    const sender = nodeCrypto.createECDH('prime256v1');
    sender.generateKeys();
    const salt = nodeCrypto.randomBytes(16);

    const encrypted = httpEce.encrypt(Buffer.from(JSON.stringify(payload), 'utf-8'), {
      version: 'aes128gcm',
      privateKey: sender,
      dh: Buffer.from(keys.publicKey),
      salt,
      authSecret: Buffer.from(keys.authSecret),
    });

    const ack = await handleNotification(
      {
        channelId: 'ch-1',
        version: 'v1',
        data: toBase64Url(new Uint8Array(encrypted)),
        headers: { encoding: 'aes128gcm' },
      },
      keys,
      {
        logger: new NoopLogger(),
        getWebhookEndpoint: () => undefined, // not set
      }
    );

    expect(ack).toBe(AckCode.NotDelivered);
  });

  it('should return AckCode.Delivered even if webhook returns non-2xx (Rust parity)', async () => {
    webhookResponseStatus = 500;
    const keys = await generateKeys();
    const payload = { test: '500' };

    const sender = nodeCrypto.createECDH('prime256v1');
    sender.generateKeys();
    const salt = nodeCrypto.randomBytes(16);

    const encrypted = httpEce.encrypt(Buffer.from(JSON.stringify(payload), 'utf-8'), {
      version: 'aes128gcm',
      privateKey: sender,
      dh: Buffer.from(keys.publicKey),
      salt,
      authSecret: Buffer.from(keys.authSecret),
    });

    const ack = await handleNotification(
      {
        channelId: 'ch-1',
        version: 'v1',
        data: toBase64Url(new Uint8Array(encrypted)),
        headers: { encoding: 'aes128gcm' },
      },
      keys,
      {
        logger: new NoopLogger(),
        getWebhookEndpoint: () => webhookUrl,
      }
    );

    expect(ack).toBe(AckCode.Delivered);
    expect(receivedPayloads.length).toBe(1);
  });
});
