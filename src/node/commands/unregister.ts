import { FileConfigStore } from '../config-store.js';
import { ConfigError } from '../../core/errors.js';
import { unregister } from '../../core/autopush/handshake.js';
import { nodeWsTransportFactory } from '../ws-transport.js';
import type { Logger } from '../../core/logger.js';
import { spin, styleText } from '../ui.js';

export async function cmdUnregister(
  configPath: string,
  deps: { logger: Logger; signal?: AbortSignal }
): Promise<void> {
  console.error(styleText('bold', 'Unregistering'));
  console.error();

  const store = new FileConfigStore(configPath);
  const config = await store.load();

  if (!config.registration) {
    throw new ConfigError('No registration found.');
  }

  const session = config.registration.autopush;

  await spin(
    'Unregistering from AutoPush...',
    'AutoPush unregistered',
    () =>
      unregister(session, {
        transportFactory: nodeWsTransportFactory,
        logger: deps.logger,
        signal: deps.signal,
      })
  );

  config.registration = undefined;
  await store.save(config);

  console.error();
  console.error(
    `${styleText(['green', 'bold'], 'done')} Registration removed from ${styleText('underline', store.location)}`
  );
}
