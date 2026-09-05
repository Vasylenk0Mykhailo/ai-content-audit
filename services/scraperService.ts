import { ScrapingResult, CustomProxy } from '../types';

export const scrapeUrl = async (
  url: string, 
  customProxies: CustomProxy[] = [],
  useJsRendering: boolean = false,
  onStatusUpdate?: (status: string) => void,
  signal?: AbortSignal
): Promise<ScrapingResult> => {
  if (!url || !url.startsWith('http')) {
    return { url, content: '', title: '', success: false, error: 'Invalid URL. Must include http/https.' };
  }

  try {
    onStatusUpdate?.(`Scraping content from ${url}${useJsRendering ? ' (JS Rendering)' : ''}...`);
    
    const response = await fetch('/api/scrape', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ url, useJsRendering, customProxies }),
      signal
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error || `Failed with status ${response.status}`);
    }

    const data = await response.json();
    
    if (!data.content || data.content.length < 50) {
      throw new Error("Retrieved content is too short or empty.");
    }

    onStatusUpdate?.(`Content retrieved successfully.`);
    return { 
      url, 
      content: data.content, 
      title: data.title || url, 
      author: data.author,
      success: true 
    };
  } catch (err: any) {
    console.error(`Scraping failed:`, err);
    return { url, content: '', title: '', success: false, error: `Failed to fetch page: ${err.message}` };
  }
};