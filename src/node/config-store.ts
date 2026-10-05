import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Config, ConfigStore } from '../core/config.js';
import { parseConfig, stringifyConfig } from '../core/config.js';
import { ConfigError } from '../core/errors.js';

export class FileConfigStore implements ConfigStore {
  readonly location: string;

  constructor(filePath: string) {
    this.location = path.resolve(filePath);
  }

  async load(): Promise<Config> {
    let content: string;
    try {
      content = await fs.readFile(this.location, 'utf-8');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new ConfigError(`failed to read config (${this.location}): ${msg}`);
    }
    return parseConfig(content);
  }

  async save(config: Config): Promise<void> {
    const serialized = stringifyConfig(config);
    const dir = path.dirname(this.location);
    const tmpFile = path.join(dir, `.${path.basename(this.location)}.${process.pid}.${randomUUID()}.tmp`);

    try {
      // Write with 0o600 permissions
      await fs.writeFile(tmpFile, serialized, { mode: 0o600, encoding: 'utf-8' });
      await fs.rename(tmpFile, this.location);
    } catch (err: unknown) {
      // Clean up tmp file on error if it exists
      try {
        await fs.unlink(tmpFile);
      } catch {
        // ignore cleanup error
      }
      const msg = err instanceof Error ? err.message : String(err);
      throw new ConfigError(`failed to save config (${this.location}): ${msg}`);
    }
  }
}
