import { toBase64Url } from './bytes.js';
import type { Registration, TwitterConfig } from './config.js';
import { TwitterApiError, HttpError } from './errors.js';
import type { Logger } from './logger.js';
import { FIREFOX_UA } from './autopush/constants.js';

const TWITTER_API_BASE = 'https://x.com/i/api/1.1';
const AUTHORIZATION_BEARER =
  'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';
const DEVICE_ID = 'Mac/Firefox';

export interface TwitterRegisterDeps {
  logger: Logger;
  apiBaseUrl?: string;
  signal?: AbortSignal;
}

/**
 * Registers the push subscription with Twitter/X notification settings API.
 */
export async function registerPushSubscription(
  twitterConfig: TwitterConfig,
  registration: Registration,
  deps: TwitterRegisterDeps
): Promise<void> {
  const url = `${deps.apiBaseUrl ?? TWITTER_API_BASE}/notifications/settings/login.json`;

  const token = registration.endpoint;
  const encryptionKey1 = toBase64Url(registration.keys.publicKey);
  const encryptionKey2 = toBase64Url(registration.keys.authSecret);

  const body = {
    push_device_info: {
      os_version: DEVICE_ID,
      udid: DEVICE_ID,
      env: 3,
      locale: 'en',
      protocol_version: 1,
      token,
      encryption_key1: encryptionKey1,
      encryption_key2: encryptionKey2,
    },
  };

  deps.logger.debug({ url }, 'sending push subscription request');
  deps.logger.debug({ body }, 'request body');

  const timeoutSignal = AbortSignal.timeout(30_000);
  const combinedSignal = deps.signal
    ? AbortSignal.any([deps.signal, timeoutSignal])
    : timeoutSignal;

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: AUTHORIZATION_BEARER,
        'User-Agent': FIREFOX_UA, // D6: Firefox User-Agent
        'x-csrf-token': twitterConfig.ct0,
        'x-twitter-auth-type': 'OAuth2Session',
        'x-twitter-active-user': 'yes',
        'x-twitter-client-language': 'en',
        'Content-Type': 'application/json',
        Cookie: `auth_token=${twitterConfig.authToken}; ct0=${twitterConfig.ct0}`,
      },
      body: JSON.stringify(body),
      signal: combinedSignal,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new HttpError(`failed to send request to Twitter API: ${msg}`, { cause: err });
  }

  deps.logger.debug({ status: response.status }, 'response status');

  if (!response.ok) {
    let errorText: string;
    try {
      errorText = await response.text();
    } catch {
      errorText = 'failed to read error response body';
    }
    deps.logger.debug({ body: errorText }, 'error response body');

    throw new TwitterApiError(
      `push subscription registration failed (${response.status}): ${errorText}`,
      response.status
    );
  }

  try {
    const responseJson = await response.json();
    deps.logger.debug({ body: responseJson }, 'success response body');
  } catch {
    // Response might not be JSON or already consumed
  }
}
