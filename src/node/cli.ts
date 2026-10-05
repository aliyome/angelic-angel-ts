import { Command } from 'commander';
import { createLogger } from './logger.js';
import { styleText } from './ui.js';
import { cmdInit } from './commands/init.js';
import { cmdRegister } from './commands/register.js';
import { cmdListen } from './commands/listen.js';
import { cmdStatus } from './commands/status.js';
import { cmdUnregister } from './commands/unregister.js';

const program = new Command('angelic-angel')
  .description('Twitter Web Push Receiver')
  .option('-c, --config <path>', 'Configuration file path', 'angelic-angel.toml')
  .option('-v, --verbose', 'Enable verbose output (debug logs)', false);

const abortController = new AbortController();

process.on('SIGINT', () => {
  abortController.abort();
  console.error();
  console.error(styleText(['red', 'bold'], 'Interrupted'));
  process.exit(130); // D3: Exit code 130 on SIGINT
});

program
  .command('init')
  .description('Initialize config file (interactive if no arguments given)')
  .option('--auth-token <token>', 'Twitter auth_token')
  .option('--ct0 <ct0>', 'Twitter ct0 (CSRF token)')
  .action(async (options: { authToken?: string; ct0?: string }) => {
    const opts = program.opts<{ config: string; verbose: boolean }>();
    await cmdInit(opts.config, options);
  });

program
  .command('register')
  .description('Register AutoPush subscription and Twitter Push endpoint')
  .action(async () => {
    const opts = program.opts<{ config: string; verbose: boolean }>();
    const logger = createLogger(opts.verbose);
    await cmdRegister(opts.config, { logger, signal: abortController.signal });
  });

program
  .command('listen')
  .description('Start listening for push notifications')
  .action(async () => {
    const opts = program.opts<{ config: string; verbose: boolean }>();
    const logger = createLogger(opts.verbose);
    await cmdListen(opts.config, { logger, signal: abortController.signal });
  });

program
  .command('status')
  .description('Show current config and registration status')
  .action(async () => {
    const opts = program.opts<{ config: string; verbose: boolean }>();
    await cmdStatus(opts.config);
  });

program
  .command('unregister')
  .description('Unregister AutoPush subscription')
  .action(async () => {
    const opts = program.opts<{ config: string; verbose: boolean }>();
    const logger = createLogger(opts.verbose);
    await cmdUnregister(opts.config, { logger, signal: abortController.signal });
  });

async function main(): Promise<void> {
  try {
    await program.parseAsync(process.argv);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${styleText(['red', 'bold'], 'error:')} ${msg}`);
    process.exit(1);
  }
}

main();
