import { FileConfigStore } from '../config-store.js';
import { styleText } from '../ui.js';

export async function cmdStatus(configPath: string): Promise<void> {
  console.error(styleText('bold', 'Status'));
  console.error();

  const store = new FileConfigStore(configPath);
  try {
    const config = await store.load();

    console.error(
      `${styleText(['cyan', 'bold'], 'Config')}  ${styleText('dim', store.location)}`
    );
    console.error(
      `  auth_token  ${styleText('dim', config.twitter.authToken.slice(0, 20) + '...')}`
    );
    console.error(
      `  ct0         ${styleText('dim', config.twitter.ct0.slice(0, 20) + '...')}`
    );
    console.error();

    if (config.registration) {
      console.error(
        `${styleText(['cyan', 'bold'], 'Registration')}  ${styleText('green', 'active')}`
      );
      console.error(
        `  endpoint    ${styleText('dim', config.registration.endpoint.slice(0, 50) + '...')}`
      );
      console.error(
        `  uaid        ${styleText('dim', config.registration.autopush.uaid)}`
      );
      console.error(
        `  channel_id  ${styleText('dim', config.registration.autopush.channelId)}`
      );
    } else {
      console.error(
        `${styleText(['cyan', 'bold'], 'Registration')}  ${styleText('yellow', 'not registered')}`
      );
      console.error(
        `  Run ${styleText('bold', 'angelic-angel register')} to register.`
      );
    }
  } catch {
    console.error(
      `${styleText(['cyan', 'bold'], 'Config')}  ${styleText('red', 'not found')}`
    );
    console.error(
      `  Run ${styleText('bold', 'angelic-angel init')} to initialize.`
    );
  }
}
