import { WebSocket } from 'ws';
import type { Socket } from 'node:net';
import type { Transport, TransportEvent, TransportFactory } from '../core/autopush/transport.js';
import { FIREFOX_UA } from '../core/autopush/constants.js';
import { WebSocketError } from '../core/errors.js';

export class WsTransport implements Transport {
  private readonly ws: WebSocket;
  private readonly eventQueue: TransportEvent[] = [];
  private waiter:
    | {
        resolve: (event: TransportEvent | { type: 'timeout' } | { type: 'end' }) => void;
        timerId: ReturnType<typeof setTimeout>;
      }
    | null = null;
  private isClosed = false;

  constructor(ws: WebSocket) {
    this.ws = ws;

    ws.on('message', (data: Buffer | ArrayBuffer | Buffer[], isBinary: boolean) => {
      if (isBinary) {
        let u8: Uint8Array;
        if (Buffer.isBuffer(data)) {
          u8 = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        } else if (Array.isArray(data)) {
          const buf = Buffer.concat(data);
          u8 = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
        } else {
          u8 = new Uint8Array(data);
        }
        this.pushEvent({ type: 'binary', data: u8 });
      } else {
        const text = data.toString('utf-8');
        this.pushEvent({ type: 'text', data: text });
      }
    });

    ws.on('ping', () => {
      this.pushEvent({ type: 'ping' });
    });

    ws.on('pong', () => {
      this.pushEvent({ type: 'pong' });
    });

    ws.on('close', (code: number, reason: Buffer) => {
      this.isClosed = true;
      this.pushEvent({ type: 'close', code, reason: reason.toString('utf-8') });
    });

    ws.on('error', (err: Error) => {
      this.isClosed = true;
      this.pushEvent({ type: 'error', error: err });
    });
  }

  private pushEvent(ev: TransportEvent): void {
    if (this.waiter) {
      const { resolve, timerId } = this.waiter;
      clearTimeout(timerId);
      this.waiter = null;
      resolve(ev);
    } else {
      this.eventQueue.push(ev);
    }
  }

  async next(
    timeoutMs: number,
    signal?: AbortSignal
  ): Promise<TransportEvent | { type: 'timeout' } | { type: 'end' }> {
    if (signal?.aborted) {
      return { type: 'end' };
    }

    if (this.eventQueue.length > 0) {
      return this.eventQueue.shift()!;
    }

    if (this.isClosed) {
      return { type: 'end' };
    }

    return new Promise((resolve) => {
      const onAbort = () => {
        if (this.waiter) {
          clearTimeout(this.waiter.timerId);
          this.waiter = null;
          signal?.removeEventListener('abort', onAbort);
          resolve({ type: 'end' });
        }
      };

      signal?.addEventListener('abort', onAbort, { once: true });

      const timerId = setTimeout(() => {
        if (this.waiter) {
          this.waiter = null;
          signal?.removeEventListener('abort', onAbort);
          resolve({ type: 'timeout' });
        }
      }, timeoutMs);

      this.waiter = {
        resolve: (ev) => {
          signal?.removeEventListener('abort', onAbort);
          resolve(ev);
        },
        timerId,
      };
    });
  }

  sendText(text: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws.send(text, (err) => {
        if (err) {
          reject(new WebSocketError(`failed to send text: ${err.message}`, { cause: err }));
        } else {
          resolve();
        }
      });
    });
  }

  ping(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws.ping(undefined, false, (err) => {
        if (err) {
          reject(new WebSocketError(`failed to send ping frame: ${err.message}`, { cause: err }));
        } else {
          resolve();
        }
      });
    });
  }

  close(code?: number): Promise<void> {
    return new Promise((resolve) => {
      if (this.isClosed || this.ws.readyState === WebSocket.CLOSED) {
        resolve();
        return;
      }

      this.ws.once('close', () => {
        resolve();
      });

      try {
        this.ws.close(code);
      } catch {
        resolve();
      }
    });
  }
}

/**
 * Creates and connects a new WebSocket with Firefox headers and TCP keepalive.
 */
export const nodeWsTransportFactory: TransportFactory = (
  url: string,
  signal?: AbortSignal
): Promise<Transport> => {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new WebSocketError('connection aborted'));
      return;
    }

    const ws = new WebSocket(url, {
      headers: {
        'User-Agent': FIREFOX_UA,
      },
      origin: 'https://x.com',
      perMessageDeflate: false,
      autoPong: true,
      handshakeTimeout: 10_000,
    });

    const onAbort = () => {
      ws.terminate();
      reject(new WebSocketError('connection aborted'));
    };

    signal?.addEventListener('abort', onAbort, { once: true });

    ws.on('upgrade', (res) => {
      const socket = res.socket as Socket;
      if (socket) {
        socket.setKeepAlive(true, 60_000);
        socket.setNoDelay(true);
      }
    });

    ws.once('open', () => {
      signal?.removeEventListener('abort', onAbort);
      resolve(new WsTransport(ws));
    });

    ws.once('error', (err: Error) => {
      signal?.removeEventListener('abort', onAbort);
      reject(new WebSocketError(`WebSocket connect failed: ${err.message}`, { cause: err }));
    });
  });
};
