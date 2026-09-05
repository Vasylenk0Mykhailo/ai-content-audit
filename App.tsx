
import React, { useState, useCallback, useEffect, useRef } from 'react';
import { AnalysisMode, AppState, ModelType, AnalysisCriteria, AnalysisResult, AdminSettings, CustomProxy, LogEntry, BulkSummary, ScrapingResult, PageType, ReportFormat, getModelProvider, ModelProvider } from './types';
import { scrapeUrl } from './services/scraperService';
import { analyzeContent, generateBulkSummary } from './services/geminiService';
import { loadAdminSettings, saveAdminSettings } from './services/adminService';
import { checkBackendHealth, ProviderAvailability } from './services/authService';
import CriteriaSettings from './components/CriteriaSettings';
import ResultCard from './components/ResultCard';
import BulkSummaryCard from './components/BulkSummaryCard';
import AdminPanel from './components/AdminPanel';
import PasswordModal from './components/PasswordModal';
import ProxyModal from './components/ProxyModal';
import CustomSelect from './components/CustomSelect';
import ScrapedPageCard from './components/ScrapedPageCard';
import { AuthUser } from './services/googleAuthService';

interface AppProps {
  authUser?: AuthUser | null;
  onLogout?: () => void;
}

const INITIAL_CRITERIA: AnalysisCriteria = {
  focusArea: 'General SEO',
  strictness: 'medium',
  thinkingLevel: 'medium',
  customInstructions: '',
  language: 'en',
  selectedAuditPoints: [],
  advancedMode: false,
  pageType: 'article',
  reportFormat: 'full',
};

const GEO_PROMPT = `
Analyze the following web page content located at: {{url}}

Content Preview:
{{content}}

Analysis Criteria:
- Focus Area: {{focusArea}}
- Strictness Level: {{strictness}}
- User Custom Instructions: {{customInstructions}}

--- AUDIT INSTRUCTIONS ---
You are a Senior SEO Auditor and Content Strategist. Your goal is to analyze the content against high standards of Google's E-E-A-T and modern "Helpful Content" signals.
Use the following strict guidelines to evaluate the content.

1. Authorship & E-E-A-T (Critical)
   - Is there a real, named author? (Generic "Team" or "Staff" is a negative signal).
   - Are there clear credentials, job titles, or links to LinkedIn/Bio pages?
   - Originality: Does the content cite original research, first-hand data, or unique case studies? Or is it just aggregating existing info?
   - Expertise: Are there expert quotes? Note: Quotes in images are NOT readable by crawlers and should be flagged as an issue.

2. Structure & Journalism Style
   - Inverted Pyramid: Does it start with the "Most Important Point" or answer? Avoid academic intros that bury the lede.
   - Headings: Check hierarchy (H1 -> H2 -> H3). H1 must be unique. H2s should be informative (e.g., questions users ask).
   - Sentence Structure: One sentence = One idea. Flag long, complex sentences ("Walls of text").
   - Formatting: Look for tables, numbered lists, and visual breaks. (Tables increase citation rates).

3. AI & LLM Optimization (GEO - Generative Engine Optimization)
   - Direct Answers: Does the content contain concise (40-60 word) definition blocks that AI can easily extract as a featured snippet?
   - Numeric Anchors: Does it use specific data points (e.g., "cited 40% more often") rather than vague claims ("significant growth")?
   - Context: Are user pain points explicitly named and connected to the solution?

4. Technical & UX
   - CTA: Are Call-to-Actions value-led and specific? (Avoid generic "Click here").
   - Internal Links: Are there 2-10 relevant internal links with descriptive anchor text?
   - External Links: Are sources cited? (Opinions/Stats should link to sources).

--- OUTPUT REQUIREMENTS ---
Provide a JSON response with a COMPREHENSIVE list of recommendations (25-30 items).
For each recommendation, you MUST provide:
- category: "SEO", "EEAT", "Content", or "Technical".
- priority: "High" (Active penalty risk/Broken), "Medium" (Missed Opportunity), or "Low" (Polish).
- action: Specific, imperative title.
- description: The precise problem.
- affectedContent: Quote the exact text, header, or section.
- fixSteps: An array of strings with actionable, step-by-step instructions.
- expectedImpact: Specific benefit (e.g., "Increases Information Gain score," "Qualifies for Featured Snippet").

Do NOT be lenient. If the author is anonymous, flag it. If the intro is fluff, flag it. If there are no tables, flag it.
`.trim();

