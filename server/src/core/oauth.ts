import axios, { AxiosError } from 'axios';
import crypto from 'node:crypto';
import type { AppConfig } from '../config.js';
import { TokenStore, type TokenSet } from './tokens.js';

interface AllegroTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type?: string;
  scope?: string;
}

const SAFETY_WINDOW_MS = 60_000; // refresh 1 min before expiry

export class OAuthClient {
  constructor(
    private readonly cfg: AppConfig,
    private readonly store: TokenStore,
  ) {}

  private requireCredentials() {
    if (!this.cfg.clientId || !this.cfg.clientSecret) {
      const key = this.cfg.accountId.toUpperCase();
      throw new Error(
        `Allegro credentials are missing for account "${this.cfg.accountId}" (env=${this.cfg.env}). ` +
          `Set ALLEGRO_${key}_CLIENT_ID and ALLEGRO_${key}_CLIENT_SECRET in .env`,
      );
    }
    return { clientId: this.cfg.clientId, clientSecret: this.cfg.clientSecret };
  }

  private basicAuthHeader(): string {
    const { clientId, clientSecret } = this.requireCredentials();
    const encoded = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    return `Basic ${encoded}`;
  }

  /** Build the authorization URL the user needs to open in a browser. */
  buildAuthorizationUrl(state: string, scopes: string[] = []): string {
    const { clientId } = this.requireCredentials();
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: this.cfg.redirectUri,
      state,
    });
    if (scopes.length) params.set('scope', scopes.join(' '));
    return `${this.cfg.authUrl}/auth/oauth/authorize?${params.toString()}`;
  }

  /** Generate a random opaque state value for CSRF protection. */
  generateState(): string {
    return crypto.randomBytes(24).toString('hex');
  }

  /** Exchange the one-time code for a token set, store it, return it. */
  async exchangeCodeForTokens(code: string): Promise<TokenSet> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.cfg.redirectUri,
    });

    const { data } = await axios.post<AllegroTokenResponse>(
      `${this.cfg.authUrl}/auth/oauth/token`,
      body.toString(),
      {
        headers: {
          Authorization: this.basicAuthHeader(),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      },
    );

    const tokens: TokenSet = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + data.expires_in * 1000,
      scope: data.scope,
      tokenType: data.token_type,
      clientId: this.cfg.clientId,
    };
    await this.store.save(tokens);
    return tokens;
  }

  /** Refresh the access token using the stored refresh token. */
  async refresh(currentRefreshToken: string): Promise<TokenSet> {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: currentRefreshToken,
      redirect_uri: this.cfg.redirectUri,
    });

    try {
      const { data } = await axios.post<AllegroTokenResponse>(
        `${this.cfg.authUrl}/auth/oauth/token`,
        body.toString(),
        {
          headers: {
            Authorization: this.basicAuthHeader(),
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        },
      );

      const tokens: TokenSet = {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: Date.now() + data.expires_in * 1000,
        scope: data.scope,
        tokenType: data.token_type,
        clientId: this.cfg.clientId,
      };
      await this.store.save(tokens);
      return tokens;
    } catch (err) {
      const ax = err as AxiosError<{ error?: string; error_description?: string }>;
      const desc = ax.response?.data?.error_description || ax.response?.data?.error || ax.message;
      throw new Error(`Token refresh failed: ${desc}`);
    }
  }

  /**
   * Return a valid access token, refreshing if needed. Throws if no tokens
   * are stored (i.e. user has not connected yet).
   */
  async getAccessToken(): Promise<string> {
    const tokens = await this.store.load();
    if (!tokens) {
      throw new Error('NOT_CONNECTED');
    }
    if (tokens.clientId && tokens.clientId !== this.cfg.clientId) {
      // Credentials changed since the token was issued — invalidate.
      await this.store.clear();
      throw new Error('NOT_CONNECTED');
    }
    if (tokens.expiresAt - SAFETY_WINDOW_MS > Date.now()) {
      return tokens.accessToken;
    }
    const refreshed = await this.refresh(tokens.refreshToken);
    return refreshed.accessToken;
  }

  async isConnected(): Promise<boolean> {
    const tokens = await this.store.load();
    return Boolean(tokens && (!tokens.clientId || tokens.clientId === this.cfg.clientId));
  }

  async disconnect(): Promise<void> {
    await this.store.clear();
  }
}
