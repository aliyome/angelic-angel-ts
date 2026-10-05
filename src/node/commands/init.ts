import { password, input } from '@inquirer/prompts';
import { FileConfigStore } from '../config-store.js';
import { ConfigError } from '../../core/errors.js';
import { styleText } from '../ui.js';

export interface InitOptions {
  authToken?: string;
  ct0?: string;
}

export async function cmdInit(configPath: string, options: InitOptions): Promise<void> {
  console.error(styleText('bold', 'Initializing configuration'));
  console.error();

  let authToken = options.authToken;
  if (!authToken) {
    try {
      authToken = await password({
        message: 'auth_token',
        mask: '*',
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new ConfigError(`input error: ${msg}`);
    }
  }

  let ct0 = options.ct0;
  if (!ct0) {
    try {
      ct0 = await input({
        message: 'ct0',
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new ConfigError(`input error: ${msg}`);
    }
  }

  const store = new FileConfigStore(configPath);
  await store.save({
    twitter: {
      authToken,
      ct0,
    },
    registration: undefined,
  });

  console.error(
    `${styleText(['green', 'bold'], 'done')} Saved to ${styleText('underline', store.location)}`
  );
}
