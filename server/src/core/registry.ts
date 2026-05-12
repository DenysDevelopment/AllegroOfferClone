import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { AccountConfig, MultiConfig } from '../config.js';
import { AllegroClient } from './allegro.js';
import { OAuthClient } from './oauth.js';
import { TokenStore } from './tokens.js';

export interface AccountRuntime {
  config: AccountConfig;
  store: TokenStore;
  oauth: OAuthClient;
  allegro: AllegroClient;
}

export class AccountRegistry {
  private readonly byId = new Map<string, AccountRuntime>();
  readonly defaultAccountId: string;

  constructor(private readonly multi: MultiConfig) {
    this.defaultAccountId = multi.defaultAccountId;
    for (const cfg of multi.accounts) {
      const store = new TokenStore(cfg);
      const oauth = new OAuthClient(cfg, store);
      const allegro = new AllegroClient(cfg, oauth);
      this.byId.set(cfg.accountId, { config: cfg, store, oauth, allegro });
    }
  }

  list(): AccountRuntime[] {
    return this.multi.accounts.map((a) => this.byId.get(a.accountId)!);
  }

  get(accountId: string | undefined): AccountRuntime | undefined {
    if (!accountId) return undefined;
    return this.byId.get(accountId.toLowerCase());
  }

  /**
   * Resolves the account for a request. Falls back to the default account
   * when the header is missing or the id is unknown.
   */
  resolveOrDefault(accountId: string | undefined): AccountRuntime {
    const found = this.get(accountId);
    if (found) return found;
    return this.byId.get(this.defaultAccountId)!;
  }
}

/**
 * One-time migration from the legacy single-account layout:
 *   data/tokens.production.json  →  data/tokens.<defaultAccountId>.json
 *   data/tokens.default.json     →  data/tokens.<defaultAccountId>.json
 * Only runs if the default account is production AND has no tokens yet.
 */
export async function migrateLegacyTokens(multi: MultiConfig): Promise<void> {
  const defaultAccount = multi.accounts.find(
    (a) => a.accountId === multi.defaultAccountId,
  );
  if (!defaultAccount) return;
  if (defaultAccount.env !== 'production') return;

  const newPath = defaultAccount.tokenFile();
  if (fs.existsSync(newPath)) return;

  for (const legacyName of ['tokens.production.json', 'tokens.default.json']) {
    const legacyPath = path.join(multi.dataDir, legacyName);
    if (legacyPath === newPath) continue;
    if (!fs.existsSync(legacyPath)) continue;
    await fsp.rename(legacyPath, newPath);
    console.log(`[migrate] ${legacyName} → tokens.${defaultAccount.accountId}.json`);
    return;
  }
}
