import * as dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

// Resolve .env from the project root (search upward from this file).
// Works for both dev (tsx watch) and prod (node dist/...) since both run from server/.
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

const schema = z.object({
  ALLEGRO_ENV: Env.default('sandbox'),
  ALLEGRO_SANDBOX_CLIENT_ID: z.string().optional(),
  ALLEGRO_SANDBOX_CLIENT_SECRET: z.string().optional(),
  ALLEGRO_PROD_CLIENT_ID: z.string().optional(),
  ALLEGRO_PROD_CLIENT_SECRET: z.string().optional(),
  PORT: z.coerce.number().default(3000),
  PUBLIC_URL: z.string().url().default('http://localhost:3000'),
  SESSION_SECRET: z.string().min(8).default('dev_secret_change_me_in_production'),
  DATA_DIR: z.string().default('./data'),
});

const parsed = schema.parse(process.env);

const ENDPOINTS = {
  sandbox: {
    auth: 'https://allegro.pl.allegrosandbox.pl',
    api: 'https://api.allegro.pl.allegrosandbox.pl',
  },
  production: {
    auth: 'https://allegro.pl',
    api: 'https://api.allegro.pl',
  },
} as const;

function credsFor(env: AllegroEnv): { clientId?: string; clientSecret?: string } {
  return env === 'sandbox'
    ? {
        clientId: parsed.ALLEGRO_SANDBOX_CLIENT_ID,
        clientSecret: parsed.ALLEGRO_SANDBOX_CLIENT_SECRET,
      }
    : {
        clientId: parsed.ALLEGRO_PROD_CLIENT_ID,
        clientSecret: parsed.ALLEGRO_PROD_CLIENT_SECRET,
      };
}

export function getConfig(envOverride?: AllegroEnv) {
  const env = envOverride ?? parsed.ALLEGRO_ENV;
  const creds = credsFor(env);
  return {
    env,
    authUrl: ENDPOINTS[env].auth,
    apiUrl: ENDPOINTS[env].api,
    clientId: creds.clientId,
    clientSecret: creds.clientSecret,
    redirectUri: `${parsed.PUBLIC_URL}/api/auth/callback`,
    publicUrl: parsed.PUBLIC_URL,
    port: parsed.PORT,
    sessionSecret: parsed.SESSION_SECRET,
    dataDir: path.resolve(parsed.DATA_DIR),
    tokenFile(forEnv: AllegroEnv = env) {
      return path.join(path.resolve(parsed.DATA_DIR), `tokens.${forEnv}.json`);
    },
  };
}

export type AppConfig = ReturnType<typeof getConfig>;
