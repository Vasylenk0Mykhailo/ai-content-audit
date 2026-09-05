import "dotenv/config";
import express, { type Request, type Response, type NextFunction } from "express";
import path from "path";
import crypto from "crypto";
import axios from "axios";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import { OAuth2Client } from "google-auth-library";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI, Type } from "@google/genai";
import { SecretManagerServiceClient } from "@google-cloud/secret-manager";
import { jsonrepair } from "jsonrepair";
import { HttpsProxyAgent } from "https-proxy-agent";
import { SocksProxyAgent } from "socks-proxy-agent";
import * as cheerio from "cheerio";
import TurndownService from "turndown";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

puppeteer.use(StealthPlugin());

// ───────────────────────── Auth / Workspace domain restriction ───────────────
// Only Google accounts whose hosted domain (the `hd` claim) is in this list may
// use the app. Override via the ALLOWED_AUTH_DOMAINS env var (comma-separated).
const ALLOWED_DOMAINS = (process.env.ALLOWED_AUTH_DOMAINS || 'netpeak.net,netpeak.group')
  .split(',')
  .map((d) => d.trim().toLowerCase())
  .filter(Boolean);

// Explicit per-email allow-list for users who need access but are NOT on an
// allowed Workspace domain (contractors, external collaborators, cross-org
// accounts). Comma-separated, case-insensitive. Either an allowed domain OR an
// allow-listed email grants access.
const ALLOWED_EMAILS = (process.env.ALLOWED_AUTH_EMAILS || '')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

const SESSION_COOKIE = 'ca_session';
const SESSION_TTL_SECONDS = 12 * 60 * 60; // 12h

interface SessionUser {
  email: string;
  name?: string;
  picture?: string;
  hd: string;
}

// ───────────────────────── Gemini structured-output schemas ───────────────────
const analysisSchema = {
  type: Type.OBJECT,
  properties: {
    seoScore: { type: Type.NUMBER },
    eeatScore: { type: Type.NUMBER },
    llmOptimizationScore: { type: Type.NUMBER },
    isYMYL: { type: Type.BOOLEAN },
    summary: { type: Type.STRING },
    strengths: { type: Type.ARRAY, items: { type: Type.STRING } },
    weaknesses: { type: Type.ARRAY, items: { type: Type.STRING } },
    recommendations: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          category: { type: Type.STRING },
          priority: { type: Type.STRING },
          action: { type: Type.STRING },
          description: { type: Type.STRING },
          affectedContent: { type: Type.STRING },
          fixSteps: { type: Type.ARRAY, items: { type: Type.STRING } },
          expectedImpact: { type: Type.STRING },
        },
        required: ['category', 'priority', 'action', 'description', 'affectedContent', 'fixSteps', 'expectedImpact'],
      },
    },
    keywordGaps: { type: Type.ARRAY, items: { type: Type.STRING } },
    lsiKeywords: { type: Type.ARRAY, items: { type: Type.STRING } },
    llmEntities: { type: Type.ARRAY, items: { type: Type.STRING } },
    sentiment: {
      type: Type.OBJECT,
      properties: {
        label: { type: Type.STRING },
        score: { type: Type.NUMBER },
        explanation: { type: Type.STRING },
      },
      required: ['label', 'score', 'explanation'],
    },
  },
  required: ['seoScore', 'eeatScore', 'llmOptimizationScore', 'isYMYL', 'summary', 'strengths', 'weaknesses', 'recommendations', 'lsiKeywords', 'llmEntities', 'sentiment'],
};

const bulkSummarySchema = {
  type: Type.OBJECT,
  properties: {
    overallScore: { type: Type.NUMBER },
    domainAuthorityEstimate: { type: Type.STRING },
    coreOpportunities: { type: Type.ARRAY, items: { type: Type.STRING } },
    topCriticalFixes: { type: Type.ARRAY, items: { type: Type.STRING } },
    strategicAdvice: { type: Type.STRING },
    strategicPillars: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          description: { type: Type.STRING },
        },
        required: ['title', 'description'],
      },
    },
    technicalRoadmap: { type: Type.ARRAY, items: { type: Type.STRING } },
    contentGapAnalysis: { type: Type.STRING },
  },
  required: ['overallScore', 'domainAuthorityEstimate', 'coreOpportunities', 'topCriticalFixes', 'strategicAdvice', 'strategicPillars', 'technicalRoadmap', 'contentGapAnalysis'],
};

// ───────────────────────── Secret Manager loader ──────────────────────────────
/**
 * Resolves a secret from Google Cloud Secret Manager.
 * Falls back to an environment variable (useful for local development).
 * Cloud Run uses Application Default Credentials — no service-account JSON needed.
 *
 * Always `.trim()`s the result: secret payloads created via the Cloud Console
 * UI or from text files often carry a trailing newline that breaks bearer-token
 * style auth headers (e.g. Anthropic returns 401 "invalid x-api-key").
 */
