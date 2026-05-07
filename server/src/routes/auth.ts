import { Router } from 'express';
import type { OAuthClient } from '../core/oauth.js';
import type { AppConfig } from '../config.js';

const STATE_COOKIE = 'allegro_oauth_state';

export function authRouter(cfg: AppConfig, oauth: OAuthClient): Router {
  const r = Router();

  r.get('/status', async (_req, res) => {
    res.json({
      env: cfg.env,
      connected: await oauth.isConnected(),
      hasCredentials: Boolean(cfg.clientId && cfg.clientSecret),
      redirectUri: cfg.redirectUri,
    });
  });

  r.get('/login', (req, res) => {
    if (!cfg.clientId) {
      return res.status(400).json({
        error: 'MISSING_CREDENTIALS',
        message: `Set ALLEGRO_${cfg.env === 'sandbox' ? 'SANDBOX' : 'PROD'}_CLIENT_ID in .env`,
      });
    }
    const state = oauth.generateState();
    res.cookie(STATE_COOKIE, state, {
      httpOnly: true,
      sameSite: 'lax',
      secure: req.protocol === 'https',
      maxAge: 10 * 60 * 1000,
    });
    const url = oauth.buildAuthorizationUrl(state);
    res.json({ url });
  });

  r.get('/callback', async (req, res) => {
    const code = String(req.query.code ?? '');
    const state = String(req.query.state ?? '');
    const cookieState = req.cookies?.[STATE_COOKIE];
    res.clearCookie(STATE_COOKIE);

    if (!code) {
      return redirectToFrontend(res, { ok: false, error: 'missing_code' });
    }
    if (!cookieState || cookieState !== state) {
      return redirectToFrontend(res, { ok: false, error: 'state_mismatch' });
    }

    try {
      await oauth.exchangeCodeForTokens(code);
      return redirectToFrontend(res, { ok: true });
    } catch (err) {
      return redirectToFrontend(res, {
        ok: false,
        error: 'token_exchange_failed',
        message: (err as Error).message,
      });
    }
  });

  r.post('/disconnect', async (_req, res) => {
    await oauth.disconnect();
    res.json({ ok: true });
  });

  function redirectToFrontend(
    res: Parameters<Parameters<typeof r.get>[1]>[1],
    payload: { ok: boolean; error?: string; message?: string },
  ): void {
    const params = new URLSearchParams();
    params.set('connected', payload.ok ? '1' : '0');
    if (payload.error) params.set('error', payload.error);
    if (payload.message) params.set('message', payload.message);
    res.redirect(`/?${params.toString()}`);
  }

  return r;
}
