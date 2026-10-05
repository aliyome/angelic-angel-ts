import { AutoPushError } from '../errors.js';
import type { WebPushKeys } from '../config.js';
import { generateKeys } from '../keys.js';
import type { Logger } from '../logger.js';
import { AutoPushClient, type TimerConfig } from './client.js';
import {
  AUTOPUSH_WS_URL,
  PONG_TIMEOUT_MS,
  TWITTER_VAPID_PUBLIC_KEY_B64URL,
} from './constants.js';
import {
  parseServerMessage,
  type ClientMessage,
  type ServerMessage,
} from './protocol.js';
import type { Transport, TransportFactory } from './transport.js';

export interface AutoPushRegistration {
  uaid: string;
  channelId: string;
  endpoint: string;
}

export type ConnectResult =
  | {
      kind: 'connected';
      client: AutoPushClient;
    }
  | {
      kind: 'needs_reregistration';
      registration: AutoPushRegistration;
      keys: WebPushKeys;
    };

export interface HandshakeDeps {
  transportFactory: TransportFactory;
  logger: Logger;
  url?: string;
  timers?: Partial<TimerConfig>;
  signal?: AbortSignal;
}

async function sendHello(transport: Transport, uaid?: string): Promise<void> {
  const msg: ClientMessage = {
    messageType: 'hello',
    uaid: uaid ?? '',
    use_webpush: true,
    broadcasts: {},
  };
  await transport.sendText(JSON.stringify(msg));
}

async function expectResponse<T extends 'hello' | 'register'>(
  transport: Transport,
  expectedType: T,
  timeoutMs: number = PONG_TIMEOUT_MS,
  signal?: AbortSignal
): Promise<Extract<ServerMessage, { messageType: T }>> {
  const ev = await transport.next(timeoutMs, signal);

  if (ev.type === 'timeout') {
    throw new AutoPushError(`${expectedType} response timed out (10s)`);
  }
  if (ev.type === 'close' || ev.type === 'end') {
    throw new AutoPushError('connection closed by server');
  }
  if (ev.type === 'error') {
    throw new AutoPushError(`connection error waiting for ${expectedType}: ${ev.error.message}`);
  }
  if (ev.type !== 'text') {
    throw new AutoPushError(`unexpected message type: expected ${expectedType} text frame`);
  }

  const msg = parseServerMessage(ev.data);
  if (msg.messageType !== expectedType) {
    throw new AutoPushError(`unexpected response: expected ${expectedType}, got ${msg.messageType}`);
  }

  const resp = msg as Extract<ServerMessage, { messageType: T }>;
  if ('status' in resp && (resp as { status: number }).status !== 200) {
    throw new AutoPushError(`${expectedType} failed: status=${(resp as { status: number }).status}`);
  }

  return resp;
}

/**
 * Performs a fresh registration:
 * 1. Connect WebSocket
 * 2. Send hello (uaid="")
 * 3. Receive uaid
 * 4. Send register with random channel_id and Twitter VAPID key
 * 5. Receive pushEndpoint
 * 6. Disconnect
 */
export async function registerNew(deps: HandshakeDeps): Promise<AutoPushRegistration> {
  deps.logger.info('starting new AutoPush registration');
  const url = deps.url ?? AUTOPUSH_WS_URL;
  const transport = await deps.transportFactory(url, deps.signal);

  try {
    // 1. Send hello
    await sendHello(transport, '');
    deps.logger.debug('hello sent');

    // 2. Receive hello
    const helloResp = await expectResponse(transport, 'hello', PONG_TIMEOUT_MS, deps.signal);
    const uaid = helloResp.uaid;
    deps.logger.info({ uaid }, 'hello succeeded');

    // 3. Send register
    const channelId = crypto.randomUUID();
    const registerMsg: ClientMessage = {
      messageType: 'register',
      channelID: channelId,
      key: TWITTER_VAPID_PUBLIC_KEY_B64URL,
    };
    await transport.sendText(JSON.stringify(registerMsg));
    deps.logger.debug({ channelId }, 'register sent');

    // 4. Receive register
    const regResp = await expectResponse(transport, 'register', PONG_TIMEOUT_MS, deps.signal);
    deps.logger.info({ endpoint: regResp.pushEndpoint }, 'register succeeded');

    return {
      uaid,
      channelId,
      endpoint: regResp.pushEndpoint,
    };
  } finally {
    await transport.close();
  }
}

/**
 * Reconnects to AutoPush with an existing session.
 * If the server responds with a different UAID (UAID invalidated / pushsubscriptionchange),
 * automatically generates new keys, performs a new registration, and returns `needs_reregistration`.
 */
export async function connect(
  session: { uaid: string; channelId: string },
  deps: HandshakeDeps
): Promise<ConnectResult> {
  deps.logger.info({ uaid: session.uaid }, 'reconnecting to AutoPush');
  const url = deps.url ?? AUTOPUSH_WS_URL;
  const transport = await deps.transportFactory(url, deps.signal);

  try {
    // 1. Send hello with existing UAID
    await sendHello(transport, session.uaid);
    deps.logger.debug('hello sent (reconnect)');

    // 2. Receive hello response
    const helloResp = await expectResponse(transport, 'hello', PONG_TIMEOUT_MS, deps.signal);

    if (helloResp.uaid !== session.uaid) {
      deps.logger.warn(
        { oldUaid: session.uaid, newUaid: helloResp.uaid },
        'UAID invalidated, generating new keys and re-registering'
      );

      await transport.close();

      // Generate fresh keys (Firefox: ensureCrypto() on re-subscribe)
      const newKeys = await generateKeys();
      deps.logger.info('generated new encryption keys');

      const registration = await registerNew(deps);
      deps.logger.info({ newUaid: registration.uaid }, 're-registration complete');

      return {
        kind: 'needs_reregistration',
        registration,
        keys: newKeys,
      };
    }

    deps.logger.info({ uaid: helloResp.uaid }, 'hello succeeded (reconnect)');

    const client = new AutoPushClient(transport, session, {
      logger: deps.logger,
      timers: deps.timers,
    });

    return {
      kind: 'connected',
      client,
    };
  } catch (err) {
    await transport.close();
    throw err;
  }
}

/**
 * Unregisters a channel from AutoPush:
 * 1. Connect
 * 2. Send hello
 * 3. Send unregister
 * 4. Disconnect
 */
export async function unregister(
  session: { uaid: string; channelId: string },
  deps: HandshakeDeps
): Promise<void> {
  deps.logger.info(
    { uaid: session.uaid, channelId: session.channelId },
    'starting AutoPush unregistration'
  );

  const url = deps.url ?? AUTOPUSH_WS_URL;
  const transport = await deps.transportFactory(url, deps.signal);

  try {
    // 1. Send hello
    await sendHello(transport, session.uaid);
    deps.logger.debug('hello sent (unregister)');

    // 2. Receive hello
    const helloResp = await expectResponse(transport, 'hello', PONG_TIMEOUT_MS, deps.signal);
    deps.logger.info({ uaid: helloResp.uaid }, 'hello succeeded (unregister)');

    // 3. Send unregister
    const unregisterMsg: ClientMessage = {
      messageType: 'unregister',
      channelID: session.channelId,
      code: 200,
    };
    await transport.sendText(JSON.stringify(unregisterMsg));
    deps.logger.debug({ channelId: session.channelId }, 'unregister sent');
  } finally {
    await transport.close();
  }

  deps.logger.info('AutoPush unregistration complete');
}