async function getSecret(secretResourceName: string | undefined, fallbackEnvKey: string): Promise<string> {
  if (secretResourceName && secretResourceName.startsWith('projects/')) {
    try {
      const client = new SecretManagerServiceClient();
      const [version] = await client.accessSecretVersion({ name: secretResourceName });
      const data = version.payload?.data;
      const raw = data ? Buffer.from(data).toString('utf-8') : '';
      const value = raw.trim();
      if (value) {
        console.log(`[SecretManager] Loaded "${fallbackEnvKey}" from ${secretResourceName} (len=${value.length})`);
        return value;
      }
      console.warn(`[SecretManager] ${secretResourceName} resolved to an empty payload.`);
    } catch (e: any) {
      console.warn(`[SecretManager] Failed to fetch ${secretResourceName}: ${e.message}. Falling back to env "${fallbackEnvKey}".`);
    }
  }
  return (process.env[fallbackEnvKey] || '').trim();
}

// ───────────────────────── Provider initialisation ────────────────────────────
type Providers = {
  openai: OpenAI | null;
  anthropic: Anthropic | null;
  gemini: GoogleGenAI | null;
};

async function initProviders(): Promise<Providers> {
  const [openAIKey, anthropicKey, geminiKey] = await Promise.all([
    getSecret(process.env.OPENAI_SECRET_NAME, 'OPENAI_API_KEY'),
    getSecret(process.env.ANTHROPIC_SECRET_NAME, 'ANTHROPIC_API_KEY'),
    getSecret(process.env.GEMINI_SECRET_NAME, 'GEMINI_API_KEY'),
  ]);

  return {
    openai: openAIKey ? new OpenAI({ apiKey: openAIKey, timeout: 1_800_000 }) : null,
    // Long-running Anthropic requests (Opus 4.7/4.8 + High effort, or Sonnet
    // 4.6 + High thinking on a 30K-token prompt) can take 10+ minutes. The
    // SDK's default timeout (10 min) was too tight — set to 30 minutes here
    // AND override per-request below (see runClaudeStreamed). `maxRetries: 0`
    // because retrying a 10-minute call costs another 10 minutes and the
    // most common failure mode (network blip during streaming) is not safely
    // retryable on a stateful SSE response.
    anthropic: anthropicKey ? new Anthropic({ apiKey: anthropicKey, timeout: 1_800_000, maxRetries: 0 }) : null,
    gemini: geminiKey ? new GoogleGenAI({ apiKey: geminiKey }) : null,
  };
}

/** Sends a uniform 503 when a provider is not configured. */
function notConfigured(res: Response, provider: 'openai' | 'claude' | 'gemini'): Response {
  return res.status(503).json({
    error: `${provider} provider is not configured on this deployment. Set the corresponding *_SECRET_NAME or *_API_KEY env variable.`,
    provider,
    available: false,
  });
}

/**
 * Best-effort JSON extraction for providers that don't natively return JSON
 * (Claude). First tries strict parse; on failure, runs `jsonrepair` which
 * handles trailing commas, unclosed brackets, unescaped newlines and other
 * common LLM JSON mistakes that crash JSON.parse on long outputs.
 */
function extractJson(text: string): any {
  const fenced = text.match(/```json\s*([\s\S]*?)\s*```/);
  const candidate = fenced ? fenced[1] : (text.match(/(\{[\s\S]*\})/)?.[1] ?? text);
  try {
    return JSON.parse(candidate);
  } catch (e) {
    try {
      return JSON.parse(jsonrepair(candidate));
    } catch (e2: any) {
      throw new Error(`Failed to parse LLM JSON output: ${e2.message}`);
    }
  }
}

