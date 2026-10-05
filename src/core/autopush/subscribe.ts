import type { Registration } from '../config.js';
import { generateKeys } from '../keys.js';
import { registerNew, type HandshakeDeps } from './handshake.js';

/**
 * Generates fresh P-256 keys and registers a new push subscription with Mozilla AutoPush.
 */
export async function subscribe(deps: HandshakeDeps): Promise<Registration> {
  const keys = await generateKeys();
  const reg = await registerNew(deps);

  return {
    endpoint: reg.endpoint,
    autopush: {
      uaid: reg.uaid,
      channelId: reg.channelId,
    },
    keys,
  };
}
