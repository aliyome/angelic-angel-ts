import { AutoPushError, BackoffError, WebSocketError } from '../errors.js';
import type { Logger } from '../logger.js';
import {
  BACKOFF_WS_STATUS_CODE,
  PING_INTERVAL_MS,
  PONG_TIMEOUT_MS,
  WS_PING_INTERVAL_MS,
} from './constants.js';
import { RecentIdSet } from './dedupe.js';
import {
  isPong,
  parseServerMessage,
  type AckCode,
  type ClientMessage,
} from './protocol.js';
import type { Transport } from './transport.js';

export interface Notification {
  channelId: string;
  version: string;
  data?: string;
  headers?: Record<string, string>;
}

export interface TimerConfig {
  appPingMs: number;
  pongTimeoutMs: number;
  wsPingMs: number;
}

export interface AutoPushClientDeps {
  logger: Logger;
  timers?: Partial<TimerConfig>;
}

enum PongWaitResultType {
  PongReceived,
  NotificationReceived,
  ConnectionClosed,
  Timeout,
}

type PongWaitResult =
  | { type: PongWaitResultType.PongReceived }
  | { type: PongWaitResultType.NotificationReceived; notification: Notification }
  | { type: PongWaitResultType.ConnectionClosed }
  | { type: PongWaitResultType.Timeout };

export class AutoPushClient {
  private readonly transport: Transport;
  private readonly logger: Logger;
  private readonly timers: TimerConfig;
  private readonly recentIds = new RecentIdSet();
  readonly uaid: string;
  readonly channelId: string;

  constructor(
    transport: Transport,
    session: { uaid: string; channelId: string },
    deps: AutoPushClientDeps
  ) {
    this.transport = transport;
    this.uaid = session.uaid;
    this.channelId = session.channelId;
    this.logger = deps.logger;
    this.timers = {
      appPingMs: deps.timers?.appPingMs ?? PING_INTERVAL_MS,
      pongTimeoutMs: deps.timers?.pongTimeoutMs ?? PONG_TIMEOUT_MS,
      wsPingMs: deps.timers?.wsPingMs ?? WS_PING_INTERVAL_MS,
    };
  }

  async close(): Promise<void> {
    await this.transport.close();
  }

  async ack(channelId: string, version: string, code: AckCode): Promise<void> {
    const ackMsg: ClientMessage = {
      messageType: 'ack',
      updates: [
        {
          channelID: channelId,
          version,
          code,
        },
      ],
    };
    await this.transport.sendText(JSON.stringify(ackMsg));
    this.logger.debug({ code, channelId, version }, 'ACK sent');
  }

