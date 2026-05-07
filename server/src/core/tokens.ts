import fs from 'node:fs/promises';
import path from 'node:path';
import type { AllegroEnv, AppConfig } from '../config.js';

export interface TokenSet {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // epoch ms
  scope?: string;
  tokenType?: string;
  // Stored alongside tokens so we can detect a credentials change
  clientId?: string;
}

export class TokenStore {
  constructor(private readonly cfg: AppConfig) {}

  private filePath(env: AllegroEnv = this.cfg.env): string {
    return this.cfg.tokenFile(env);
  }

  async load(env: AllegroEnv = this.cfg.env): Promise<TokenSet | null> {
    try {
      const raw = await fs.readFile(this.filePath(env), 'utf8');
      return JSON.parse(raw) as TokenSet;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  async save(tokens: TokenSet, env: AllegroEnv = this.cfg.env): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath(env)), { recursive: true });
    const tmp = `${this.filePath(env)}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(tokens, null, 2), {
      mode: 0o600,
      encoding: 'utf8',
    });
    await fs.rename(tmp, this.filePath(env));
  }

  async clear(env: AllegroEnv = this.cfg.env): Promise<void> {
    try {
      await fs.unlink(this.filePath(env));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }
}
