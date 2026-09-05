
export enum ModelProvider {
  GEMINI = 'gemini',
  OPENAI = 'openai',
  CLAUDE = 'claude',
}

export enum ModelType {
  // Gemini — temporarily hidden in the UI selector (no API key configured).
  FLASH = 'gemini-3-flash-preview',
  PRO = 'gemini-3-pro-preview',
  FLASH_LITE = 'gemini-flash-lite-latest',
  // OpenAI — latest GPT-5.x line.
  GPT5_5 = 'gpt-5.5',
  GPT5_4 = 'gpt-5.4',
  GPT5_4_MINI = 'gpt-5.4-mini',
  // Anthropic Claude.
  CLAUDE_OPUS_48 = 'claude-opus-4-8',
  CLAUDE_OPUS_47 = 'claude-opus-4-7',
  CLAUDE_SONNET = 'claude-sonnet-4-6',
  CLAUDE_HAIKU = 'claude-haiku-4-5-20251001',
}

export function getModelProvider(model: ModelType): ModelProvider {
  if (model.startsWith('gemini')) return ModelProvider.GEMINI;
  if (model.startsWith('gpt') || model.startsWith('o1')) return ModelProvider.OPENAI;
  if (model.startsWith('claude')) return ModelProvider.CLAUDE;
  return ModelProvider.OPENAI;
}

export enum AnalysisMode {
  SINGLE = 'SINGLE',
  BULK = 'BULK',
}

export type PageType = 'article' | 'product';
export type ReportFormat = 'full' | 'brief';

export interface LogEntry {
  id: string;
  timestamp: number;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
}

export type ThinkingLevel = 'minimal' | 'low' | 'medium' | 'high';

export interface AnalysisCriteria {
  focusArea: string;
  /** Maps to LLM temperature: low=0.5, medium=0.3, high=0.1. */
  strictness: 'low' | 'medium' | 'high';
  /**
   * Reasoning effort / thinking budget for reasoning models.
   * - OpenAI GPT-5.x / o-series → `reasoning_effort` parameter
   * - Anthropic Claude Opus/Sonnet 4.x → mapped to extended-thinking token budget
   * Models that don't support either silently ignore this.
   */
  thinkingLevel: ThinkingLevel;
  customInstructions: string;
  language: 'en' | 'ua';
  selectedAuditPoints: string[];
  advancedMode?: boolean;
  pageType: PageType;
  reportFormat: ReportFormat;
}

export interface Recommendation {
  category: 'SEO' | 'EEAT' | 'Content' | 'Technical';
  priority: 'High' | 'Medium' | 'Low';
  action: string;
  description: string;
  affectedContent: string;
  fixSteps: string[];
  expectedImpact: string;
}

export interface SentimentAnalysis {
  label: 'Positive' | 'Negative' | 'Neutral' | 'Mixed';
  score: number;
  explanation: string;
}

export interface AnalysisResult {
  url: string;
  pageTitle?: string;
  author?: string;
  rawContent?: string;
  modelUsed: string;
  language?: 'en' | 'ua';
  pageType?: PageType;
  seoScore: number;
  eeatScore: number;
  llmOptimizationScore: number;
  isYMYL: boolean;
  summary: string;
  strengths: string[];
  weaknesses: string[];
  recommendations: Recommendation[];
  keywordGaps: string[];
  lsiKeywords: string[];
  llmEntities: string[];
  sentiment: SentimentAnalysis;
  timestamp: number;
  error?: string;
}

export interface StrategicPillar {
  title: string;
  description: string;
}

export interface BulkSummary {
  overallScore: number;
  domainAuthorityEstimate: string;
  coreOpportunities: string[];
  topCriticalFixes: string[];
  strategicAdvice: string;
  strategicPillars: StrategicPillar[];
  technicalRoadmap: string[];
  contentGapAnalysis: string;
  // Aggregated across all analysed URLs (computed client-side, not from LLM).
  aggregatedKeywordGaps?: string[];
  aggregatedLsiKeywords?: string[];
  aggregatedLlmEntities?: string[];
}

export interface ScrapingResult {
  url: string;
  content: string;
  title: string;
  author?: string;
  success: boolean;
  error?: string;
}

export interface InstructionFile {
  id: string;
  name: string;
  content: string;
  size: number;
}

export interface CustomProxy {
  id: string;
  ip: string;
  port: string;
  username?: string;
  password?: string;
  protocol: 'http' | 'https' | 'socks5';
  isActive: boolean;
}

export interface AdminSettings {
  promptTemplate: string;
  instructionFiles: InstructionFile[];
}

export interface AppState {
  mode: AnalysisMode;
  urls: string[];
  scrapedPages: ScrapingResult[];
  results: AnalysisResult[];
  bulkSummary: BulkSummary | null;
  logs: LogEntry[];
  isAnalyzing: boolean;
  currentProgress: number;
  progressStatus: string;
  selectedModel: ModelType;
  criteria: AnalysisCriteria;
  showAdmin: boolean;
  showProxy: boolean;
  adminSettings: AdminSettings;
  isAdminAuthenticated: boolean;
}
