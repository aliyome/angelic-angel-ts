import { FileConfigStore } from '../config-store.js';
import { ConfigError } from '../../core/errors.js';
import { listen } from '../../core/listener.js';
import { nodeWsTransportFactory } from '../ws-transport.js';
import type { Logger } from '../../core/logger.js';

export async function cmdListen(
  configPath: string,
  deps: { logger: Logger; signal: AbortSignal }
): Promise<void> {
  const store = new FileConfigStore(configPath);
  const config = await store.load();

  if (!config.registration) {
    throw new ConfigError('No registration found. Run `register` first.');
  }

  deps.logger.info({ config: store.location }, 'config loaded, starting listener');

  await listen(config.registration, {
    configStore: store,
    transportFactory: nodeWsTransportFactory,
    logger: deps.logger,
    getWebhookEndpoint: () => process.env['WEBHOOK_ENDPOINT'],
    signal: deps.signal,
  });
}
