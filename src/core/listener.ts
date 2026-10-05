import { calcBackoff, sleep } from './backoff.js';
import type { ConfigStore, Registration } from './config.js';
import {
  AngelicAngelError,
  BackoffError,
  GeneralError,
  ReregistrationFailedError,
} from './errors.js';
import type { Logger } from './logger.js';
import {
  connect,
  type ConnectResult,
  type HandshakeDeps,
} from './autopush/handshake.js';
import type { AutoPushClient } from './autopush/client.js';
import { handleNotification } from './notification.js';
import { registerPushSubscription } from './twitter.js';

type SessionOutcome =
  | { kind: 'normal_close' }
  | { kind: 'disconnected_after_connect'; error: AngelicAngelError }
  | { kind: 'connection_failed'; error: AngelicAngelError }
  | { kind: 'fatal'; error: AngelicAngelError };

export interface ListenerDeps extends HandshakeDeps {
  configStore: ConfigStore;
  getWebhookEndpoint: () => string | undefined;
  twitterApiBaseUrl?: string;
}

/**
 * Main listen loop with automatic reconnection.
 * Mirrors Firefox's reconnection strategy:
 * - Reset retry counter on any successful connection
 * - Infinite retries with exponential backoff: 5s * 2^(retry - 1), capped at 5 minutes
 * - Server-initiated backoff via close code 4774 delays reconnect for 30 minutes
 * - Transparent re-registration on UAID invalidation
 */
export async function listen(
  registration: Registration,
  deps: ListenerDeps
): Promise<never> {
  let retryCount = 0;

  while (!deps.signal?.aborted) {
    const outcome = await listenOnce(registration, deps);

    switch (outcome.kind) {
      case 'normal_close': {
        retryCount = 0;
        deps.logger.info('WebSocket connection closed, reconnecting');
        await sleep(1000, deps.signal);
        break;
      }
      case 'disconnected_after_connect': {
        if (outcome.error instanceof BackoffError) {
          deps.logger.warn('server requested backoff, delaying reconnect for 30 minutes');
          await sleep(30 * 60 * 1000, deps.signal);
        } else {
          retryCount = 0;
          deps.logger.info(
            { error: outcome.error },
            'disconnected after connect, reconnecting'
          );
          await sleep(1000, deps.signal);
        }
        break;
      }
      case 'connection_failed': {
        retryCount++;
        const delaySec = calcBackoff(retryCount);
        deps.logger.warn(
          { retryCount, delaySec, error: outcome.error },
          'WebSocket connection failed, retrying'
        );
        await sleep(delaySec * 1000, deps.signal);
        break;
      }
      case 'fatal': {
        deps.logger.error({ error: outcome.error }, 'fatal error, re-registration required');
        throw outcome.error;
      }
    }
  }

  throw new Error('listen aborted');
}

async function listenOnce(
  registration: Registration,
  deps: ListenerDeps
): Promise<SessionOutcome> {
  let client: AutoPushClient;
  try {
    client = await tryConnect(registration, deps);
  } catch (err: unknown) {
    const error =
      err instanceof AngelicAngelError
        ? err
        : new GeneralError(err instanceof Error ? err.message : String(err));

    if (error instanceof ReregistrationFailedError) {
      return { kind: 'fatal', error };
    }

    return { kind: 'connection_failed', error };
  }

  deps.logger.info('WebSocket connection established, listening for notifications');

  try {
    await runNotificationLoop(client, registration, deps);
    return { kind: 'normal_close' };
  } catch (err: unknown) {
    const error =
      err instanceof AngelicAngelError
        ? err
        : new GeneralError(err instanceof Error ? err.message : String(err));
    return { kind: 'disconnected_after_connect', error };
  }
}

async function tryConnect(
  registration: Registration,
  deps: ListenerDeps
): Promise<AutoPushClient> {
  const connectResult: ConnectResult = await connect(registration.autopush, deps);

  switch (connectResult.kind) {
    case 'connected':
      deps.logger.info('connected with existing session');
      return connectResult.client;

    case 'needs_reregistration': {
      const newReg = connectResult.registration;
      const newKeys = connectResult.keys;

      deps.logger.warn(
        { newUaid: newReg.uaid, newChannelId: newReg.channelId },
        'UAID invalidated (pushsubscriptionchange), re-registering'
      );

      deps.logger.info('re-registering with Twitter API');
      const fullConfig = await deps.configStore.load();

      const newSubscription: Registration = {
        endpoint: newReg.endpoint,
        autopush: {
          uaid: newReg.uaid,
          channelId: newReg.channelId,
        },
        keys: newKeys,
      };

      await registerPushSubscription(fullConfig.twitter, newSubscription, {
        logger: deps.logger,
        apiBaseUrl: deps.twitterApiBaseUrl,
        signal: deps.signal,
      });

      deps.logger.info('Twitter API re-registration complete');

      // Update in-memory registration and save config
      registration.endpoint = newSubscription.endpoint;
      registration.autopush = newSubscription.autopush;
      registration.keys = newSubscription.keys;

      fullConfig.registration = { ...registration };
      await deps.configStore.save(fullConfig);
      deps.logger.info('saved updated registration');

      const secondResult = await connect(registration.autopush, deps);
      if (secondResult.kind === 'connected') {
        return secondResult.client;
      }

      throw new ReregistrationFailedError();
    }
  }
}

async function runNotificationLoop(
  client: AutoPushClient,
  registration: Registration,
  deps: ListenerDeps
): Promise<void> {
  while (!deps.signal?.aborted) {
    const notification = await client.nextNotification(deps.signal);
    if (!notification) {
      break;
    }

    deps.logger.info(
      { channelId: notification.channelId, version: notification.version },
      'notification received'
    );

    const ackCode = await handleNotification(notification, registration.keys, deps);
    await client.ack(notification.channelId, notification.version, ackCode);
    deps.logger.debug(
      { channelId: notification.channelId, ackCode },
      'ACK sent'
    );
  }
}