  /**
   * Waits for the next notification from the server.
   * Automatically handles application pings, WebSocket ping frames, pong timeouts,
   * duplicate notification suppression, and unknown message ignoring.
   *
   * Returns:
   * - `Notification`: notification received and ready for processing
   * - `null`: connection closed normally by server
   *
   * Throws:
   * - `BackoffError`: server requested backoff (close code 4774)
   * - `AutoPushError`: protocol error or pong timeout
   * - `WebSocketError`: connection error
   */
  async nextNotification(signal?: AbortSignal): Promise<Notification | null> {
    let nextAppPing = Date.now() + this.timers.appPingMs;
    let nextWsPing = Date.now() + this.timers.wsPingMs;

    while (!signal?.aborted) {
      const now = Date.now();
      const appRemaining = Math.max(0, nextAppPing - now);
      const wsRemaining = Math.max(0, nextWsPing - now);
      const remaining = Math.min(appRemaining, wsRemaining);

      const ev = await this.transport.next(remaining, signal);

      if (ev.type === 'timeout') {
        const timeNow = Date.now();
        if (timeNow >= nextAppPing) {
          this.logger.debug({ idleMs: this.timers.appPingMs }, 'sending application-level ping');
          await this.transport.sendText('{}');

          const pongResult = await this.waitForPongOrNotification(signal);

          switch (pongResult.type) {
            case PongWaitResultType.PongReceived:
              this.logger.debug('pong received, connection healthy');
              nextAppPing = Date.now() + this.timers.appPingMs;
              nextWsPing = Date.now() + this.timers.wsPingMs;
              continue;

            case PongWaitResultType.NotificationReceived:
              return pongResult.notification;

            case PongWaitResultType.ConnectionClosed:
              this.logger.info('connection closed while waiting for pong');
              return null;

            case PongWaitResultType.Timeout:
              this.logger.warn(
                { timeoutMs: this.timers.pongTimeoutMs },
                'pong timed out, reconnection needed'
              );
              throw new AutoPushError('pong timed out, reconnection needed');
          }
        } else {
          // WS Ping frame timer expired
          this.logger.debug(
            { intervalMs: this.timers.wsPingMs },
            'sending WebSocket ping frame'
          );
          await this.transport.ping();
          nextWsPing = Date.now() + this.timers.wsPingMs;
          continue;
        }
      }

      // Reset timers on any received frame
      nextAppPing = Date.now() + this.timers.appPingMs;
      nextWsPing = Date.now() + this.timers.wsPingMs;

      if (ev.type === 'text') {
        if (isPong(ev.data)) {
          this.logger.debug('application-level pong received');
          continue;
        }

        const msg = parseServerMessage(ev.data);
        if (msg.messageType === 'notification') {
          // Duplicate detection (Q3 / Rust parity)
          if (this.recentIds.has(msg.version)) {
            this.logger.warn({ version: msg.version }, 'duplicate notification detected, skipping');
            // Still ACK duplicates so server stops retrying
            await this.ack(msg.channelID, msg.version, 100);
            continue;
          }

          this.recentIds.add(msg.version);
          this.logger.info(
            { channelId: msg.channelID, version: msg.version },
            'notification received'
          );

          return {
            channelId: msg.channelID,
            version: msg.version,
            data: msg.data,
            headers: msg.headers,
          };
        }

        if (msg.messageType === 'unknown') {
          // Q2: Ignore unknown messageType instead of failing and disconnecting
          this.logger.debug({ raw: msg.raw }, 'non-notification message received, ignoring');
          continue;
        }

        this.logger.debug({ msgType: msg.messageType }, 'non-notification message received');
        continue;
      }

      if (ev.type === 'ping' || ev.type === 'pong' || ev.type === 'binary') {
        continue;
      }

      if (ev.type === 'close') {
        if (ev.code === BACKOFF_WS_STATUS_CODE) {
          this.logger.warn('server backoff request received (close code 4774)');
          throw new BackoffError('server requested backoff');
        }
        this.logger.info({ code: ev.code, reason: ev.reason }, 'WebSocket closed by server');
        return null;
      }

      if (ev.type === 'error') {
        throw new WebSocketError(ev.error.message, { cause: ev.error });
      }

      if (ev.type === 'end') {
        this.logger.info('WebSocket stream ended');
        return null;
      }
    }

    return null;
  }

  private async waitForPongOrNotification(signal?: AbortSignal): Promise<PongWaitResult> {
    const deadline = Date.now() + this.timers.pongTimeoutMs;

    while (!signal?.aborted) {
      const remaining = Math.max(0, deadline - Date.now());
      if (remaining === 0) {
        return { type: PongWaitResultType.Timeout };
      }

      const ev = await this.transport.next(remaining, signal);

      if (ev.type === 'timeout') {
        return { type: PongWaitResultType.Timeout };
      }

      if (ev.type === 'text') {
        if (isPong(ev.data)) {
          return { type: PongWaitResultType.PongReceived };
        }

        const msg = parseServerMessage(ev.data);
        if (msg.messageType === 'notification') {
          // Q3: Apply deduplication even when waiting for pong
          if (this.recentIds.has(msg.version)) {
            this.logger.warn(
              { version: msg.version },
              'duplicate notification detected while waiting for pong, skipping'
            );
            await this.ack(msg.channelID, msg.version, 100);
            continue;
          }

          this.recentIds.add(msg.version);
          this.logger.info(
            { channelId: msg.channelID, version: msg.version },
            'notification received while waiting for pong'
          );

          return {
            type: PongWaitResultType.NotificationReceived,
            notification: {
              channelId: msg.channelID,
              version: msg.version,
              data: msg.data,
              headers: msg.headers,
            },
          };
        }

        this.logger.debug({ msg }, 'non-notification message while waiting for pong');
        continue;
      }

      if (ev.type === 'ping' || ev.type === 'pong' || ev.type === 'binary') {
        continue;
      }

      if (ev.type === 'close') {
        if (ev.code === BACKOFF_WS_STATUS_CODE) {
          throw new BackoffError('server requested backoff');
        }
        return { type: PongWaitResultType.ConnectionClosed };
      }

      if (ev.type === 'end') {
        return { type: PongWaitResultType.ConnectionClosed };
      }

      if (ev.type === 'error') {
        throw new WebSocketError(ev.error.message, { cause: ev.error });
      }
    }

    return { type: PongWaitResultType.Timeout };
  }
}
