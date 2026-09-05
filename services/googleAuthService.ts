/**
 * Google Workspace authentication client (server-side OAuth 2.0 code flow).
 *
 * The browser never handles tokens directly — it just redirects to
 * `/api/auth/login`, the server does the Google handshake, enforces the
 * domain/email allow-list, and sets an HttpOnly session cookie.
 */

export interface AuthUser {
  email: string;
  name?: string;
  picture?: string;
  hd: string;
}

export interface AuthConfig {
  authEnabled: boolean;
  authMisconfigured?: boolean;
  allowedDomains: string[];
}

export const fetchAuthConfig = async (): Promise<AuthConfig> => {
  try {
    const res = await fetch('/api/auth/config');
    if (!res.ok) return { authEnabled: false, allowedDomains: [] };
    return await res.json();
  } catch {
    return { authEnabled: false, allowedDomains: [] };
  }
};

export const fetchCurrentUser = async (): Promise<{ authEnabled: boolean; user: AuthUser | null }> => {
  try {
    const res = await fetch('/api/auth/me');
    if (!res.ok) return { authEnabled: false, user: null };
    return await res.json();
  } catch {
    return { authEnabled: false, user: null };
  }
};

/** Starts the Google sign-in flow (full-page redirect). */
export const startGoogleLogin = () => {
  window.location.href = '/api/auth/login';
};

export const logout = async (): Promise<void> => {
  try {
    await fetch('/api/auth/logout', { method: 'POST' });
  } catch {
    // ignore
  }
};

/** Reads & clears the `?auth_error=` query param set by the OAuth callback on failure. */
export const consumeAuthError = (): string | null => {
  const params = new URLSearchParams(window.location.search);
  const err = params.get('auth_error');
  if (err) {
    params.delete('auth_error');
    const qs = params.toString();
    window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : ''));
  }
  return err;
};