// ─────────────────────────────── Bootstrap ────────────────────────────────────
async function startServer() {
  const PORT = parseInt(process.env.PORT || '8080', 10);
  const isProd = process.env.NODE_ENV === 'production';

  const providers = await initProviders();
  console.log(`[Providers] OpenAI=${!!providers.openai} | Claude=${!!providers.anthropic} | Gemini=${!!providers.gemini}`);

  // ─── Telegram error reporter ─────────────────────────────────────────────
  // When TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are set, server-side errors
  // are mirrored to a Telegram chat. Fire-and-forget — never blocks the request.
  const telegramBotToken = await getSecret(process.env.TELEGRAM_BOT_TOKEN_SECRET_NAME, 'TELEGRAM_BOT_TOKEN');
  const telegramChatId = await getSecret(process.env.TELEGRAM_CHAT_ID_SECRET_NAME, 'TELEGRAM_CHAT_ID');
  const telegramEnabled = !!telegramBotToken && !!telegramChatId;
  console.log(`[Telegram] reporter enabled=${telegramEnabled}`);

  /**
   * Sends a plain-text message to the configured Telegram chat.
   * IMPORTANT: the bot can only message users who have already opened a
   * conversation with it (sent /start). Otherwise Telegram returns
   * 403 "Forbidden: bot can't initiate conversation with a user".
   */
  const notifyTelegram = async (subject: string, details: string): Promise<boolean> => {
    if (!telegramEnabled) {
      console.log('[Telegram] skipped (not enabled):', subject);
      return false;
    }
    const text = ['🚨 ContentAudit AI', subject, '', details].join('\n').slice(0, 4000);
    try {
      const res = await axios.post(
        `https://api.telegram.org/bot${telegramBotToken}/sendMessage`,
        { chat_id: telegramChatId, text, disable_web_page_preview: true },
        { timeout: 5000 },
      );
      console.log(`[Telegram] sent OK (chat=${telegramChatId}, len=${text.length}, msg_id=${res.data?.result?.message_id ?? '—'}): ${subject}`);
      return true;
    } catch (e: any) {
      const resp = e?.response?.data;
      console.warn(
        `[Telegram] FAILED (chat=${telegramChatId}, http=${e?.response?.status ?? '—'}): ${e.message}`,
        resp ? JSON.stringify(resp) : '',
      );
      return false;
    }
  };

  // Startup self-test: try delivering one boot message. Reveals chat_id issues
  // immediately in Cloud Run logs, no need to wait for the first real audit.
  if (telegramEnabled) {
    notifyTelegram(
      '🚀 Service started',
      [
        `Revision: ${process.env.K_REVISION || 'dev'}`,
        `Project: ${process.env.GOOGLE_CLOUD_PROJECT || '—'}`,
        `Bot chat_id: ${telegramChatId}`,
      ].join('\n'),
    );
  }

  // ─── Auth bootstrap (server-side OAuth 2.0 Authorization Code flow) ─────────
  const googleClientId = await getSecret(process.env.GOOGLE_CLIENT_ID_SECRET_NAME, 'GOOGLE_CLIENT_ID');
  const googleClientSecret = await getSecret(process.env.GOOGLE_CLIENT_SECRET_SECRET_NAME, 'GOOGLE_CLIENT_SECRET');
  let sessionSecret = await getSecret(process.env.SESSION_SECRET_NAME, 'SESSION_SECRET');

  // Auth is enabled when both Client ID and Client Secret are present.
  // In production we additionally REFUSE to expose the app open: missing config
  // turns into a hard misconfig state that locks every protected route.
  const authEnabled = !!googleClientId && !!googleClientSecret;
  const authMisconfigured = isProd && !authEnabled;

  if (googleClientId && !googleClientSecret) {
    console.error('[Auth] GOOGLE_CLIENT_ID is set but GOOGLE_CLIENT_SECRET is missing.');
  }
  if (authMisconfigured) {
    console.error('[Auth] PRODUCTION DEPLOYMENT IS RUNNING WITHOUT OAUTH CONFIG.');
    console.error('[Auth] All API routes (except /api/health) will return 503 until GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET are set.');
  }

  if (authEnabled && !sessionSecret) {
    sessionSecret = crypto.randomBytes(32).toString('hex');
    console.warn('[Auth] SESSION_SECRET not set — using an ephemeral secret. Sessions reset on restart and break across instances. Set SESSION_SECRET for production.');
  }

  const STATE_COOKIE = 'ca_oauth_state';

  /** Absolute callback URL. Prefer explicit OAUTH_REDIRECT_URI, else derive from request. */
  const redirectUriFor = (req: Request): string => {
    if (process.env.OAUTH_REDIRECT_URI) return process.env.OAUTH_REDIRECT_URI;
    // `trust proxy` makes req.protocol respect x-forwarded-proto on Cloud Run.
    return `${req.protocol}://${req.get('host')}/api/auth/callback`;
  };

  const makeOAuthClient = (req: Request) =>
    new OAuth2Client({ clientId: googleClientId, clientSecret: googleClientSecret, redirectUri: redirectUriFor(req) });

  console.log(`[Auth] enabled=${authEnabled} | misconfigured=${authMisconfigured} | allowedDomains=[${ALLOWED_DOMAINS.join(', ')}] | allowedEmails=${ALLOWED_EMAILS.length}`);
  if (process.env.OAUTH_REDIRECT_URI) {
    console.log(`[Auth] redirect URI (explicit OAUTH_REDIRECT_URI): ${process.env.OAUTH_REDIRECT_URI}`);
  } else {
    console.log('[Auth] redirect URI will be derived from request host as ${protocol}://${host}/api/auth/callback');
    console.log('[Auth] Make sure that URL is added to Authorized redirect URIs in your Google OAuth client.');
  }

  /** Issues a signed session JWT and sets it as an HttpOnly cookie. */
  const issueSession = (res: Response, user: SessionUser) => {
    const token = jwt.sign(user, sessionSecret, { expiresIn: SESSION_TTL_SECONDS });
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: isProd,
      sameSite: 'lax',
      maxAge: SESSION_TTL_SECONDS * 1000,
      path: '/',
    });
  };

  /** Returns the verified session user, or null. */
  const readSession = (req: Request): SessionUser | null => {
    const token = req.cookies?.[SESSION_COOKIE];
    if (!token) return null;
    try {
      const payload = jwt.verify(token, sessionSecret) as SessionUser & { iat: number; exp: number };
      return { email: payload.email, name: payload.name, picture: payload.picture, hd: payload.hd };
    } catch {
      return null;
    }
  };

  /**
   * Express guard. Behaviour:
   *   - production + no OAuth config  → 503 (deployment misconfigured, blocks ALL functionality)
   *   - auth enabled + no session     → 401 (user must log in)
   *   - auth enabled + valid session  → next()
   *   - auth disabled (dev only)      → next()
   */
  const requireAuth = (req: Request, res: Response, next: NextFunction) => {
    if (authMisconfigured) {
      return res.status(503).json({
        error: 'Deployment is missing OAuth configuration. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.',
        authMisconfigured: true,
      });
    }
    if (!authEnabled) return next();
    const user = readSession(req);
    if (!user) return res.status(401).json({ error: 'Authentication required', authRequired: true });
    (req as any).user = user;
    next();
  };

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true);
  app.use(express.json({ limit: '50mb' }));
  app.use(cookieParser());

  // ─── Auth endpoints ───────────────────────────────────────────────────────
  app.get('/api/auth/config', (_req, res) => {
    res.json({ authEnabled, authMisconfigured, allowedDomains: ALLOWED_DOMAINS });
  });

  // Step 1 — redirect the browser to Google's consent screen.
  app.get('/api/auth/login', (req, res) => {
    if (!authEnabled) return res.status(503).send('Authentication is not configured on this deployment.');

    const state = crypto.randomBytes(16).toString('hex');
    // Sign the state into a short-lived cookie for CSRF protection.
    const stateToken = jwt.sign({ state }, sessionSecret, { expiresIn: 600 });
    res.cookie(STATE_COOKIE, stateToken, { httpOnly: true, secure: isProd, sameSite: 'lax', maxAge: 600_000, path: '/' });

    const url = makeOAuthClient(req).generateAuthUrl({
      access_type: 'online',
      scope: ['openid', 'email', 'profile'],
      state,
      prompt: 'select_account',
      // UX hint when a single Workspace domain is configured (server still enforces).
      hd: ALLOWED_DOMAINS.length === 1 ? ALLOWED_DOMAINS[0] : undefined,
    });
    res.redirect(url);
  });

  // Step 2 — Google redirects back here with ?code & ?state.
  app.get('/api/auth/callback', async (req, res) => {
    const fail = (msg: string) => res.redirect(`/?auth_error=${encodeURIComponent(msg)}`);
    try {
      if (!authEnabled) return res.status(503).send('Authentication is not configured.');

      const { code, state } = req.query as { code?: string; state?: string };
      if (!code) return fail('Не отримано код авторизації від Google.');

      // Verify CSRF state.
      const stateToken = req.cookies?.[STATE_COOKIE];
      res.clearCookie(STATE_COOKIE, { path: '/' });
      let expectedState = '';
      try { expectedState = (jwt.verify(stateToken, sessionSecret) as any).state; } catch { /* invalid */ }
      if (!state || !expectedState || state !== expectedState) return fail('Невірний state (можлива CSRF-атака). Спробуйте ще раз.');

      const client = makeOAuthClient(req);
      const { tokens } = await client.getToken(code);
      if (!tokens.id_token) return fail('Google не повернув ID-токен.');

      const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: googleClientId });
      const payload = ticket.getPayload();
      if (!payload?.email) return fail('Невірний токен Google.');

      const email = payload.email.toLowerCase();
      const hd = (payload.hd || email.split('@')[1] || '').toLowerCase();

      if (!payload.email_verified) return fail('Email не підтверджено Google.');

      const allowed = ALLOWED_DOMAINS.includes(hd) || ALLOWED_EMAILS.includes(email);
      if (!allowed) {
        console.warn(`[Auth] Rejected login from ${email} (domain "${hd}" not allowed).`);
        notifyTelegram('Login rejected (domain not allowed)', `Email: ${email}\nDomain: ${hd}\nAllowed domains: ${ALLOWED_DOMAINS.join(', ')}`);
        return fail(`Доступ дозволено лише для акаунтів доменів: ${ALLOWED_DOMAINS.join(', ')}. Ваш акаунт: ${email}.`);
      }

      issueSession(res, { email: payload.email, name: payload.name, picture: payload.picture, hd });
      console.log(`[Auth] Login OK: ${email} (${hd})`);
      res.redirect('/');
    } catch (e: any) {
      console.warn('[Auth] Callback failed:', e.message);
      fail('Помилка авторизації. Спробуйте ще раз.');
    }
  });

  app.get('/api/auth/me', (req, res) => {
    if (!authEnabled) return res.json({ authEnabled: false, user: null });
    res.json({ authEnabled: true, user: readSession(req) });
  });

  // Manual Telegram ping — open https://<url>/api/notify/test in your browser
  // (logged in). Shows exactly whether delivery works and what Telegram says.
  app.get('/api/notify/test', requireAuth, async (req, res) => {
    const user = (req as any).user;
    const userEmail = user?.email || 'anonymous';
    const delivered = await notifyTelegram(
      '🧪 Telegram delivery test',
      `Triggered by: ${userEmail}\nRevision: ${process.env.K_REVISION || 'dev'}`,
    );
    res.json({
      ok: true,
      delivered,
      telegramEnabled,
      chatIdLength: telegramChatId.length,
      hint: delivered
        ? 'Check your Telegram chat with the bot — message should be there.'
        : 'Telegram API rejected. Check Cloud Run logs for [Telegram] FAILED line. Most likely chat_id is the bot ID instead of your personal user ID, OR you haven\'t sent /start to the bot.',
    });
  });

  // ─── Telegram audit-complete notification ────────────────────────────────
  // Called by the SPA after each URL audit finishes.
  app.post('/api/notify/audit-complete', requireAuth, async (req, res) => {
    const { url, scores, model, durationMs, error } = req.body || {};
    const user = (req as any).user;
    const userEmail = user?.email || 'anonymous';
    console.log(`[Notify] audit-complete: url=${url}, user=${userEmail}, error=${!!error}, tgEnabled=${telegramEnabled}`);

    if (!telegramEnabled) return res.json({ ok: true, delivered: false });

    let delivered = false;
    if (error) {
      delivered = await notifyTelegram(
        'Audit failed',
        [
          `URL: ${url}`,
          `User: ${userEmail}`,
          `Model: ${model || '—'}`,
          `Error: ${String(error).slice(0, 500)}`,
        ].join('\n'),
      );
    } else {
      const seo = scores?.seo ?? '—';
      const eeat = scores?.eeat ?? '—';
      const geo = scores?.geo ?? '—';
      const dur = durationMs ? `${(durationMs / 1000).toFixed(1)}s` : '—';
      delivered = await notifyTelegram(
        '✅ Audit completed',
        [
          `URL: ${url}`,
          `User: ${userEmail}`,
          `Model: ${model || '—'}`,
          `Duration: ${dur}`,
          '',
          `SEO: ${seo}/100`,
          `E-E-A-T: ${eeat}/100`,
          `GEO: ${geo}/100`,
        ].join('\n'),
      );
    }
    res.json({ ok: true, delivered });
  });

  app.post('/api/auth/logout', (_req, res) => {
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.json({ ok: true });
  });

  // ─── Health check (used by Cloud Run + UI to enable/disable providers) ──────
  app.get('/api/health', (_req, res) => {
    const available = {
      openai: !!providers.openai,
      claude: !!providers.anthropic,
      gemini: !!providers.gemini,
    };
    res.json({
      status: Object.values(available).some(Boolean) ? 'ONLINE' : 'OFFLINE',
      providers: available,
      version: process.env.K_REVISION || 'dev',
    });
  });

  // GPT-5 family + o-series reasoning models do not accept a custom `temperature`
  // (the API rejects anything other than the default 1). Detect by model ID.
  const supportsTemperature = (m: string) =>
    !/^(gpt-5|o\d)/i.test(m);

  // Same reasoning models DO accept `reasoning_effort` (minimal/low/medium/high).
  const supportsReasoningEffort = (m: string) =>
    /^(gpt-5|o\d)/i.test(m);

  // Anthropic deprecated `temperature` for newer Opus releases. The API rejects
  // any temperature for those. Sonnet / Haiku still accept it.
  const claudeSupportsTemperature = (m: string) =>
    !/^claude-opus-4/i.test(m);

  // Anthropic extended thinking is available for Claude 4.x Opus & Sonnet.
  const claudeSupportsThinking = (m: string) =>
    /^claude-(opus|sonnet)-4/i.test(m);

  // Opus 4.7 and 4.8 REMOVED the legacy `thinking.type:"enabled"` + budget_tokens
  // API. They (and Fable 5) require `thinking.type:"adaptive"` + `output_config.effort`.
  // The legacy budget_tokens path still works on Opus 4.6 and Sonnet 4.6.
  const claudeRequiresAdaptiveThinking = (m: string) =>
    /^claude-(opus-4-(7|8)|fable-5)/i.test(m);

  // Maps the UI label to a Claude extended-thinking token budget (legacy API).
  // Budgets are deliberately conservative: a larger thinking budget on a
  // long analysis prompt (Sonnet 4.6 + 30K-token page content) can push the
  // round-trip past Cloud Run's 5-minute request window, producing 504s.
  // If a deployment is built for long-thinking workloads, bump these along
  // with the Cloud Run `--timeout` on the service.
  const claudeThinkingBudget = (level?: string): number | null => {
    switch (level) {
      case 'minimal': return null;   // disable extended thinking entirely
      case 'low':     return 1500;
      case 'medium':  return 3000;
      case 'high':    return 8000;
      default:        return 3000;
    }
  };

  // Maps the UI label to the new `output_config.effort` value (Opus 4.7/4.8, Fable 5).
  const claudeEffortLevel = (level?: string): 'low' | 'medium' | 'high' | 'xhigh' | 'max' | null => {
    switch (level) {
      case 'minimal': return 'low';
      case 'low':     return 'low';
      case 'medium':  return 'medium';
      case 'high':    return 'high';
      default:        return 'high';
    }
  };

  /**
   * Applies the correct thinking configuration to a Claude request payload
   * based on the model family. Mutates `params` in place.
   *
   * Models split into two API surfaces:
   *  - Opus 4.6 / Sonnet 4.6 — legacy `thinking.type:"enabled"` + budget_tokens.
   *    `max_tokens` must be strictly greater than budget_tokens. Anthropic
   *    rejects any custom `temperature`/`top_p`/`top_k` when thinking is on
   *    (`temperature may only be set to 1 when thinking is enabled`).
   *  - Opus 4.7 / 4.8 / Fable 5 — adaptive thinking + `output_config.effort`.
   *    budget_tokens is rejected with 400. Sampling params are also removed
   *    on these models — sending any of them returns 400.
   *
   * In both branches, when thinking is being activated we strip any sampling
   * params that the caller already added so we don't hit either of those 400s.
   */
  const applyClaudeThinking = (params: any, model: string, thinkingLevel?: string) => {
    if (!claudeSupportsThinking(model)) return;
    if (claudeRequiresAdaptiveThinking(model)) {
      const effort = claudeEffortLevel(thinkingLevel);
      if (effort === null) return; // user picked "minimal" → leave thinking off
      params.thinking = { type: 'adaptive' };
      params.output_config = { ...(params.output_config || {}), effort };
    } else {
      const budget = claudeThinkingBudget(thinkingLevel);
      if (budget === null) return;
      params.thinking = { type: 'enabled', budget_tokens: budget };
      // Extended thinking requires `max_tokens > budget_tokens`.
      params.max_tokens = Math.max(params.max_tokens, budget + 4096);
    }
    // Thinking is now ON — drop sampling params to avoid the 400.
    delete params.temperature;
    delete params.top_p;
    delete params.top_k;
  };

  // ─── OpenAI ─────────────────────────────────────────────────────────────────
  app.post('/api/openai/analyze', requireAuth, async (req, res, next) => {
    try {
      if (!providers.openai) return notConfigured(res, 'openai');
      const { prompt, temperature, model, thinkingLevel } = req.body;
      const chosenModel: string = model || 'gpt-5.5';
      const params: any = {
        model: chosenModel,
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
      };
      if (supportsTemperature(chosenModel)) params.temperature = temperature ?? 0.3;
      if (supportsReasoningEffort(chosenModel) && thinkingLevel) params.reasoning_effort = thinkingLevel;
      const response = await providers.openai.chat.completions.create(params);
      res.json(JSON.parse(response.choices[0].message?.content || '{}'));
    } catch (e) { next(e); }
  });

  app.post('/api/openai/summarize', requireAuth, async (req, res, next) => {
    try {
      if (!providers.openai) return notConfigured(res, 'openai');
      const { prompt, temperature, model, thinkingLevel } = req.body;
      const chosenModel: string = model || 'gpt-5.5';
      const params: any = {
        model: chosenModel,
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
      };
      if (supportsTemperature(chosenModel)) params.temperature = temperature ?? 0.2;
      if (supportsReasoningEffort(chosenModel) && thinkingLevel) params.reasoning_effort = thinkingLevel;
      const response = await providers.openai.chat.completions.create(params);
      res.json(JSON.parse(response.choices[0].message?.content || '{}'));
    } catch (e) { next(e); }
  });

  /**
   * Runs a Claude call as a stream and resolves with the final assembled
   * message. We stream (not blocking `.create()`) because Anthropic responses
   * with extended thinking on a large analysis prompt can take 60–180s, which
   * is longer than every HTTP intermediary (Cloud Run, load balancers, the
   * SDK's own default fetch timeout). Streaming keeps the SSE connection alive
   * the whole time and avoids 504s.
   *
   * Also pings the response stream with a periodic newline so the BROWSER →
   * Express side doesn't get aborted by the same intermediaries while we're
   * waiting on Anthropic. We don't actually use SSE on the client — the
   * heartbeat just keeps the TCP connection warm; the final JSON comes once.
   */
  const runClaudeStreamed = async (
    res: Response,
    params: any,
  ): Promise<any> => {
    if (!providers.anthropic) throw new Error('Anthropic client is not configured');

    // Disable Node socket timeout on this Express response — the LLM call
    // may take 10+ minutes and we don't want Node to kill our reply before
    // we can write the final JSON.
    res.setTimeout(0);

    // Per-request 30-minute timeout pushed into the SDK's RequestOptions.
    // We pass it here too (in addition to the client-level setting above)
    // because some SDK code paths apply the per-request value to the
    // underlying AbortController controlling the streaming fetch — without
    // this, very long thinking sessions can still abort with "Request
    // timed out" even though the model is still producing output.
    const stream = providers.anthropic.messages.stream(params, {
      timeout: 1_800_000,
      maxRetries: 0,
    });
    return stream.finalMessage();
  };

  app.post('/api/claude/analyze', requireAuth, async (req, res, next) => {
    try {
      if (!providers.anthropic) return notConfigured(res, 'claude');
      const { prompt, temperature, model, thinkingLevel } = req.body;
      const chosenModel: string = model || 'claude-sonnet-4-6';
      const params: any = {
        model: chosenModel,
        max_tokens: 16000,
        messages: [{ role: 'user', content: prompt }],
      };
      if (claudeSupportsTemperature(chosenModel)) params.temperature = temperature ?? 0.3;
      applyClaudeThinking(params, chosenModel, thinkingLevel);
      const response = await runClaudeStreamed(res, params);
      const text = (response.content.find((b: any) => b.type === 'text') as any)?.text || '';
      res.json(extractJson(text));
    } catch (e) { next(e); }
  });

  app.post('/api/claude/summarize', requireAuth, async (req, res, next) => {
    try {
      if (!providers.anthropic) return notConfigured(res, 'claude');
      const { prompt, temperature, model, thinkingLevel } = req.body;
      const chosenModel: string = model || 'claude-sonnet-4-6';
      const params: any = {
        model: chosenModel,
        max_tokens: 8192,
        messages: [{ role: 'user', content: prompt }],
      };
      if (claudeSupportsTemperature(chosenModel)) params.temperature = temperature ?? 0.2;
      applyClaudeThinking(params, chosenModel, thinkingLevel);
      const response = await runClaudeStreamed(res, params);
      const text = (response.content.find((b: any) => b.type === 'text') as any)?.text || '';
      res.json(extractJson(text));
    } catch (e) { next(e); }
  });

  // ─── Gemini (stub until GEMINI_API_KEY is provisioned) ─────────────────────
  app.post('/api/gemini/analyze', requireAuth, async (req, res, next) => {
    try {
      if (!providers.gemini) return notConfigured(res, 'gemini');
      const { prompt, temperature, model } = req.body;
      const isPro = (model as string)?.includes('pro');
      const response = await providers.gemini.models.generateContent({
        model: model || 'gemini-3-flash-preview',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: analysisSchema,
          temperature: temperature ?? 0.3,
          thinkingConfig: isPro ? ({ thinkingLevel: 'HIGH' } as any) : undefined,
        },
      });
      const txt = response.text;
      if (!txt) throw new Error('Gemini returned empty response');
      res.json(JSON.parse(txt));
    } catch (e) { next(e); }
  });

  app.post('/api/gemini/summarize', requireAuth, async (req, res, next) => {
    try {
      if (!providers.gemini) return notConfigured(res, 'gemini');
      const { prompt, temperature, model } = req.body;
      const response = await providers.gemini.models.generateContent({
        model: model || 'gemini-3-flash-preview',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: bulkSummarySchema,
          temperature: temperature ?? 0.2,
        },
      });
      const txt = response.text;
      if (!txt) throw new Error('Gemini returned empty response');
      res.json(JSON.parse(txt));
    } catch (e) { next(e); }
  });

  // ─── Web scraper ────────────────────────────────────────────────────────────
  app.post('/api/scrape', requireAuth, async (req, res, next) => {
    try {
      const { url, useJsRendering, customProxies } = req.body;
      if (!url) return res.status(400).json({ error: 'URL is required' });

      let html = '';
      let author = '';

      const activeProxy = customProxies?.find((p: any) => p.isActive);
      let httpsAgent: HttpsProxyAgent<string> | SocksProxyAgent | undefined;

      if (activeProxy) {
        const auth = activeProxy.username
          ? `${encodeURIComponent(activeProxy.username)}:${encodeURIComponent(activeProxy.password || '')}@`
          : '';
        const proxyUrl = `${activeProxy.protocol}://${auth}${activeProxy.ip}:${activeProxy.port}`;
        httpsAgent = activeProxy.protocol === 'socks5'
          ? new SocksProxyAgent(proxyUrl)
          : new HttpsProxyAgent(proxyUrl);
      }

      if (useJsRendering) {
        const args = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'];
        if (activeProxy) args.push(`--proxy-server=${activeProxy.protocol}://${activeProxy.ip}:${activeProxy.port}`);

        const launchOpts: any = { args, headless: true };
        if (process.env.PUPPETEER_EXECUTABLE_PATH) {
          launchOpts.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
        }

        let browser;
        try {
          browser = await puppeteer.launch(launchOpts);
          const page = await browser.newPage();

          if (activeProxy?.username) {
            await page.authenticate({ username: activeProxy.username, password: activeProxy.password || '' });
          }

          try {
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
          } catch (navErr: any) {
            console.warn('[Scrape] Puppeteer timeout, using partial content:', navErr.message);
          }
          html = await page.content();
        } catch (e: any) {
          console.error('[Scrape] Puppeteer failed:', e.message);
          return res.status(500).json({ error: 'JS rendering failed: ' + e.message });
        } finally {
          if (browser) await browser.close().catch(() => undefined);
        }
      } else {
        try {
          const response = await axios.get(url, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            },
            timeout: 15000,
            httpAgent: httpsAgent,
            httpsAgent,
            proxy: false,
          });
          html = response.data;
        } catch (e: any) {
          console.warn('[Scrape] Direct fetch failed, trying Jina fallback:', e.message);
          const jinaRes = await axios.get(`https://r.jina.ai/${url}`, {
            headers: { 'X-Return-Format': 'html', 'Accept': 'text/html' },
            timeout: 15000,
            httpAgent: httpsAgent,
            httpsAgent,
            proxy: false,
          });
          html = jinaRes.data;
        }
      }

      const $ = cheerio.load(html);
      const title = $('title').text() || url;

      if (
        title.includes('Just a moment...') ||
        title.includes('Attention Required! | Cloudflare') ||
        title.includes('Verify you are human')
      ) {
        const errorMsg = useJsRendering
          ? 'Content is inaccessible even with JS rendering (advanced bot protection detected).'
          : 'Content is inaccessible via standard scraping (Cloudflare/bot protection detected). Try enabling JS rendering.';
        return res.status(403).json({ error: errorMsg, isProtected: true });
      }

      author =
        $('meta[name="author"]').attr('content') ||
        $('meta[property="article:author"]').attr('content') ||
        $('meta[name="twitter:creator"]').attr('content') ||
        $('.author-name, .post-author, .article-author, .author, .byline, [rel="author"], [itemprop="author"] [itemprop="name"], [itemprop="author"]')
          .first()
          .text()
          .trim() || '';

      // Collect every <script type="application/ld+json"> from the WHOLE document
      // (head + body) BEFORE turndown runs — turndown is fed only $('body').html()
      // and most sites (OLX, Shopify, Next.js apps) inject Product/Offer/Breadcrumb
      // schema into <head>, so those blocks would otherwise be lost from the LLM
      // prompt and the audit would falsely report "no structured data".
      const ldJsonBlocks: string[] = [];
      $('script[type="application/ld+json"]').each((_i, el) => {
        const raw = ($(el).contents().text() || '').trim();
        if (raw) ldJsonBlocks.push(raw);
      });

      // Drop other inline scripts/assets (LD+JSON kept above; the in-body copies
      // are still picked up by the turndown rule below for users who put them
      // inside <body>, but the head copies are guaranteed via the prefix).
      $('script').each((_i, el) => {
        if ($(el).attr('type') !== 'application/ld+json') $(el).remove();
      });
      $('style, noscript, iframe, svg').remove();

      let content = '';
      try {
        const turndownService = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
        turndownService.addRule('schema', {
          filter: (node: any) => node.nodeName === 'SCRIPT' && node.getAttribute('type') === 'application/ld+json',
          replacement: (_content: string, node: any) => `\n\`\`\`json\n${node.innerHTML}\n\`\`\`\n`,
        });
        turndownService.remove('img');
        content = turndownService.turndown($('body').html() || $.html());
      } catch {
        content = $('body').text().replace(/\s+/g, ' ').trim();
      }

      // Prepend a dedicated "Structured data (schema.org)" section so the LLM
      // always sees JSON-LD even if turndown choked on it or it lived in <head>.
      // De-dupe vs what turndown already emitted to avoid double-counting.
      if (ldJsonBlocks.length > 0) {
        const missingBlocks = ldJsonBlocks.filter((block) => !content.includes(block));
        if (missingBlocks.length > 0) {
          const schemaSection = [
            '## Structured Data (schema.org JSON-LD)',
            '',
            ...missingBlocks.map((block) => `\`\`\`json\n${block}\n\`\`\``),
            '',
          ].join('\n');
          content = `${schemaSection}\n${content}`;
        }
      }

      res.json({
        content,
        title,
        author,
        schemaCount: ldJsonBlocks.length,
        source: useJsRendering ? 'puppeteer' : 'html-scraper',
      });
    } catch (e) { next(e); }
  });

  // ─── Frontend (Vite middleware in dev, static dist/ in prod) ───────────────
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath, { maxAge: '1h', index: false }));
    app.get('*all', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // ─── Global error handler ─────────────────────────────────────────────────
  app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
    console.error(`[${req.method} ${req.path}]`, err.message);
    notifyTelegram(
      `Error on ${req.method} ${req.path}`,
      [
        `User: ${(req as any).user?.email || '—'}`,
        `Revision: ${process.env.K_REVISION || 'dev'}`,
        '',
        '```',
        (err.stack || err.message || String(err)).slice(0, 2500),
        '```',
      ].join('\n'),
    );
    if (res.headersSent) return;
    res.status(500).json({ error: err.message || 'Internal server error' });
  });

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT} (NODE_ENV=${process.env.NODE_ENV || 'development'})`);
  });
}

startServer().catch((err) => {
  console.error('[Fatal] Server failed to start:', err);
  process.exit(1);
});
