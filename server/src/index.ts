import express, { type ErrorRequestHandler } from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadMultiConfig } from './config.js';
import { AccountRegistry, migrateLegacyTokens } from './core/registry.js';
import { AllegroApiError } from './core/allegro.js';
import { CrmApiError } from './core/crm.js';
import { authRouter } from './routes/auth.js';
import { apiRouter } from './routes/api.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  const multi = loadMultiConfig();
  await migrateLegacyTokens(multi);
  const registry = new AccountRegistry(multi);

  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '10mb' }));
  app.use(cookieParser(multi.sessionSecret));

  // CORS only matters in dev when frontend runs on a different port
  if (process.env.NODE_ENV !== 'production') {
    app.use(cors({ origin: true, credentials: true }));
  }

  app.use('/api/auth', authRouter(registry, { crmConfigured: Boolean(multi.crm) }));
  app.use('/api', apiRouter(registry, multi.dataDir, multi.crm));

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      defaultAccountId: registry.defaultAccountId,
      accounts: registry.list().map((a) => ({
        id: a.config.accountId,
        env: a.config.env,
      })),
      time: new Date().toISOString(),
    });
  });

  // Static frontend (production build)
  const webDist = path.resolve(__dirname, '../../web/dist');
  if (fs.existsSync(webDist)) {
    app.use(express.static(webDist));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api')) return next();
      res.sendFile(path.join(webDist, 'index.html'));
    });
  } else {
    app.get('/', (_req, res) => {
      res.type('text/plain').send(
        'Web bundle not built yet.\n' +
          'In dev: run `npm run dev` (server + Vite together).\n' +
          'In prod: run `npm run build` to produce web/dist, then `npm start`.',
      );
    });
  }

  const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
    if (err instanceof AllegroApiError) {
      console.error('[allegro]', err.status, err.message, err.body);
      return res.status(err.status).json({
        error: 'ALLEGRO',
        status: err.status,
        message: err.message,
        body: err.body,
      });
    }
    if (err instanceof CrmApiError) {
      console.error('[crm]', err.status, err.message, err.body);
      return res.status(err.status).json({
        error: 'CRM',
        status: err.status,
        message: err.message,
        body: err.body,
      });
    }
    if ((err as Error).message === 'NOT_CONNECTED') {
      return res.status(401).json({
        error: 'NOT_CONNECTED',
        message: 'Connect to Allegro first',
      });
    }
    console.error('[server]', err);
    res.status(500).json({
      error: 'INTERNAL',
      message: (err as Error).message ?? 'Unknown error',
    });
  };
  app.use(errorHandler);

  app.listen(multi.port, () => {
    console.log(`Allegro Clone server listening on ${multi.publicUrl}`);
    for (const a of registry.list()) {
      const status = a.config.clientId ? 'creds OK' : '⚠ no CLIENT_ID';
      console.log(`  • account "${a.config.accountId}" (${a.config.label}, env=${a.config.env}) — ${status}`);
    }
  });
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
