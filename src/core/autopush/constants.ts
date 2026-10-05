import { fromBase64Url } from '../bytes.js';

export const AUTOPUSH_WS_URL = 'wss://push.services.mozilla.com/';

/**
 * Twitter/X VAPID public key (applicationServerKey) used by PushManager.subscribe().
 * Raw 65 bytes starting with 0x04.
 */
export const TWITTER_VAPID_PUBLIC_KEY_B64URL =
  'BF5oEo0xDUpgylKDTlsd8pZmxQA1leYINiY-rSscWYK_3tWAkz4VMbtf1MLE_Yyd6iII6o-e3Q9TCN5vZMzVMEs';

export const TWITTER_VAPID_PUBLIC_KEY = fromBase64Url(TWITTER_VAPID_PUBLIC_KEY_B64URL);

export const FIREFOX_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:134.0) Gecko/20100101 Firefox/134.0';

/** Application-level ping interval: 5 minutes */
export const PING_INTERVAL_MS = 5 * 60 * 1000;

/** Pong wait timeout: 10 seconds */
export const PONG_TIMEOUT_MS = 10 * 1000;

/** WebSocket ping frame interval: 150 seconds */
export const WS_PING_INTERVAL_MS = 150 * 1000;

/** WebSocket close code for server-initiated backoff */
export const BACKOFF_WS_STATUS_CODE = 4774;

/** Maximum number of recent message IDs to track for deduplication */
export const MAX_RECENT_MESSAGE_IDS = 100;
