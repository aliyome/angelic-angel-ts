import { AutoPushError } from '../errors.js';

export const AckCode = {
  Delivered: 100,
  DecryptionError: 101,
  NotDelivered: 102,
} as const;

export type AckCode = (typeof AckCode)[keyof typeof AckCode];

export interface AckUpdate {
  channelID: string;
  version: string;
  code: AckCode;
}

export type ClientMessage =
  | {
      messageType: 'hello';
      uaid?: string;
      channelIDs?: string[];
      use_webpush: true;
      broadcasts: Record<string, string>;
    }
  | {
      messageType: 'register';
      channelID: string;
      key?: string;
    }
  | {
      messageType: 'unregister';
      channelID: string;
      code: number;
    }
  | {
      messageType: 'ack';
      updates: AckUpdate[];
    };

export type ServerMessage =
  | {
      messageType: 'hello';
      status: number;
      uaid: string;
      use_webpush?: boolean;
      broadcasts?: Record<string, string>;
    }
  | {
      messageType: 'register';
      status: number;
      pushEndpoint: string;
      channelID: string;
    }
  | {
      messageType: 'notification';
      channelID: string;
      version: string;
      data?: string;
      headers?: Record<string, string>;
    }
  | {
      messageType: 'unknown';
      raw: unknown;
    };

/**
 * Determines if a received text message is an application-level pong.
 * Firefox treats an empty JSON object `{}` or any JSON object without a `messageType` field as a pong.
 */
export function isPong(text: string): boolean {
  try {
    const value = JSON.parse(text);
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      return Object.keys(value).length === 0 || !('messageType' in value);
    }
  } catch {
    // not valid JSON
  }
  return false;
}

/**
 * Parses an incoming text message from the AutoPush server into a ServerMessage.
 * Unknown messageTypes are returned as `{ messageType: 'unknown' }` rather than throwing.
 */
export function parseServerMessage(text: string): ServerMessage {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new AutoPushError(`failed to parse server message as JSON: ${msg}`);
  }

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new AutoPushError(`expected JSON object from server, got ${typeof value}`);
  }

  const obj = value as Record<string, unknown>;
  const msgType = obj['messageType'];

  if (msgType === 'hello') {
    if (typeof obj['status'] !== 'number' || typeof obj['uaid'] !== 'string') {
      throw new AutoPushError(`invalid hello response format: ${text}`);
    }
    return {
      messageType: 'hello',
      status: obj['status'],
      uaid: obj['uaid'],
      use_webpush: typeof obj['use_webpush'] === 'boolean' ? obj['use_webpush'] : undefined,
      broadcasts:
        typeof obj['broadcasts'] === 'object' && obj['broadcasts'] !== null
          ? (obj['broadcasts'] as Record<string, string>)
          : undefined,
    };
  }

  if (msgType === 'register') {
    if (typeof obj['status'] !== 'number' || typeof obj['pushEndpoint'] !== 'string') {
      throw new AutoPushError(`invalid register response format: ${text}`);
    }
    return {
      messageType: 'register',
      status: obj['status'],
      pushEndpoint: obj['pushEndpoint'],
      channelID: typeof obj['channelID'] === 'string' ? obj['channelID'] : '',
    };
  }

  if (msgType === 'notification') {
    if (typeof obj['channelID'] !== 'string' || typeof obj['version'] !== 'string') {
      throw new AutoPushError(`invalid notification format: ${text}`);
    }
    return {
      messageType: 'notification',
      channelID: obj['channelID'],
      version: obj['version'],
      data: typeof obj['data'] === 'string' ? obj['data'] : undefined,
      headers:
        typeof obj['headers'] === 'object' && obj['headers'] !== null
          ? (obj['headers'] as Record<string, string>)
          : undefined,
    };
  }

  return {
    messageType: 'unknown',
    raw: value,
  };
}