const App: React.FC<AppProps> = ({ authUser, onLogout }) => {
  const [state, setState] = useState<AppState>({
    mode: AnalysisMode.SINGLE,
    urls: [],
    scrapedPages: [],
    results: [],
    bulkSummary: null,
    logs: [],
    isAnalyzing: false,
    currentProgress: 0,
    progressStatus: 'Ready',
    selectedModel: ModelType.CLAUDE_SONNET,
    criteria: INITIAL_CRITERIA,
    showAdmin: false,
    showProxy: false,
    isAdminAuthenticated: false,
    adminSettings: {
        promptTemplate: GEO_PROMPT,
        instructionFiles: []
    }
  });

  const [customProxies, setCustomProxies] = useState<CustomProxy[]>([]);
  const [useJsRendering, setUseJsRendering] = useState(false);
  const [inputUrl, setInputUrl] = useState('');
  const [bulkInput, setBulkInput] = useState('');
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [isScraping, setIsScraping] = useState(false);
  const [providers, setProviders] = useState<ProviderAvailability>({ openai: false, claude: false, gemini: false });
  const [backendStatus, setBackendStatus] = useState<'ONLINE' | 'OFFLINE'>('OFFLINE');
  const logContainerRef = useRef<HTMLDivElement>(null);

  const addLog = useCallback((message: string, type: LogEntry['type'] = 'info') => {
    const newLog: LogEntry = {
      id: Math.random().toString(36).substr(2, 9),
      timestamp: Date.now(),
      message,
      type
    };
    setState(prev => ({ ...prev, logs: [newLog, ...prev.logs].slice(0, 100) }));
  }, []);

  // Surface logs from anywhere in the app via a window CustomEvent ("audit:log").
  // Used by exporters (PDF/Word) so users can see when generation starts,
  // finishes, or fails — including failures that would otherwise be silent
  // behind a generic `alert()` and a console line they'd never check.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ message: string; type?: LogEntry['type'] }>).detail;
      if (detail?.message) addLog(detail.message, detail.type || 'info');
    };
    window.addEventListener('audit:log', handler);
    return () => window.removeEventListener('audit:log', handler);
  }, [addLog]);

  useEffect(() => {
    const init = async () => {
      const saved = loadAdminSettings();
      if (saved) {
        setState(prev => ({ ...prev, adminSettings: saved }));
      }

      const health = await checkBackendHealth();
      setBackendStatus(health.status);
      setProviders(health.providers);

      const enabled = Object.entries(health.providers).filter(([, v]) => v).map(([k]) => k);
      if (health.status !== 'ONLINE') {
        addLog(`Backend OFFLINE — no LLM providers configured. Set OPENAI_SECRET_NAME on the backend.`, 'error');
      } else {
        addLog(`Backend ONLINE — active providers: ${enabled.join(', ') || 'none'}`, 'success');
      }

      // Auto-select first available model if current pick is unsupported.
      setState(prev => {
        const currentProvider = getModelProvider(prev.selectedModel);
        const ok =
          (currentProvider === ModelProvider.OPENAI && health.providers.openai) ||
          (currentProvider === ModelProvider.CLAUDE && health.providers.claude) ||
          (currentProvider === ModelProvider.GEMINI && health.providers.gemini);
        if (ok) return prev;
        const fallback = health.providers.openai ? ModelType.GPT5_5
          : health.providers.claude ? ModelType.CLAUDE_SONNET
          : health.providers.gemini ? ModelType.FLASH
          : prev.selectedModel;
        return { ...prev, selectedModel: fallback };
      });

      try {
        const savedProxies = localStorage.getItem('content_audit_user_proxies');
        if (savedProxies) setCustomProxies(JSON.parse(savedProxies));
      } catch (e) {
        // ignore
      }
    };

    init();
  }, [addLog]);

  const handleScrapePages = async (targetUrls: string[], forceJsRendering: boolean = false) => {
    if (targetUrls.length === 0) {
      addLog("No URLs provided for scraping", "warning");
      return;
    }

    setIsScraping(true);
    addLog(`Scraping ${targetUrls.length} pages...`);
    
    const newScrapedPages: ScrapingResult[] = [];
    const jsRendering = forceJsRendering || useJsRendering;

    for (const url of targetUrls) {
      try {
        const scrapeResult = await scrapeUrl(url, customProxies, jsRendering, (status) => addLog(`[Scrape] ${status}`));
        
        if (!scrapeResult.success && scrapeResult.error?.includes('Cloudflare/Bot protection detected')) {
          addLog(`[${url}] Bot protection detected. Please enable 'Use JS Rendering' and try again.`, 'warning');
        } else if (scrapeResult.success) {
          addLog(`Scraped successfully: ${url}`, "success");
        } else {
          addLog(`Scrape failed for ${url}: ${scrapeResult.error}`, "error");
        }

        newScrapedPages.push(scrapeResult);
      } catch (error: any) {
        newScrapedPages.push({
          url,
          title: '',
          content: '',
          success: false,
          error: error.message
        });
        addLog(`Scrape failed for ${url}: ${error.message}`, "error");
      }
    }

    setState(prev => ({
      ...prev,
      scrapedPages: [...newScrapedPages, ...prev.scrapedPages]
    }));
    
    setIsScraping(false);

    // Automatically start analysis for successfully scraped pages with sufficient content
    const successfulUrls = newScrapedPages
      .filter(p => p.success && p.content.length > 500)
      .map(p => p.url);
      
    if (successfulUrls.length > 0) {
      await runAnalysis(successfulUrls, newScrapedPages);
    } else {
      addLog("No pages were successfully scraped with sufficient content for analysis.", "warning");
    }
  };

  const runAnalysis = async (urlsToAnalyze: string[], providedScrapedPages?: ScrapingResult[]) => {
    if (urlsToAnalyze.length === 0) {
      addLog("No URLs provided for analysis", "warning");
      return;
    }

    setState(prev => ({ ...prev, isAnalyzing: true, currentProgress: 0, bulkSummary: null }));
    addLog(`Starting audit for ${urlsToAnalyze.length} pages...`);

    const total = urlsToAnalyze.length;
    /** Maps an in-URL fraction (0–1) into the overall progress percentage. */
    const setSubProgress = (i: number, sub: number, status: string) => {
      const overall = Math.min(99, Math.round(((i + Math.min(1, Math.max(0, sub))) / total) * 100));
      setState(prev => ({ ...prev, currentProgress: overall, progressStatus: status }));
    };

    const newResults: AnalysisResult[] = [];

    const notifyAuditComplete = (payload: any) => {
      // Fire-and-forget — never blocks the UI flow.
      fetch('/api/notify/audit-complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).catch(() => undefined);
    };

    for (let i = 0; i < urlsToAnalyze.length; i++) {
      const url = urlsToAnalyze[i];
      const startedAt = Date.now();
      setSubProgress(i, 0.05, `Analyzing: ${url}`);

      try {
        // Find the scraped page data
        let scrapedData = providedScrapedPages?.find(p => p.url === url) || state.scrapedPages.find(p => p.url === url);

        // If not scraped yet (shouldn't happen with the new workflow, but just in case)
        if (!scrapedData || !scrapedData.success) {
           addLog(`[${url}] Not scraped yet, scraping now...`);
           setSubProgress(i, 0.10, `Scraping: ${url}`);
           scrapedData = await scrapeUrl(url, customProxies, useJsRendering, (status: string) => addLog(`[${url}] ${status}`));
           if (!scrapedData.success) {
             throw new Error(scrapedData.error);
           }
        }
        setSubProgress(i, 0.20, `Preparing prompt: ${url}`);

        const advanced = !!state.criteria.advancedMode;
        const analysis = await analyzeContent(
          url,
          scrapedData.title,
          scrapedData.content,
          state.criteria,
          state.selectedModel,
          state.adminSettings,
          scrapedData.author,
          (msg) => {
            // Map structured PROGRESS:* events to overall percentage AND a friendly log line.
            if (msg.startsWith('PROGRESS:')) {
              const step = msg.slice('PROGRESS:'.length);
              if (step === 'pass1_start') {
                setSubProgress(i, 0.30, advanced ? `Pass 1 of 2: ${url}` : `Analyzing with LLM: ${url}`);
                addLog(`[${url}] Pass 1: generating initial audit…`);
              } else if (step === 'pass1_done') {
                setSubProgress(i, advanced ? 0.55 : 0.85, `Pass 1 complete: ${url}`);
                addLog(`[${url}] Pass 1 complete`, 'success');
              } else if (step === 'pass2_start') {
                setSubProgress(i, 0.60, `Pass 2 (E-E-A-T validation): ${url}`);
                addLog(`[${url}] Pass 2: validating E-E-A-T…`);
              } else if (step === 'pass2_done') {
                setSubProgress(i, 0.90, `Pass 2 complete: ${url}`);
                addLog(`[${url}] Pass 2 complete`, 'success');
              } else if (step === 'finalize') {
                setSubProgress(i, 0.97, `Finalizing: ${url}`);
                addLog(`[${url}] Sorting recommendations…`);
              }
              return; // never show the raw PROGRESS: line
            }
            addLog(`[${url}] ${msg}`);
          }
        );

        newResults.push(analysis);
        setState(prev => ({ ...prev, results: [analysis, ...prev.results] }));
        addLog(`Completed audit for ${url}`, "success");
        setSubProgress(i, 1, `Completed: ${url}`);
        notifyAuditComplete({
          url,
          model: state.selectedModel,
          durationMs: Date.now() - startedAt,
          scores: { seo: analysis.seoScore, eeat: analysis.eeatScore, geo: analysis.llmOptimizationScore },
        });
      } catch (error: any) {
        const errorMessage = error.message || String(error);
        
        if (errorMessage.includes('not configured') || errorMessage.includes('API_KEY_INVALID')) {
          addLog(`API key error: ${errorMessage}. Configure the secret on the backend.`, "error");
        } else {
          addLog(`Failed to process ${url}: ${errorMessage}`, "error");
        }

        const errorResult: AnalysisResult = {
          url,
          modelUsed: state.selectedModel,
          timestamp: Date.now(),
          error: errorMessage,
          seoScore: 0,
          eeatScore: 0,
          llmOptimizationScore: 0,
          isYMYL: false,
          summary: "Analysis failed.",
          strengths: [],
          weaknesses: [],
          recommendations: [],
          keywordGaps: [],
          lsiKeywords: [],
          llmEntities: [],
          sentiment: { label: 'Neutral', score: 0, explanation: 'Error occurred.' }
        };
        newResults.push(errorResult);
        setState(prev => ({ ...prev, results: [errorResult, ...prev.results] }));
        notifyAuditComplete({ url, model: state.selectedModel, durationMs: Date.now() - startedAt, error: errorMessage });
      }
    }

    // Combine with existing results for bulk summary if needed
    const allResults = [...newResults, ...state.results];

    /**
     * Aggregates a per-URL string array across all results — case-insensitive
     * dedupe, frequency-sorted (most common first), preserves original casing.
     */
    const aggregate = (key: 'keywordGaps' | 'lsiKeywords' | 'llmEntities'): string[] => {
      const counts = new Map<string, { display: string; count: number }>();
      for (const r of allResults) {
        if (r.error) continue;
        for (const raw of (r as any)[key] || []) {
          const s = (raw || '').toString().trim();
          if (!s) continue;
          const k = s.toLowerCase();
          const existing = counts.get(k);
          if (existing) existing.count++;
          else counts.set(k, { display: s, count: 1 });
        }
      }
      return Array.from(counts.values())
        .sort((a, b) => b.count - a.count || a.display.localeCompare(b.display))
        .map(x => x.display);
    };

    if (state.mode === AnalysisMode.BULK && allResults.filter(r => !r.error).length >= 1) {
      try {
        addLog("Synthesizing master strategy...", "info");
        setState(prev => ({ ...prev, progressStatus: "Generating Master Strategy..." }));
        const bulkSummary = await generateBulkSummary(
          allResults.filter(r => !r.error),
          state.selectedModel,
          state.criteria.language
        );
        // Attach client-side aggregations of per-URL fields.
        bulkSummary.aggregatedKeywordGaps = aggregate('keywordGaps');
        bulkSummary.aggregatedLsiKeywords = aggregate('lsiKeywords');
        bulkSummary.aggregatedLlmEntities = aggregate('llmEntities');
        setState(prev => ({ ...prev, bulkSummary }));
        addLog("Master strategy generated successfully!", "success");
      } catch (e: any) {
        addLog(`Synthesis failed: ${e.message}`, "error");
      }
    }

    setState(prev => ({ 
      ...prev, 
      isAnalyzing: false, 
      currentProgress: 100, 
      progressStatus: 'Complete' 
    }));
  };

  const handleSaveAdmin = (settings: AdminSettings) => {
    saveAdminSettings(settings);
    setState(prev => ({ ...prev, adminSettings: settings }));
    addLog("Admin settings saved", "success");
  };

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 pb-12">
      <nav className="bg-white border-b border-slate-200 sticky top-0 z-40 px-4 py-3">
        <div className="max-w-7xl mx-auto flex justify-between items-center gap-4">
          {/* Left: L5 logo lock-up — star + "netpeak" + divider + "Powered by AI Solutions" */}
          <div className="flex items-center gap-3 min-w-0">
            <img src="/netpeak-footer-star.png" alt="Netpeak" className="h-9 w-9 shrink-0" />
            <div className="flex items-center gap-3">
              <span
                className="leading-none"
                style={{
                  color: '#29abe2',
                  fontFamily: "'Inter', sans-serif",
                  fontWeight: 900,
                  fontSize: '20px',
                  letterSpacing: '-0.01em',
                }}
              >
                netpeak
              </span>
              <span className="w-px h-5 bg-slate-200" aria-hidden />
              <p
                className="text-[10px] font-bold uppercase leading-tight"
                style={{
                  color: '#334155',
                  fontFamily: "'Inter', sans-serif",
                  letterSpacing: '0.2em',
                }}
              >
                Powered by<br/>AI Solutions
              </p>
            </div>
          </div>

          {/* Right: AI Content Audit (Netpeak-style word-mark — variant E) */}
          <div className="flex items-center gap-3">
            <p
              className="hidden sm:block uppercase pr-3 mr-1 border-r border-slate-200"
              style={{
                color: '#29abe2',
                fontFamily: "'Inter', sans-serif",
                fontWeight: 900,
                fontSize: '16px',
                letterSpacing: '0.12em',
                lineHeight: 1,
              }}
            >
              AI&nbsp;Content&nbsp;Audit
            </p>

            <button
              onClick={() => setState(prev => ({ ...prev, showProxy: true }))}
              className="p-1.5 text-slate-400 hover:text-blue-600 transition-colors"
              title="Proxy Settings"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
            </button>
            {/* Admin panel: hidden by request — uncomment to restore.
            <button
              onClick={() => state.isAdminAuthenticated ? setState(prev => ({ ...prev, showAdmin: true })) : setShowPasswordModal(true)}
              className="p-1.5 text-slate-400 hover:text-purple-600 transition-colors"
              title="Admin Panel"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
            </button>
            */}

            {authUser && (
              <div className="flex items-center gap-2 pl-2 ml-1 border-l border-slate-200">
                {authUser.picture
                  ? <img src={authUser.picture} alt="" className="w-7 h-7 rounded-full" referrerPolicy="no-referrer" />
                  : <div className="w-7 h-7 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-[11px] font-bold">{(authUser.name || authUser.email).charAt(0).toUpperCase()}</div>}
                <div className="hidden sm:flex flex-col leading-tight">
                  <span className="text-[11px] font-bold text-slate-700">{authUser.name || authUser.email}</span>
                  <span className="text-[9px] text-slate-400">{authUser.email}</span>
                </div>
                {onLogout && (
                  <button
                    onClick={onLogout}
                    className="p-1.5 text-slate-400 hover:text-rose-600 transition-colors"
                    title="Вийти"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-4 mt-6">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-5 space-y-4">
            <div className="bg-white p-5 rounded-xl shadow-lg border border-white">
              <h3 className="text-xs font-bold text-slate-900 flex items-center gap-2 uppercase tracking-wide mb-4">
                <span className="w-1 h-3 bg-blue-500 rounded-full"></span>
                Audit Scope
              </h3>
              
              <div className="flex bg-slate-100 p-1 rounded-lg mb-4">
                <button 
                  onClick={() => setState(prev => ({ ...prev, mode: AnalysisMode.SINGLE }))}
                  className={`flex-1 py-1.5 text-[11px] font-bold rounded-md transition-all ${state.mode === AnalysisMode.SINGLE ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                >
                  Single URL
                </button>
                <button 
                  onClick={() => setState(prev => ({ ...prev, mode: AnalysisMode.BULK }))}
                  className={`flex-1 py-1.5 text-[11px] font-bold rounded-md transition-all ${state.mode === AnalysisMode.BULK ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                >
                  Bulk Audit
                </button>
              </div>

              {state.mode === AnalysisMode.SINGLE ? (
                <div className="space-y-3">
                  <div>
                    <label className="text-[10px] font-semibold text-slate-500 mb-1 ml-1 block">Target URL</label>
                    <input 
                      type="url" 
                      value={inputUrl}
                      onChange={e => setInputUrl(e.target.value)}
                      placeholder="https://example.com/page"
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:border-blue-500 transition-all shadow-sm"
                    />
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div>
                    <div className="flex items-baseline justify-between mb-1 ml-1">
                      <label className="text-[10px] font-semibold text-slate-500">URL List</label>
                      {(() => {
                        const count = bulkInput.split('\n').map(l => l.trim()).filter(Boolean).length;
                        return count > 0
                          ? <span className="text-[10px] font-bold text-blue-600">{count} URL{count === 1 ? '' : 's'}</span>
                          : null;
                      })()}
                    </div>
                    <div className="flex bg-slate-50 border border-slate-200 rounded-lg shadow-sm focus-within:ring-1 focus-within:border-blue-500 transition-all overflow-hidden">
                      <div
                        aria-hidden
                        className="select-none text-right text-[11px] font-mono text-slate-400 pt-2 pb-2 pl-2 pr-1.5 bg-slate-100/60 border-r border-slate-200 leading-[1.5rem]"
                        style={{ minWidth: 24 }}
                      >
                        {(() => {
                          const total = Math.max(bulkInput.split('\n').length, 4);
                          return Array.from({ length: total }, (_, i) => (
                            <div key={i}>{i + 1}</div>
                          ));
                        })()}
                      </div>
                      <textarea
                        value={bulkInput}
                        onChange={e => {
                          // Auto-split: if user pastes URLs glued together (…sneakers-1/https://...)
                          // or comma/space separated, normalise to one URL per line.
                          let v = e.target.value;
                          // Insert a newline before every http(s):// that is preceded by something else.
                          v = v.replace(/(\S)(https?:\/\/)/g, '$1\n$2');
                          // Replace runs of commas/semicolons/tabs between URLs with newlines.
                          v = v.replace(/[,;\t]+\s*(?=https?:\/\/)/g, '\n');
                          setBulkInput(v);
                        }}
                        onBlur={() => {
                          // Trim each line, strip leading list markers, drop empties + dedupe.
                          const seen = new Set<string>();
                          const cleaned = bulkInput
                            .split('\n')
                            .map(l => l.trim().replace(/^\s*(?:\d+[.):]?|[-*•])\s+/, ''))
                            .filter(l => {
                              if (!l) return false;
                              if (seen.has(l)) return false;
                              seen.add(l);
                              return true;
                            });
                          if (cleaned.join('\n') !== bulkInput) setBulkInput(cleaned.join('\n'));
                        }}
                        placeholder="https://site.com/p1&#10;https://site.com/p2"
                        spellCheck={false}
                        className="flex-1 bg-transparent px-3 py-2 text-sm outline-none resize-none leading-[1.5rem] font-mono"
                        style={{ height: '6rem' }}
                      />
                    </div>
                  </div>
                </div>
              )}

              <div className="mt-4 space-y-3">
                <div className="flex flex-col gap-3">
                  <label className="flex items-center gap-2 cursor-pointer group">
                    <div className="relative flex items-center justify-center">
                      <input 
                        type="checkbox" 
                        checked={useJsRendering}
                        onChange={e => setUseJsRendering(e.target.checked)}
                        className="peer sr-only"
                      />
                      <div className="w-8 h-4 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-blue-600"></div>
                    </div>
                    <span className="text-[11px] font-semibold text-slate-600 group-hover:text-slate-900 transition-colors">Use JS Rendering (Bypass Bot Protection)</span>
                  </label>

                  <label className="flex items-center gap-2 cursor-pointer group">
                    <div className="relative flex items-center justify-center">
                      <input 
                        type="checkbox" 
                        checked={state.criteria.advancedMode || false}
                        onChange={e => setState(prev => ({ ...prev, criteria: { ...prev.criteria, advancedMode: e.target.checked } }))}
                        className="peer sr-only"
                      />
                      <div className="w-8 h-4 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-purple-600"></div>
                    </div>
                    <span className="text-[11px] font-semibold text-slate-600 group-hover:text-slate-900 transition-colors flex items-center gap-1">
                      <svg className="w-3 h-3 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                      Advanced Mode (2-Pass E-E-A-T Validation)
                    </span>
                  </label>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <CustomSelect
                    label="Page Type"
                    value={state.criteria.pageType}
                    onChange={val => setState(prev => ({ ...prev, criteria: { ...prev.criteria, pageType: val as PageType } }))}
                    options={[
                      { value: 'article', label: 'Blog Article' },
                      { value: 'product', label: 'Product Card' },
                    ]}
                  />
                  <CustomSelect
                    label="Report Format"
                    value={state.criteria.reportFormat}
                    onChange={val => setState(prev => ({ ...prev, criteria: { ...prev.criteria, reportFormat: val as ReportFormat } }))}
                    options={[
                      { value: 'full', label: 'Full (Production)' },
                      { value: 'brief', label: 'Brief (KP)' },
                    ]}
                  />
                </div>

                <CustomSelect
                  label="Model Engine"
                  value={state.selectedModel}
                  onChange={val => setState(prev => ({ ...prev, selectedModel: val as ModelType }))}
                  options={[
                    // ── OpenAI (latest GPT-5.x line) ──
                    { value: ModelType.GPT5_5,      label: 'ChatGPT (GPT-5.5)',      disabled: !providers.openai },
                    { value: ModelType.GPT5_4,      label: 'ChatGPT (GPT-5.4)',      disabled: !providers.openai },
                    { value: ModelType.GPT5_4_MINI, label: 'ChatGPT (GPT-5.4 mini)', disabled: !providers.openai },
                    // ── Anthropic Claude ──
                    { value: ModelType.CLAUDE_OPUS_48, label: `Claude Opus 4.8${providers.claude ? '' : ' (not configured)'}`,   disabled: !providers.claude },
                    { value: ModelType.CLAUDE_OPUS_47, label: `Claude Opus 4.7${providers.claude ? '' : ' (not configured)'}`,   disabled: !providers.claude },
                    { value: ModelType.CLAUDE_SONNET,  label: `Claude Sonnet 4.6${providers.claude ? '' : ' (not configured)'}`, disabled: !providers.claude },
                    { value: ModelType.CLAUDE_HAIKU,   label: `Claude Haiku 4.5${providers.claude ? '' : ' (not configured)'}`,  disabled: !providers.claude },
                    // ── Gemini: temporarily hidden until API key is provisioned. Uncomment to restore.
                    // { value: ModelType.FLASH,      label: `Gemini 3 Flash${providers.gemini ? '' : ' (not configured)'}`,    disabled: !providers.gemini },
                    // { value: ModelType.PRO,        label: `Gemini 3 Pro${providers.gemini ? '' : ' (not configured)'}`,      disabled: !providers.gemini },
                    // { value: ModelType.FLASH_LITE, label: `Gemini Flash Lite${providers.gemini ? '' : ' (not configured)'}`, disabled: !providers.gemini },
                  ]}
                />
                
                <button 
                  onClick={() => {
                    if (state.mode === AnalysisMode.SINGLE) {
                      handleScrapePages([inputUrl.trim()]);
                    } else {
                      const urls = bulkInput.split('\n').map(u => u.trim()).filter(u => u);
                      if (urls.length > 0) handleScrapePages(urls);
                    }
                  }}
                  disabled={state.isAnalyzing || isScraping || (state.mode === AnalysisMode.SINGLE ? !inputUrl : !bulkInput)}
                  className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white font-bold rounded-lg shadow-md transition-all flex items-center justify-center gap-2 active:scale-95"
                >
                  {isScraping ? (
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                  ) : (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                  )}
                  {isScraping ? 'Scraping...' : 'Start Analysis'}
                </button>
              </div>
            </div>

            <CriteriaSettings 
              criteria={state.criteria} 
              onCriteriaChange={c => setState(prev => ({ ...prev, criteria: c }))} 
            />

            <div className="bg-slate-900 rounded-xl p-4 shadow-xl">
               <h4 className="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-2">Live Execution Feed</h4>
               <div ref={logContainerRef} className="h-64 overflow-y-auto overflow-x-hidden space-y-1 font-mono text-[12px] leading-snug custom-scrollbar">
                  {state.logs.map(log => (
                    <div key={log.id} className="flex gap-2">
                       <span className="text-slate-500 shrink-0">[{new Date(log.timestamp).toLocaleTimeString()}]</span>
                       <span className={`min-w-0 break-all ${
                         log.type === 'error' ? 'text-rose-400' :
                         log.type === 'success' ? 'text-emerald-400' :
                         log.type === 'warning' ? 'text-amber-400' : 'text-blue-300'
                       }`}>{log.message}</span>
                    </div>
                  ))}
               </div>
            </div>
          </div>

          <div className="lg:col-span-7 space-y-6">
            {state.isAnalyzing && (
              <div className="bg-white p-6 rounded-2xl border border-blue-100 shadow-md">
                <div className="flex justify-between items-center mb-2 gap-3">
                  <span className="text-[10px] font-bold text-blue-600 uppercase tracking-widest truncate">{state.progressStatus}</span>
                  <span className="text-[11px] font-black text-slate-700 shrink-0">{state.currentProgress}%</span>
                </div>
                <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-600 transition-all duration-500 ease-out"
                    style={{ width: `${state.currentProgress}%` }}
                  ></div>
                </div>
              </div>
            )}

            {state.bulkSummary && (
              <BulkSummaryCard
                summary={state.bulkSummary}
                urls={state.results.map(r => r.url)}
                language={state.criteria.language}
                modelUsed={state.results.find(r => !r.error)?.modelUsed || state.selectedModel}
              />
            )}

            <div className="space-y-6">
              {state.scrapedPages.filter(p => !state.results.some(r => r.url === p.url)).length > 0 && (
                <div className="mb-8">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                      <span className="w-2 h-2 bg-amber-500 rounded-full"></span>
                      Ready for Analysis
                    </h3>
                    {state.scrapedPages.filter(p => !state.results.some(r => r.url === p.url) && p.success).length > 0 && (
                      <button 
                        onClick={() => runAnalysis(state.scrapedPages.filter(p => !state.results.some(r => r.url === p.url) && p.success).map(p => p.url))}
                        disabled={state.isAnalyzing}
                        className="px-4 py-1.5 bg-slate-900 hover:bg-black disabled:bg-slate-300 text-white text-xs font-bold rounded-lg shadow-sm transition-all flex items-center gap-1.5"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                        Analyze Pending Pages
                      </button>
                    )}
                  </div>
                  {state.scrapedPages.filter(p => !state.results.some(r => r.url === p.url)).map((page, i) => (
                    <ScrapedPageCard 
                      key={`${page.url}-${i}`} 
                      page={page} 
                    />
                  ))}
                </div>
              )}

              {state.results.map((res, i) => (
                <ResultCard
                  key={`${res.url}-${res.timestamp}`}
                  result={res}
                  reportFormat={state.criteria.reportFormat}
                />
              ))}
              
              {!state.isAnalyzing && state.results.length === 0 && state.scrapedPages.length === 0 && (
                <div className="bg-white border-2 border-dashed border-slate-200 rounded-[2rem] p-12 text-center">
                  <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4">
                    <svg className="w-8 h-8 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                  </div>
                  <h3 className="text-lg font-bold text-slate-900 mb-1">No Audits Active</h3>
                  <p className="text-slate-400 text-xs max-w-xs mx-auto">Enter one or more URLs and click 'Start Analysis' to begin the intelligent content analysis.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

      {state.showAdmin && (
        <AdminPanel 
          settings={state.adminSettings} 
          onSave={handleSaveAdmin} 
          onClose={() => setState(prev => ({ ...prev, showAdmin: false }))} 
        />
      )}
      {showPasswordModal && (
        <PasswordModal 
          onAuthenticated={() => { setState(prev => ({ ...prev, isAdminAuthenticated: true, showAdmin: true })); setShowPasswordModal(false); }} 
          onClose={() => setShowPasswordModal(false)} 
        />
      )}
      {state.showProxy && (
        <ProxyModal 
          onClose={() => setState(prev => ({ ...prev, showProxy: false }))} 
          onSave={p => setCustomProxies(p)} 
          initialProxies={customProxies} 
        />
      )}

      <footer className="bg-white border-t border-slate-200 mt-12 py-4">
        <div className="max-w-7xl mx-auto px-4 flex justify-end items-center text-[10px] font-bold text-slate-400 uppercase tracking-widest">
          <span>v1.3.2</span>
        </div>
      </footer>
    </div>
  );
};

export default App;
