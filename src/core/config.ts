import { parse, stringify } from 'smol-toml';
import { z } from 'zod';
import { ConfigError } from './errors.js';

export interface WebPushKeys {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
  authSecret: Uint8Array;
}

export interface AutoPushSession {
  uaid: string;
  channelId: string;
}

export interface Registration {
  endpoint: string;
  autopush: AutoPushSession;
  keys: WebPushKeys;
}

export interface TwitterConfig {
  authToken: string;
  ct0: string;
}

export interface Config {
  twitter: TwitterConfig;
  registration?: Registration;
}

export interface ConfigStore {
  readonly location: string;
  load(): Promise<Config>;
  save(config: Config): Promise<void>;
}

const ByteArraySchema = (len: number, name: string) =>
  z.array(z.number().int().min(0).max(255), {
    required_error: `${name} is required`,
    invalid_type_error: `${name} must be an array of byte numbers`,
  })
    .length(len, `${name} must be ${len} bytes`)
    .transform((arr) => Uint8Array.from(arr));

const ConfigFileSchema = z.object({
  twitter: z.object({
    auth_token: z.string({ required_error: 'twitter.auth_token is required' }),
    ct0: z.string({ required_error: 'twitter.ct0 is required' }),
  }),
  registration: z
    .object({
      endpoint: z.string({ required_error: 'registration.endpoint is required' }),
      autopush: z.object({
        uaid: z.string({ required_error: 'registration.autopush.uaid is required' }),
        channel_id: z.string({ required_error: 'registration.autopush.channel_id is required' }),
      }),
      keys: z.object({
        public_key: ByteArraySchema(65, 'registration.keys.public_key'),
        private_key: ByteArraySchema(32, 'registration.keys.private_key'),
        auth_secret: ByteArraySchema(16, 'registration.keys.auth_secret'),
      }),
    })
    .optional(),
});

export function parseConfig(content: string): Config {
  let parsed: unknown;
  try {
    parsed = parse(content);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ConfigError(`failed to parse TOML: ${msg}`);
  }

  const result = ConfigFileSchema.safeParse(parsed);
  if (!result.success) {
    const firstIssue = result.error.issues[0];
    const path = firstIssue?.path.join('.') || 'root';
    throw new ConfigError(`invalid config format at '${path}': ${firstIssue?.message}`);
  }

  const data = result.data;
  return {
    twitter: {
      authToken: data.twitter.auth_token,
      ct0: data.twitter.ct0,
    },
    registration: data.registration
      ? {
          endpoint: data.registration.endpoint,
          autopush: {
            uaid: data.registration.autopush.uaid,
            channelId: data.registration.autopush.channel_id,
          },
          keys: {
            publicKey: data.registration.keys.public_key,
            privateKey: data.registration.keys.private_key,
            authSecret: data.registration.keys.auth_secret,
          },
        }
      : undefined,
  };
}

export function stringifyConfig(config: Config): string {
  const tomlObj: Record<string, unknown> = {
    twitter: {
      auth_token: config.twitter.authToken,
      ct0: config.twitter.ct0,
    },
  };

  if (config.registration) {
    tomlObj.registration = {
      endpoint: config.registration.endpoint,
      autopush: {
        uaid: config.registration.autopush.uaid,
        channel_id: config.registration.autopush.channelId,
      },
      keys: {
        public_key: Array.from(config.registration.keys.publicKey),
        private_key: Array.from(config.registration.keys.privateKey),
        auth_secret: Array.from(config.registration.keys.authSecret),
      },
    };
  }

  try {
    return stringify(tomlObj);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ConfigError(`failed to serialize config: ${msg}`);
  }
}
