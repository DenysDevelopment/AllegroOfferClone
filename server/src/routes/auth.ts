import { Router } from 'express';
import type { AccountRegistry } from '../core/registry.js';

const STATE_COOKIE_PREFIX = 'allegro_oauth_state_';
const ACCOUNT_COOKIE = 'allegro_oauth_account';

function stateCookieName(accountId: string): string {
  return `${STATE_COOKIE_PREFIX}${accountId}`;
}

export function authRouter(registry: AccountRegistry, opts?: { crmConfigured?: boolean }): Router {
  const r = Router();

  // Lightweight list of all configured accounts + connection state.
  r.get('/accounts', async (_req, res, next) => {
    try {
      const items = await Promise.all(
        registry.list().map(async (a) => ({
          id: a.config.accountId,
          label: a.config.label,
          env: a.config.env,
          hasCredentials: Boolean(a.config.clientId && a.config.clientSecret),
          connected: await a.oauth.isConnected(),
        })),
      );
      res.json({
        defaultAccountId: registry.defaultAccountId,
        accounts: items,
        crmConfigured: Boolean(opts?.crmConfigured),
      });
    } catch (e) {
      next(e);
    }
  });

  // Backwards-compat: /status returns the active (header-resolved or default) account.
  r.get('/status', async (req, res, next) => {
    try {
      const account = registry.resolveOrDefault(
        (req.header('x-account-id') ?? (req.query.account as string)) || undefined,
      );
      res.json({
        accountId: account.config.accountId,
        label: account.config.label,
        env: account.config.env,
        connected: await account.oauth.isConnected(),
        hasCredentials: Boolean(account.config.clientId && account.config.clientSecret),
        redirectUri: account.config.redirectUri,
      });
    } catch (e) {
      next(e);
    }
  });

  r.get('/login', (req, res) => {
    const accountId = String(req.query.account ?? '') || registry.defaultAccountId;
    const account = registry.get(accountId);
    if (!account) {
      return res.status(404).json({ error: 'UNKNOWN_ACCOUNT', accountId });
    }
    if (!account.config.clientId) {
      const key = account.config.accountId.toUpperCase();
      return res.status(400).json({
        error: 'MISSING_CREDENTIALS',
        message: `Set ALLEGRO_${key}_CLIENT_ID in .env`,
      });
    }
    const state = account.oauth.generateState();
    const cookieOpts = {
      httpOnly: true,
      sameSite: 'lax' as const,
      secure: req.protocol === 'https',
      maxAge: 10 * 60 * 1000,
    };
    res.cookie(stateCookieName(account.config.accountId), state, cookieOpts);
    res.cookie(ACCOUNT_COOKIE, account.config.accountId, cookieOpts);
    const url = account.oauth.buildAuthorizationUrl(state);
    res.json({ url });
  });

  r.get('/callback', async (req, res) => {
    const code = String(req.query.code ?? '');
    const state = String(req.query.state ?? '');
    const accountId = String(req.cookies?.[ACCOUNT_COOKIE] ?? '');
    const cookieState = accountId ? req.cookies?.[stateCookieName(accountId)] : undefined;

    res.clearCookie(ACCOUNT_COOKIE);
    if (accountId) res.clearCookie(stateCookieName(accountId));

    if (!code) {
      return redirectToFrontend(res, { ok: false, error: 'missing_code' });
    }
    if (!accountId) {
      return redirectToFrontend(res, { ok: false, error: 'missing_account_cookie' });
    }
    const account = registry.get(accountId);
    if (!account) {
      return redirectToFrontend(res, { ok: false, error: 'unknown_account' });
    }
    if (!cookieState || cookieState !== state) {
      return redirectToFrontend(res, { ok: false, error: 'state_mismatch' });
    }

    try {
      await account.oauth.exchangeCodeForTokens(code);
      return redirectToFrontend(res, { ok: true, accountId });
    } catch (err) {
      return redirectToFrontend(res, {
        ok: false,
        error: 'token_exchange_failed',
        message: (err as Error).message,
      });
    }
  });

  r.post('/disconnect', async (req, res, next) => {
    try {
      const accountId =
        (req.header('x-account-id') ?? (req.query.account as string)) ||
        registry.defaultAccountId;
      const account = registry.get(accountId);
      if (!account) {
        return res.status(404).json({ error: 'UNKNOWN_ACCOUNT', accountId });
      }
      await account.oauth.disconnect();
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });

  function redirectToFrontend(
    res: Parameters<Parameters<typeof r.get>[1]>[1],
    payload: { ok: boolean; error?: string; message?: string; accountId?: string },
  ): void {
    const params = new URLSearchParams();
    params.set('connected', payload.ok ? '1' : '0');
    if (payload.error) params.set('error', payload.error);
    if (payload.message) params.set('message', payload.message);
    if (payload.accountId) params.set('account', payload.accountId);
    res.redirect(`/?${params.toString()}`);
  }

  return r;
}
