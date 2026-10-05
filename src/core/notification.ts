import { fromBase64Url, decodeUtf8Strict } from './bytes.js';
import type { WebPushKeys } from './config.js';
import { decryptPayload } from './ece.js';
import { ConfigError, DecryptionError, HttpError } from './errors.js';
import type { Logger } from './logger.js';
import { AckCode } from './autopush/protocol.js';
import type { Notification } from './autopush/client.js';

export interface NotificationHandlerDeps {
  logger: Logger;
  getWebhookEndpoint: () => string | undefined;
  signal?: AbortSignal;
}

/**
 * Handles incoming push notification:
 * Decrypts payload using ECE, converts to JSON, sends to Webhook, and determines ACK code.
 */
export async function handleNotification(
  notification: Notification,
  keys: WebPushKeys,
  deps: NotificationHandlerDeps
): Promise<AckCode> {
  if (!notification.data) {
    deps.logger.info('empty notification (no data)');
    return AckCode.Delivered;
  }

  try {
    let encrypted: Uint8Array;
    try {
      encrypted = fromBase64Url(notification.data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new DecryptionError(`base64 decode failed: ${msg}`);
    }

    deps.logger.debug({ encryptedSize: encrypted.length }, 'decoding encrypted message');

    if (notification.headers) {
      deps.logger.debug({ headers: notification.headers }, 'notification headers');
    }

    let decrypted: Uint8Array;
    try {
      decrypted = await decryptPayload(encrypted, notification.headers, keys);
      deps.logger.debug({ decryptedSize: decrypted.length }, 'ECE decryption succeeded');
    } catch (err) {
      deps.logger.error({ error: err }, 'ECE decryption failed');
      throw err;
    }

    let text: string;
    try {
      text = decodeUtf8Strict(decrypted);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new DecryptionError(`UTF-8 conversion failed: ${msg}`);
    }

    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { raw: text };
    }

    deps.logger.info({ payload }, 'notification decrypted');

    await sendToWebhook(payload, deps);
    return AckCode.Delivered;
  } catch (err: unknown) {
    if (err instanceof DecryptionError) {
      deps.logger.warn({ error: err }, 'decryption error, sending ACK with decryption_error');
      return AckCode.DecryptionError;
    }

    deps.logger.warn({ error: err }, 'notification processing error, sending ACK with not_delivered');
    return AckCode.NotDelivered;
  }
}

/**
 * Sends decrypted payload to the configured webhook endpoint via HTTP POST.
 */
export async function sendToWebhook(
  payload: unknown,
  deps: NotificationHandlerDeps
): Promise<void> {
  const webhookUrl = deps.getWebhookEndpoint();
  if (!webhookUrl) {
    throw new ConfigError('WEBHOOK_ENDPOINT environment variable is not set');
  }

  deps.logger.info({ url: webhookUrl }, 'sending to webhook');

  const timeoutSignal = AbortSignal.timeout(30_000);
  const combinedSignal = deps.signal
    ? AbortSignal.any([deps.signal, timeoutSignal])
    : timeoutSignal;

  let response: Response;
  try {
    response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: combinedSignal,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new HttpError(`webhook request failed: ${msg}`, { cause: err });
  }

  if (!response.ok) {
    let errorText: string;
    try {
      errorText = await response.text();
    } catch {
      errorText = 'failed to read response body';
    }
    deps.logger.warn(
      { status: response.status, body: errorText },
      'webhook request failed with non-2xx status'
    );
  } else {
    deps.logger.info({ status: response.status }, 'webhook request succeeded');
  }
}
