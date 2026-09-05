import React, { useEffect, useState } from 'react';
import App from '../App';
import LoginScreen from './LoginScreen';
import {
  AuthConfig,
  AuthUser,
  fetchAuthConfig,
  fetchCurrentUser,
  consumeAuthError,
  logout as apiLogout,
} from '../services/googleAuthService';

type Phase = 'loading' | 'login' | 'authed' | 'misconfigured';

/**
 * Top-level authentication gate (server-side OAuth code flow).
 *
 *   /api/auth/config tells us:
 *   - authMisconfigured (prod without OAuth env)   → blocking error screen
 *   - authEnabled=true                              → require login
 *   - authEnabled=false (dev fallback only)         → open app immediately
 */
const AuthGate: React.FC = () => {
  const [phase, setPhase] = useState<Phase>('loading');
  const [config, setConfig] = useState<AuthConfig | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    setAuthError(consumeAuthError());

    (async () => {
      const cfg = await fetchAuthConfig();
      setConfig(cfg);

      if (cfg.authMisconfigured) {
        setPhase('misconfigured');
        return;
      }

      if (!cfg.authEnabled) {
        setPhase('authed'); // local dev only
        return;
      }

      const me = await fetchCurrentUser();
      if (me.user) {
        setUser(me.user);
        setPhase('authed');
      } else {
        setPhase('login');
      }
    })();
  }, []);

  const handleLogout = async () => {
    await apiLogout();
    setUser(null);
    setPhase('login');
  };

  if (phase === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="w-8 h-8 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
      </div>
    );
  }

  if (phase === 'misconfigured') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
        <div className="w-full max-w-lg bg-white rounded-2xl shadow-xl border border-rose-100 p-8 text-center">
          <div className="w-12 h-12 bg-rose-600 rounded-xl flex items-center justify-center mx-auto mb-5">
            <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h1 className="text-lg font-black tracking-tight text-slate-900">Авторизація не налаштована</h1>
          <p className="text-xs text-slate-500 mt-3 leading-relaxed">
            На цьому деплої не задані <code className="bg-slate-100 px-1.5 py-0.5 rounded text-rose-700">GOOGLE_CLIENT_ID</code> та <code className="bg-slate-100 px-1.5 py-0.5 rounded text-rose-700">GOOGLE_CLIENT_SECRET</code>.
            Програма заблокована до налаштування OAuth.
          </p>
          <p className="text-[10px] text-slate-400 mt-5 uppercase tracking-widest">Зверніться до адміністратора</p>
        </div>
      </div>
    );
  }

  if (phase === 'login' && config) {
    return <LoginScreen config={config} authError={authError} />;
  }

  return <App authUser={user} onLogout={config?.authEnabled ? handleLogout : undefined} />;
};

export default AuthGate;
