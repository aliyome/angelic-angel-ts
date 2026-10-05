import { FileConfigStore } from '../config-store.js';
import { subscribe } from '../../core/autopush/subscribe.js';
import { registerPushSubscription } from '../../core/twitter.js';
import { nodeWsTransportFactory } from '../ws-transport.js';
import type { Logger } from '../../core/logger.js';
import { spin, styleText } from '../ui.js';

export async function cmdRegister(
  configPath: string,
  deps: { logger: Logger; signal?: AbortSignal }
): Promise<void> {
  console.error(styleText('bold', 'Registering push subscription'));
  console.error();

  const store = new FileConfigStore(configPath);
  const config = await store.load();

  const subscription = await spin(
    'Registering with AutoPush...',
    'AutoPush registered',
    () =>
      subscribe({
        transportFactory: nodeWsTransportFactory,
        logger: deps.logger,
        signal: deps.signal,
      })
  );

  await spin(
    'Registering with Twitter...',
    'Twitter Push registered',
    () =>
      registerPushSubscription(config.twitter, subscription, {
        logger: deps.logger,
        signal: deps.signal,
      })
  );

  config.registration = subscription;
  await store.save(config);

  console.error();
  console.error(
    `${styleText(['green', 'bold'], 'done')} Saved to ${styleText('underline', store.location)}`
  );
}
