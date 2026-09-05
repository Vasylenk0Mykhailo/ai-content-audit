import React from 'react';
import { AuthConfig, startGoogleLogin } from '../services/googleAuthService';

interface LoginScreenProps {
  config: AuthConfig;
  authError?: string | null;
}

const LoginScreen: React.FC<LoginScreenProps> = ({ config: _config, authError }) => {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-slate-100 p-10 text-center">

        {/* Brand block: L5 horizontal lock-up — [star] [netpeak] | POWERED BY AI SOLUTIONS */}
        <div className="flex items-center justify-center gap-4 mb-10">
          <img src="/netpeak-footer-star.png" alt="Netpeak" className="h-12 w-12 shrink-0" />
          <span
            className="leading-none"
            style={{
              color: '#29abe2',
              fontFamily: "'Inter', sans-serif",
              fontWeight: 900,
              fontSize: '28px',
              letterSpacing: '-0.01em',
            }}
          >
            netpeak
          </span>
          <span className="w-px h-7 bg-slate-200" aria-hidden />
          <p
            className="text-[10px] font-bold uppercase leading-tight"
            style={{
              color: '#334155',
              fontFamily: "'Inter', sans-serif",
              letterSpacing: '0.2em',
              margin: 0,
            }}
          >
            Powered by<br/>AI Solutions
          </p>
        </div>

        <button
          onClick={startGoogleLogin}
          className="w-full flex items-center justify-center gap-3 py-3 px-4 bg-white border border-slate-300 rounded-xl shadow-sm hover:bg-slate-50 hover:border-slate-400 transition-all font-semibold text-sm text-slate-700 active:scale-[0.98]"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" />
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
          </svg>
          Увійти через Google
        </button>

        {authError && (
          <div className="mt-5 text-xs text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2.5 text-left">
            {authError}
          </div>
        )}

        <p className="text-[10px] text-slate-400 mt-6 leading-relaxed">
          AI can make mistakes. Check important info.
        </p>
      </div>
    </div>
  );
};

export default LoginScreen;
