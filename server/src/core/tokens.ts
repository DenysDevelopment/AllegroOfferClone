import fs from 'node:fs/promises';
import path from 'node:path';
import type { AppConfig } from '../config.js';

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

  private filePath(): string {
    return this.cfg.tokenFile();
  }

  async load(): Promise<TokenSet | null> {
    try {
      const raw = await fs.readFile(this.filePath(), 'utf8');
      return JSON.parse(raw) as TokenSet;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  async save(tokens: TokenSet): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath()), { recursive: true });
    const tmp = `${this.filePath()}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(tokens, null, 2), {
      mode: 0o600,
      encoding: 'utf8',
    });
    await fs.rename(tmp, this.filePath());
  }

  async clear(): Promise<void> {
    try {
      await fs.unlink(this.filePath());
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }
}
