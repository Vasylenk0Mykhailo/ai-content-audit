/**
 * Auth Service — backend health & provider availability.
 *
 * Calls `/api/health` and returns which LLM providers are usable on this
 * deployment. The UI uses that info to enable/disable models in the selector.
 */

export interface ProviderAvailability {
  openai: boolean;
  claude: boolean;
  gemini: boolean;
}

export interface SystemHealth {
  connected: boolean;
  latency: string;
  status: 'ONLINE' | 'OFFLINE';
  providers: ProviderAvailability;
  version?: string;
}

const OFFLINE: SystemHealth = {
  connected: false,
  latency: 'N/A',
  status: 'OFFLINE',
  providers: { openai: false, claude: false, gemini: false },
};

export const checkBackendHealth = async (): Promise<SystemHealth> => {
  try {
    const start = Date.now();
    const res = await fetch('/api/health');
    if (!res.ok) return OFFLINE;
    const data = await res.json();
    const latency = Date.now() - start;

    return {
      connected: data.status === 'ONLINE',
      latency: `${latency}ms`,
      status: data.status,
      providers: data.providers ?? OFFLINE.providers,
      version: data.version,
    };
  } catch {
    return OFFLINE;
  }
};
