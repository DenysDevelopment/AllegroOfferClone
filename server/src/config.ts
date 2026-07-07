import * as dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

// Resolve .env from the project root (search upward from this file).
function findEnvFile(): string | undefined {
  const here = path.dirname(fileURLToPath(import.meta.url));
  let dir = here;
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, '.env');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

const envFile = findEnvFile();
if (envFile) {
  dotenv.config({ path: envFile });
}

const Env = z.enum(['sandbox', 'production']);
export type AllegroEnv = z.infer<typeof Env>;

const globalSchema = z.object({
  PORT: z.coerce.number().default(3000),
  PUBLIC_URL: z.string().url().default('http://localhost:3000'),
  SESSION_SECRET: z.string().min(8).default('dev_secret_change_me_in_production'),
  DATA_DIR: z.string().default('./data'),
  ALLEGRO_ENV: Env.default('sandbox'),
  ALLEGRO_ACCOUNTS: z.string().optional(),
  ALLEGRO_SANDBOX_CLIENT_ID: z.string().optional(),
  ALLEGRO_SANDBOX_CLIENT_SECRET: z.string().optional(),
  ALLEGRO_PROD_CLIENT_ID: z.string().optional(),
  ALLEGRO_PROD_CLIENT_SECRET: z.string().optional(),
  CRM_API_URL: z.preprocess((v) => (v === '' ? undefined : v), z.string().url().optional()),
  CRM_API_KEY: z.string().optional(),
});

const parsedGlobals = globalSchema.parse(process.env);

export function deriveCrmConfig(env: {
  CRM_API_URL?: string;
  CRM_API_KEY?: string;
}): { apiUrl: string; apiKey: string } | undefined {
  if (env.CRM_API_URL && env.CRM_API_KEY) {
    return { apiUrl: env.CRM_API_URL, apiKey: env.CRM_API_KEY };
  }
  return undefined;
}

const ENDPOINTS = {
  sandbox: {
    auth: 'https://allegro.pl.allegrosandbox.pl',
    api: 'https://api.allegro.pl.allegrosandbox.pl',
    upload: 'https://upload.allegro.pl.allegrosandbox.pl',
  },
  production: {
    auth: 'https://allegro.pl',
    api: 'https://api.allegro.pl',
    upload: 'https://upload.allegro.pl',
  },
} as const;

const ACCOUNT_ID_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/i;

export interface AccountConfig {
  accountId: string;
  label: string;
  env: AllegroEnv;
  authUrl: string;
  apiUrl: string;
  uploadUrl: string;
  clientId?: string;
  clientSecret?: string;
  redirectUri: string;
  publicUrl: string;
  port: number;
  sessionSecret: string;
  dataDir: string;
  tokenFile(): string;
}

// Backwards-compat alias — most modules still type their cfg arg as AppConfig.
export type AppConfig = AccountConfig;

export interface MultiConfig {
  port: number;
  publicUrl: string;
  sessionSecret: string;
  dataDir: string;
  defaultAccountId: string;
  accounts: AccountConfig[];
  crm?: { apiUrl: string; apiKey: string };
}

function buildAccount(args: {
  accountId: string;
  label: string;
  env: AllegroEnv;
  clientId?: string;
  clientSecret?: string;
}): AccountConfig {
  const { accountId, label, env, clientId, clientSecret } = args;
  const dataDir = path.resolve(parsedGlobals.DATA_DIR);
  return {
    accountId,
    label,
    env,
    authUrl: ENDPOINTS[env].auth,
    apiUrl: ENDPOINTS[env].api,
    uploadUrl: ENDPOINTS[env].upload,
    clientId,
    clientSecret,
    redirectUri: `${parsedGlobals.PUBLIC_URL}/api/auth/callback`,
    publicUrl: parsedGlobals.PUBLIC_URL,
    port: parsedGlobals.PORT,
    sessionSecret: parsedGlobals.SESSION_SECRET,
    dataDir,
    tokenFile() {
      return path.join(dataDir, `tokens.${accountId}.json`);
    },
  };
}

function readPerAccount(id: string): {
  label?: string;
  env?: AllegroEnv;
  clientId?: string;
  clientSecret?: string;
} {
  const key = id.toUpperCase();
  const env = process.env[`ALLEGRO_${key}_ENV`];
  return {
    label: process.env[`ALLEGRO_${key}_LABEL`],
    env: env === 'sandbox' || env === 'production' ? env : undefined,
    clientId: process.env[`ALLEGRO_${key}_CLIENT_ID`],
    clientSecret: process.env[`ALLEGRO_${key}_CLIENT_SECRET`],
  };
}

function loadFromAccountsList(rawList: string): AccountConfig[] {
  const ids = rawList
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (ids.length === 0) return [];
  const seen = new Set<string>();
  const accounts: AccountConfig[] = [];
  for (const id of ids) {
    if (!ACCOUNT_ID_RE.test(id)) {
      throw new Error(
        `Invalid ALLEGRO_ACCOUNTS entry "${id}". Use [a-zA-Z0-9_-], max 32 chars, must start with alphanumeric.`,
      );
    }
    const normalized = id.toLowerCase();
    if (seen.has(normalized)) {
      throw new Error(`Duplicate account id "${id}" in ALLEGRO_ACCOUNTS`);
    }
    seen.add(normalized);
    const per = readPerAccount(id);
    accounts.push(
      buildAccount({
        accountId: normalized,
        label: per.label || id,
        env: per.env ?? parsedGlobals.ALLEGRO_ENV,
        clientId: per.clientId,
        clientSecret: per.clientSecret,
      }),
    );
  }
  return accounts;
}

function loadLegacySingleAccount(): AccountConfig {
  const env = parsedGlobals.ALLEGRO_ENV;
  return buildAccount({
    accountId: 'default',
    label: 'Default',
    env,
    clientId:
      env === 'sandbox'
        ? parsedGlobals.ALLEGRO_SANDBOX_CLIENT_ID
        : parsedGlobals.ALLEGRO_PROD_CLIENT_ID,
    clientSecret:
      env === 'sandbox'
        ? parsedGlobals.ALLEGRO_SANDBOX_CLIENT_SECRET
        : parsedGlobals.ALLEGRO_PROD_CLIENT_SECRET,
  });
}

let cached: MultiConfig | null = null;

export function loadMultiConfig(): MultiConfig {
  if (cached) return cached;
  const accounts = parsedGlobals.ALLEGRO_ACCOUNTS
    ? loadFromAccountsList(parsedGlobals.ALLEGRO_ACCOUNTS)
    : [loadLegacySingleAccount()];
  if (accounts.length === 0) {
    throw new Error(
      'No Allegro accounts configured. Set ALLEGRO_ACCOUNTS in .env (or use legacy single-account vars).',
    );
  }
  cached = {
    port: parsedGlobals.PORT,
    publicUrl: parsedGlobals.PUBLIC_URL,
    sessionSecret: parsedGlobals.SESSION_SECRET,
    dataDir: path.resolve(parsedGlobals.DATA_DIR),
    defaultAccountId: accounts[0].accountId,
    accounts,
    crm: deriveCrmConfig(parsedGlobals),
  };
  return cached;
}

/**
 * Legacy helper, kept for tests / scripts that expected a single AppConfig.
 * Returns the default (first) account.
 */
export function getConfig(envOverride?: AllegroEnv): AppConfig {
  const multi = loadMultiConfig();
  if (envOverride) {
    const match = multi.accounts.find((a) => a.env === envOverride);
    if (match) return match;
  }
  return multi.accounts.find((a) => a.accountId === multi.defaultAccountId) ?? multi.accounts[0];
}
