import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { AnalysisResult, BulkSummary, ReportFormat } from "../types";

// ─── Netpeak brand palette (sampled from internal-document template, 2026) ───
const COLORS = {
  netpeakAccent:    [41, 171, 226] as [number, number, number],  // #29abe2
  netpeakBanner:    [120, 196, 232] as [number, number, number], // banner BG fallback
  netpeakTableHead: [167, 213, 240] as [number, number, number], // #a7d5f0
  netpeakTableAlt:  [224, 240, 250] as [number, number, number], // #e0f0fa
  black:            [0, 0, 0]       as [number, number, number],
  slateMed:         [71, 85, 105]   as [number, number, number],
  slateLight:       [148, 163, 184] as [number, number, number],
  border:           [200, 220, 235] as [number, number, number],
  white:            [255, 255, 255] as [number, number, number],
  success:          [16, 185, 129]  as [number, number, number],
  danger:           [239, 68, 68]   as [number, number, number],
  warning:          [245, 158, 11]  as [number, number, number],
};

const MARGIN = 15;
const BANNER_HEIGHT = 24;

// ─── Localised labels ───────────────────────────────────────────────────────
type Lang = 'en' | 'ua';

const I18N = {
  en: {
    fullTitle:        'Content Audit Report',
    briefTitle:       'Content Audit Brief',
    bulkTitle:        'Website Strategy',
    bulkSubtitle:     (n: number) => `Cluster Audit Synthesis · ${n} pages processed`,
    summary:          'Executive Summary',
    briefSummary:     'Key Finding',
    strengths:        'Key Strengths',
    weaknesses:       'Critical Issues',
    actionPlan:       'Action Plan & Recommendations',
    improvements:     'Improvement Directions',
    sentiment:        'Sentiment Analysis',
    keywordGaps:      'Keyword Gaps',
    lsiKeywords:      'LSI Entities',
    llmEntities:      'GEO Anchors',
    topicalCoverage:  'Topical Coverage',
    overallScore:     'Aggregated Score',
    trustLevel:       'Trust Standing',
    strategicAdvice:  'Strategic Directive',
    pillars:          'Core Growth Pillars',
    roadmap:          'Execution Roadmap',
    failures:         'Systemic Failures',
    semanticGap:      'Semantic Gap Analysis',
    page:             (i: number, n: number) => `Page ${i} of ${n}`,
    tableHeads: {
      priority: 'PRIORITY', category: 'CATEGORY', action: 'ACTION ITEM',
      impact: 'IMPACT', area: 'AREA', direction: 'DIRECTION',
      pillar: 'PILLAR', strategy: 'STRATEGY & IMPLEMENTATION',
    },
    fixLabel:         'FIX STEPS:',
  },
  ua: {
    fullTitle:        'Аудит контенту',
    briefTitle:       'Аудит контенту · скорочений звіт',
    bulkTitle:        'Стратегія сайту',
    bulkSubtitle:     (n: number) => `Синтез аудиту кластера · опрацьовано ${n} сторінок`,
    summary:          'Загальний висновок',
    briefSummary:     'Ключовий висновок',
    strengths:        'Сильні сторони',
    weaknesses:       'Критичні проблеми',
    actionPlan:       'План дій та рекомендації',
    improvements:     'Напрямки покращення',
    sentiment:        'Аналіз тональності',
    // Технічні терміни лишаємо англійською навіть в UA-режимі.
    keywordGaps:      'Keyword Gaps',
    lsiKeywords:      'LSI Entities',
    llmEntities:      'GEO Anchors',
    topicalCoverage:  'Тематичне покриття',
    overallScore:     'Загальна оцінка',
    trustLevel:       'Рівень довіри',
    strategicAdvice:  'Стратегічний орієнтир',
    pillars:          'Опорні точки росту',
    roadmap:          'Дорожня карта',
    failures:         'Системні проблеми',
    semanticGap:      'Семантичний розрив',
    page:             (i: number, n: number) => `Сторінка ${i} з ${n}`,
    tableHeads: {
      priority: 'ПРІОРИТЕТ', category: 'КАТЕГОРІЯ', action: 'РЕКОМЕНДАЦІЯ',
      impact: 'ОЧІКУВАНИЙ ЕФЕКТ', area: 'СФЕРА', direction: 'НАПРЯМОК',
      pillar: 'НАПРЯМОК', strategy: 'СТРАТЕГІЯ ТА РЕАЛІЗАЦІЯ',
    },
    fixLabel:         'КОНКРЕТНІ КРОКИ:',
  },
};

// ─── LLM-output cleaners ────────────────────────────────────────────────────

/** Drops a leading "Стовп N: ", "Pillar N – ", etc. so we render just the title. */
const stripPillarPrefix = (s: string): string =>
  s.replace(/^\s*(стовп|стовпець|pillar)\s*\d+\s*[:\-–—.]?\s*/i, '').trim();

/**
 * Filters out junk items the LLM occasionally emits inside arrays — fragments
 * like "розділ 6", lone numbers, or anything shorter than ~12 chars without any
 * letters around it.
 */
const isMeaningful = (s: string): boolean => {
  const t = (s || '').trim();
  if (t.length < 12) return false;
  // "розділ N", "section N", "see X", "page N" → not actionable items
  if (/^(розділ|section|см\.|see|page|p\.)\s*[\dіivx]+\.?$/i.test(t)) return false;
  // Must contain at least 3 letters (filters "(1) (2)" leftovers)
  if ((t.match(/[\p{L}]/gu) || []).length < 3) return false;
  return true;
};

/**
 * Turns a flowing string like "(1) foo; (2) bar; (3) baz" into ["foo", "bar", "baz"].
 * Falls back to single-item array if no numbered list pattern is found.
 */
const splitNumberedList = (s: string): string[] => {
  if (!s) return [];
  // Look for "(1) ... (2) ... (3) ..." or "1) ... 2) ..." or "1. ... 2. ..."
  const matches = s.match(/\(?\d+\)?\s*[—–\-.:]\s*([^()]+?)(?=\s*(?:\(?\d+\)?\s*[—–\-.:])|$)/g);
  if (matches && matches.length >= 2) {
    return matches.map(m => m.replace(/^\(?\d+\)?\s*[—–\-.:]\s*/, '').replace(/[;.,]\s*$/, '').trim()).filter(Boolean);
  }
  return [s.trim()];
};

// ─── Font handling ───────────────────────────────────────────────────────────
const blobToBase64 = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });

/** Loads Montserrat (Cyrillic + Latin glyph coverage). Falls back to helvetica. */
const ensureMontserratFont = async (doc: jsPDF) => {
  try {
    if (Object.prototype.hasOwnProperty.call(doc.getFontList(), 'Montserrat')) {
      doc.setFont('Montserrat');
      return;
    }
    const base = 'https://cdn.jsdelivr.net/gh/googlefonts/montserrat@master/fonts/ttf';
    const variants: Array<[string, string, 'normal' | 'bold']> = [
      [`${base}/Montserrat-Regular.ttf`, 'Montserrat-Regular.ttf', 'normal'],
      [`${base}/Montserrat-Bold.ttf`,    'Montserrat-Bold.ttf',    'bold'],
    ];
    for (const [url, filename, style] of variants) {
      const res = await fetch(url);
      if (!res.ok) continue;
      const blob = await res.blob();
      const b64 = await blobToBase64(blob);
      doc.addFileToVFS(filename, b64);
      doc.addFont(filename, 'Montserrat', style);
    }
    doc.setFont('Montserrat');
  } catch (e) {
    console.error('Font loading failed; falling back to helvetica.', e);
    doc.setFont('helvetica');
  }
};

// ─── Brand asset loader (with graceful fallback) ────────────────────────────
type ImgAsset = { dataUrl: string; width: number; height: number } | null;

const tryLoadImage = async (url: string): Promise<ImgAsset> => {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    const dataUrl: string = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onloadend = () => resolve(r.result as string);
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
    const dims = await new Promise<{ w: number; h: number }>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = reject;
      img.src = dataUrl;
    });
    return { dataUrl, width: dims.w, height: dims.h };
  } catch {
    return null;
  }
};

/** Draws a small 4-point sparkle "star" used as the footer mark. */
const drawSparkle = (doc: jsPDF, cx: number, cy: number, r: number, color: [number, number, number]) => {
  doc.setFillColor(...color);
  // Vertical diamond
  doc.triangle(cx, cy - r, cx - r * 0.18, cy, cx + r * 0.18, cy, 'F');
  doc.triangle(cx, cy + r, cx - r * 0.18, cy, cx + r * 0.18, cy, 'F');
  // Horizontal diamond
  doc.triangle(cx - r, cy, cx, cy - r * 0.18, cx, cy + r * 0.18, 'F');
  doc.triangle(cx + r, cy, cx, cy - r * 0.18, cx, cy + r * 0.18, 'F');
};

// ─── Header / footer ─────────────────────────────────────────────────────────

/** Draws the Netpeak banner image if available; otherwise a clean blue band with brand text. */
const drawBanner = (doc: jsPDF, headerImg: ImgAsset) => {
  const pageWidth = doc.internal.pageSize.width;
  if (headerImg) {
    // Fit by width, keep aspect ratio.
    const drawH = (headerImg.height / headerImg.width) * pageWidth;
    doc.addImage(headerImg.dataUrl, 'PNG', 0, 0, pageWidth, drawH, undefined, 'FAST');
    return drawH;
  }
  // Fallback: programmatic banner — L5 lock-up: star + "netpeak" + divider + "POWERED BY AI SOLUTIONS"
  doc.setFillColor(...COLORS.netpeakBanner);
  doc.rect(0, 0, pageWidth, BANNER_HEIGHT, 'F');
  drawSparkle(doc, MARGIN + 4, BANNER_HEIGHT / 2, 4, COLORS.white);

  doc.setFont('Montserrat', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(...COLORS.white);
  doc.text('netpeak', MARGIN + 11, BANNER_HEIGHT / 2 + 2);
  const nameW = doc.getTextWidth('netpeak');

  // Vertical divider
  const divX = MARGIN + 11 + nameW + 4;
  doc.setDrawColor(255, 255, 255);
  doc.setLineWidth(0.3);
  doc.line(divX, BANNER_HEIGHT / 2 - 4, divX, BANNER_HEIGHT / 2 + 3);

  // Powered by / AI Solutions (uppercase, two lines)
  doc.setFont('Montserrat', 'bold');
  doc.setFontSize(6.5);
  doc.text('POWERED BY', divX + 4, BANNER_HEIGHT / 2 - 1);
  doc.text('AI SOLUTIONS', divX + 4, BANNER_HEIGHT / 2 + 2.5);
  return BANNER_HEIGHT;
};

/** Minimal footer: small Netpeak star in the bottom-right corner. No captions, no page numbers. */
const drawFooter = (doc: jsPDF, starImg: ImgAsset, _lang: Lang) => {
  const pageWidth = doc.internal.pageSize.width;
  const pageHeight = doc.internal.pageSize.height;
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    if (starImg) {
      const sz = 6;
      doc.addImage(starImg.dataUrl, 'PNG', pageWidth - MARGIN - sz, pageHeight - sz - 5, sz, sz, undefined, 'FAST');
    } else {
      drawSparkle(doc, pageWidth - MARGIN - 2, pageHeight - 8, 2.5, COLORS.netpeakAccent);
    }
  }
};

/**
 * Inserts zero-width spaces into long unbreakable tokens (URLs, paths, IDs)
 * so jsPDF's word-based line-breaker can wrap them inside autoTable cells.
 */
const softWrap = (text: string): string => {
  if (!text) return text;
  return text
    .split(/(\s+)/)
    .map((part) => {
      if (/^\s+$/.test(part) || part.length <= 30) return part;
      // Add a ZWSP after common URL/path delimiters, plus every 30 chars as a fallback.
      return part
        .replace(/([/?&=#._\-:])/g, '$1​')
        .replace(/(\S{30})/g, '$1​');
    })
    .join('');
};

/**
 * Adds a page break if `needed` mm would push past the bottom margin. Redraws
 * the brand banner on the new page and returns the new cursor Y. Use this
 * before drawing any section that must stay together (H2 + table body).
 */
const ensureSpace = (doc: jsPDF, cursorY: number, needed: number, headerImg: ImgAsset): number => {
  const pageHeight = doc.internal.pageSize.height;
  const bottomMargin = 18; // leave room for footer
  if (cursorY + needed > pageHeight - bottomMargin) {
    doc.addPage();
    const bannerH = drawBanner(doc, headerImg);
    return bannerH + 12;
  }
  return cursorY;
};

const drawH1 = (doc: jsPDF, text: string, y: number): number => {
  doc.setFont('Montserrat', 'bold');
  doc.setFontSize(22);
  doc.setTextColor(...COLORS.black);
  doc.text(text, MARGIN, y);
  return y + 8;
};

const drawH2 = (doc: jsPDF, text: string, y: number): number => {
  doc.setFont('Montserrat', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(...COLORS.netpeakAccent);
  doc.text(text, MARGIN, y);
  return y + 6;
};

const drawTableTitle = (doc: jsPDF, text: string, y: number): number => {
  doc.setFont('Montserrat', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(...COLORS.netpeakAccent);
  doc.text(text, MARGIN, y);
  return y + 4;
};

/**
 * Wraps long URLs so they never overflow the page. jsPDF's text breaker only
 * splits on whitespace by default, so we pre-break a raw URL by inserting
 * soft break points after slashes / dots / ampersands before handing it to
 * `splitTextToSize`.
 */
const drawUrl = (doc: jsPDF, url: string, y: number): number => {
  doc.setFont('Montserrat', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...COLORS.netpeakAccent);
  const pageWidth = doc.internal.pageSize.width;
  const maxW = pageWidth - MARGIN * 2;
  // Soft-break only for jsPDF's line-breaker — strip ZWSPs back out before
  // both rendering and link target so we don't ship them in the href and
  // turn into 404s when the user clicks. PDF readers' built-in URL detector
  // can't span line wraps; we draw an explicit clickable overlay over every
  // rendered line that targets the FULL original URL.
  const breakable = url.replace(/([/?&=#._-])/g, '$1​');
  const lines = doc.splitTextToSize(breakable, maxW) as string[];
  const lineH = 5;
  lines.forEach((line, idx) => {
    const visible = line.replace(/​/g, '');
    const lineY = y + idx * lineH;
    doc.text(visible, MARGIN, lineY);
    const w = doc.getTextWidth(visible);
    // Link rect is positioned above baseline by ~ font height. 9pt ≈ 3.2mm.
    doc.link(MARGIN, lineY - 3.2, w, lineH, { url });
  });
  return y + lines.length * lineH + 4;
};

// ─── Reusable content blocks ────────────────────────────────────────────────

const drawScoreCards = (doc: jsPDF, result: AnalysisResult, cursorY: number): number => {
  const pageWidth = doc.internal.pageSize.width;
  const cardGap = 6;
  const cardW = (pageWidth - (MARGIN * 2) - (cardGap * 2)) / 3;
  const cardH = 28;

  const draw = (label: string, score: number, x: number) => {
    doc.setFillColor(...COLORS.netpeakTableAlt);
    doc.setDrawColor(...COLORS.border);
    doc.setLineWidth(0.2);
    doc.roundedRect(x, cursorY, cardW, cardH, 2, 2, 'FD');

    doc.setFontSize(8);
    doc.setTextColor(...COLORS.netpeakAccent);
    doc.setFont('Montserrat', 'bold');
    doc.text(label.toUpperCase(), x + 6, cursorY + 8);

    doc.setFontSize(18);
    const color = score >= 80 ? COLORS.success : score >= 50 ? COLORS.warning : COLORS.danger;
    doc.setTextColor(...color);
    doc.text(`${score}`, x + 6, cursorY + 20);
    const scoreWidth = doc.getTextWidth(`${score}`);

    doc.setFontSize(9);
    doc.setTextColor(...COLORS.slateLight);
    doc.text('/100', x + 6 + scoreWidth + 1, cursorY + 20);
  };

  draw('SEO',     result.seoScore,             MARGIN);
  draw('E-E-A-T', result.eeatScore,            MARGIN + cardW + cardGap);
  draw('GEO',     result.llmOptimizationScore, MARGIN + (cardW + cardGap) * 2);

  return cursorY + cardH + 12;
};

const drawSummaryBlock = (doc: jsPDF, summary: string, cursorY: number, title: string): number => {
  cursorY = drawH2(doc, title, cursorY);
  (autoTable as any)(doc, {
    startY: cursorY,
    margin: { left: MARGIN, right: MARGIN },
    body: [[summary]],
    theme: 'plain',
    styles: { font: 'Montserrat', fontSize: 10, textColor: COLORS.black, lineHeight: 1.5, cellPadding: 0, overflow: 'linebreak' },
  });
  return (doc as any).lastAutoTable.finalY + 10;
};

/**
 * Renders one column of a Strengths/Weaknesses card pair.
 * Design: rounded white card with a coloured top header bar, soft bullets
 * with breathing room. `cardH` is fixed so both columns stay aligned.
 */
const HEADER_BAR_H = 7;
const TITLE_AREA_H = 10;

/**
 * Like `drawListColumn` but WITHOUT the coloured header bar. Used to render
 * continuation chunks of a split S/W card on subsequent pages — no
 * "(cont.)" suffix, just the bullets flowing on into a fresh card.
 */
const drawListColumnBody = (
  doc: jsPDF,
  items: string[],
  x: number,
  y: number,
  w: number,
  h: number,
  accentColor: [number, number, number],
) => {
  const padding = 6;
  doc.setFillColor(...COLORS.white);
  doc.setDrawColor(...COLORS.border);
  doc.setLineWidth(0.2);
  doc.roundedRect(x, y, w, h, 2.5, 2.5, 'FD');

  const itemMaxW = w - padding * 2 - 5;
  doc.setFont('Montserrat', 'normal');
  doc.setFontSize(10);
  let yy = y + 4.5 + 2; // bullet area starts slightly inside the card
  items.forEach((raw, i) => {
    const wrapped = doc.splitTextToSize(softWrap(raw), itemMaxW) as string[];
    doc.setFillColor(...accentColor);
    doc.circle(x + padding, yy - 1.5, 0.7, 'F');
    doc.setTextColor(...COLORS.black);
    doc.setFont('Montserrat', 'normal');
    wrapped.forEach((line, idx) => doc.text(line, x + padding + 4, yy + idx * 4.5));
    yy += wrapped.length * 4.5 + (i === items.length - 1 ? 0 : 2.5);
  });
};
const drawListColumn = (
  doc: jsPDF,
  title: string,
  items: string[],
  x: number,
  y: number,
  w: number,
  h: number,
  accentColor: [number, number, number],
) => {
  const padding = 6;

  // White body card with subtle border
  doc.setFillColor(...COLORS.white);
  doc.setDrawColor(...COLORS.border);
  doc.setLineWidth(0.2);
  doc.roundedRect(x, y, w, h, 2.5, 2.5, 'FD');

  // Coloured header bar (top, full width)
  doc.setFillColor(...accentColor);
  doc.rect(x, y, w, HEADER_BAR_H, 'F');

  // Title text in the header bar
  doc.setFont('Montserrat', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...COLORS.white);
  doc.text(title.toUpperCase(), x + padding, y + HEADER_BAR_H - 2);

  // Items
  const itemMaxW = w - padding * 2 - 5;
  doc.setFont('Montserrat', 'normal');
  doc.setFontSize(10);
  let yy = y + HEADER_BAR_H + 4.5;
  items.forEach((raw, i) => {
    const wrapped = doc.splitTextToSize(softWrap(raw), itemMaxW) as string[];
    // Solid accent dot
    doc.setFillColor(...accentColor);
    doc.circle(x + padding, yy - 1.5, 0.7, 'F');
    // Bullet text in slate
    doc.setTextColor(...COLORS.black);
    doc.setFont('Montserrat', 'normal');
    wrapped.forEach((line, idx) => doc.text(line, x + padding + 4, yy + idx * 4.5));
    yy += wrapped.length * 4.5 + (i === items.length - 1 ? 0 : 2.5);
  });
};

/**
 * Strengths and Weaknesses rendered as a SINGLE row with two columns:
 * left = strengths (green accent), right = weaknesses (red accent).
 * Both columns share one height equal to the taller of the two so they
 * align visually.
 */
const drawStrengthsWeaknesses = (doc: jsPDF, result: AnalysisResult, cursorY: number, lang: Lang, includeWeaknesses = true, headerImg: ImgAsset = null): number => {
  const t = I18N[lang];
  const pageWidth = doc.internal.pageSize.width;
  const pageHeight = doc.internal.pageSize.height;
  const padding = 6;
  const gap = 6;
  const fullW = pageWidth - MARGIN * 2;
  const colW = includeWeaknesses ? (fullW - gap) / 2 : fullW;
  const bottomMargin = 18;

  // Reflects the actual renderer's layout: HEADER_BAR_H + 4mm top padding
  // before first bullet + sum(lines*4.5) + gap*(n-1) + 4mm bottom padding.
  const measure = (items: string[], w: number): number => {
    const itemMaxW = w - padding * 2 - 5;
    doc.setFont('Montserrat', 'normal');
    doc.setFontSize(10);
    const arr = items || [];
    const blockH = arr.reduce((sum, it, i) => {
      const lines = (doc.splitTextToSize(softWrap(it), itemMaxW) as string[]).length;
      return sum + lines * 4.5 + (i === arr.length - 1 ? 0 : 2.5);
    }, 0);
    return HEADER_BAR_H + 4 + blockH + 4;
  };

  const renderSide = (
    items: string[],
    title: string,
    accent: [number, number, number],
    x: number,
    w: number,
    startY: number,
  ): { endY: number } => {
    const itemMaxW = w - padding * 2 - 5;
    let remaining = [...items];
    let y = startY;
    let part = 0;
    doc.setFontSize(10);

    while (remaining.length > 0) {
      const room = pageHeight - bottomMargin - y;
      const fit: string[] = [];
      // Continuation cards skip the header bar, saving ~7mm of vertical room.
      let consumed = part === 0 ? (HEADER_BAR_H + 6) : 6.5;
      for (const it of remaining) {
        const lines = (doc.splitTextToSize(softWrap(it), itemMaxW) as string[]).length;
        const h = lines * 4.5 + 2.5;
        if (consumed + h + 6 > room) break;
        fit.push(it);
        consumed += h;
      }
      if (fit.length === 0) {
        doc.addPage();
        const bH = drawBanner(doc, headerImg);
        y = bH + 12;
        continue;
      }
      const cardH = Math.max(consumed + 6, 30);
      // First chunk renders with the section title; continuation chunks render
      // an "untitled" card so the reader doesn't see "(cont.)" suffixes.
      if (part === 0) {
        drawListColumn(doc, title, fit, x, y, w, cardH, accent);
      } else {
        drawListColumnBody(doc, fit, x, y, w, cardH, accent);
      }
      remaining = remaining.slice(fit.length);
      if (remaining.length === 0) return { endY: y + cardH + 10 };
      doc.addPage();
      const bH = drawBanner(doc, headerImg);
      y = bH + 12;
      part++;
    }
    return { endY: y };
  };

  const sFull = measure(result.strengths || [], colW);
  const wFull = includeWeaknesses ? measure(result.weaknesses || [], colW) : 0;
  const fullCardH = Math.max(sFull, wFull, 30);
  const available = pageHeight - bottomMargin - cursorY;
  // Full page (after banner) = pageHeight - bannerH - margin - bottomMargin.
  // Roughly 297 - 30 - 12 - 18 ≈ 237mm of usable vertical room on a fresh page.
  const fullPageRoom = pageHeight - 30 - 12 - bottomMargin;

  // Best case: side-by-side on current page.
  if (fullCardH <= available) {
    drawListColumn(doc, t.strengths, result.strengths || [], MARGIN, cursorY, colW, fullCardH, COLORS.success);
    if (includeWeaknesses) {
      drawListColumn(doc, t.weaknesses, result.weaknesses || [], MARGIN + colW + gap, cursorY, colW, fullCardH, COLORS.danger);
    }
    return cursorY + fullCardH + 10;
  }

  // Both fit side-by-side on a FRESH page → start new page and place them there.
  if (fullCardH <= fullPageRoom) {
    doc.addPage();
    const bH = drawBanner(doc, headerImg);
    cursorY = bH + 12;
    drawListColumn(doc, t.strengths, result.strengths || [], MARGIN, cursorY, colW, fullCardH, COLORS.success);
    if (includeWeaknesses) {
      drawListColumn(doc, t.weaknesses, result.weaknesses || [], MARGIN + colW + gap, cursorY, colW, fullCardH, COLORS.danger);
    }
    return cursorY + fullCardH + 10;
  }

  // Last resort — list(s) too tall for a single page even fresh. Render at FULL
  // width sequentially, paginated. Looks much better than half-width orphans.
  if (available < 60) {
    doc.addPage();
    const bH = drawBanner(doc, headerImg);
    cursorY = bH + 12;
  }
  const sResult = renderSide(result.strengths || [], t.strengths, COLORS.success, MARGIN, fullW, cursorY);
  if (!includeWeaknesses) return sResult.endY;

  let wStartY = sResult.endY;
  if (pageHeight - bottomMargin - wStartY < 60) {
    doc.addPage();
    const bH = drawBanner(doc, headerImg);
    wStartY = bH + 12;
  }
  const wResult = renderSide(result.weaknesses || [], t.weaknesses, COLORS.danger, MARGIN, fullW, wStartY);
  return wResult.endY;
};

/** Drops malformed recommendation entries (no action/priority, only stub text). */
const isValidRec = (r: any): boolean => {
  if (!r) return false;
  const action = (r.action || '').trim();
  const desc = (r.description || '').trim();
  const priority = (r.priority || '').trim();
  if (!priority) return false;
  if (action.length < 6 && desc.length < 20) return false;
  // Drop lone connector phrases like "after the step-by-step plan"
  if (!action && /^(після|after|see|до|для|потім)\s/i.test(desc) && desc.length < 60) return false;
  return true;
};

const drawRecommendationsFull = (doc: jsPDF, result: AnalysisResult, headerImg: ImgAsset, lang: Lang) => {
  const t = I18N[lang];
  doc.addPage();
  const bannerH = drawBanner(doc, headerImg);
  let cursorY = bannerH + 12;
  cursorY = drawH2(doc, t.actionPlan, cursorY);

  const cleanRecs = (result.recommendations || []).filter(isValidRec);

  (autoTable as any)(doc, {
    startY: cursorY,
    margin: { left: MARGIN, right: MARGIN },
    head: [[t.tableHeads.priority, t.tableHeads.category, t.tableHeads.action, t.tableHeads.impact]],
    body: cleanRecs.map(r => [
      r.priority.toUpperCase(),
      softWrap(r.category),
      softWrap(`${r.action}\n\n${r.description}\n\n${t.fixLabel}\n${(r.fixSteps || []).filter(Boolean).map(s => `•  ${s}`).join('\n')}`),
      softWrap(r.expectedImpact),
    ]),
    theme: 'grid',
    styles: { font: 'Montserrat', fontSize: 9, cellPadding: 4, valign: 'top', lineHeight: 1.3, textColor: COLORS.black, lineWidth: 0.1, lineColor: COLORS.border, overflow: 'linebreak' },
    headStyles: { fillColor: COLORS.netpeakTableHead, textColor: COLORS.black, font: 'Montserrat', fontStyle: 'bold', halign: 'left', fontSize: 8, cellPadding: 3 },
    columnStyles: {
      0: { cellWidth: 26, fontStyle: 'bold' },
      1: { cellWidth: 26 },
      2: { cellWidth: 'auto' },
      3: { cellWidth: 48, fontStyle: 'normal', textColor: COLORS.netpeakAccent },
    },
    alternateRowStyles: { fillColor: COLORS.netpeakTableAlt },
    didParseCell: (data: any) => {
      if (data.section === 'body' && data.column.index === 0) {
        const text = data.cell.raw;
        if (text === 'HIGH') data.cell.styles.textColor = COLORS.danger;
        else if (text === 'MEDIUM') data.cell.styles.textColor = COLORS.warning;
        else data.cell.styles.textColor = COLORS.success;
      }
    },
  });
};

const drawRecommendationsBrief = (doc: jsPDF, result: AnalysisResult, cursorY: number, lang: Lang, headerImg: ImgAsset = null): number => {
  const t = I18N[lang];
  const top = (result.recommendations || []).filter(isValidRec).slice(0, 8);
  if (top.length === 0) return cursorY;
  // Keep H2 with at least the first row — never leave the title orphaned at page bottom.
  cursorY = ensureSpace(doc, cursorY, 60, headerImg);
  cursorY = drawH2(doc, t.improvements, cursorY);

  (autoTable as any)(doc, {
    startY: cursorY,
    margin: { left: MARGIN, right: MARGIN },
    head: [[t.tableHeads.priority, t.tableHeads.area, t.tableHeads.direction]],
    body: top.map(r => [r.priority.toUpperCase(), softWrap(r.category), softWrap(r.action)]),
    theme: 'grid',
    styles: { font: 'Montserrat', fontSize: 9, cellPadding: 4, valign: 'top', lineHeight: 1.3, textColor: COLORS.black, lineWidth: 0.1, lineColor: COLORS.border },
    headStyles: { fillColor: COLORS.netpeakTableHead, textColor: COLORS.black, font: 'Montserrat', fontStyle: 'bold', halign: 'left', fontSize: 8, cellPadding: 3 },
    columnStyles: { 0: { cellWidth: 28, fontStyle: 'bold' }, 1: { cellWidth: 32 }, 2: { cellWidth: 'auto' } },
    alternateRowStyles: { fillColor: COLORS.netpeakTableAlt },
    didParseCell: (data: any) => {
      if (data.section === 'body' && data.column.index === 0) {
        const text = data.cell.raw;
        if (text === 'HIGH') data.cell.styles.textColor = COLORS.danger;
        else if (text === 'MEDIUM') data.cell.styles.textColor = COLORS.warning;
        else data.cell.styles.textColor = COLORS.success;
      }
    },
  });
  return (doc as any).lastAutoTable.finalY + 12;
};

/**
 * Renders a horizontal chip list (used for keyword gaps / LSI / entities).
 * Unified style across all three: light-cyan pill with brand-blue text.
 * Auto-paginates: when adding a chip would push below the page bottom,
 * starts a new page (with brand banner) and the section's H2 again.
 */
const drawChipList = (
  doc: jsPDF,
  title: string,
  items: string[],
  cursorY: number,
  _accentColor: [number, number, number],
  headerImg: ImgAsset = null,
): number => {
  if (!items?.length) return cursorY;
  const pageWidth = doc.internal.pageSize.width;
  const pageHeight = doc.internal.pageSize.height;
  const usableW = pageWidth - MARGIN * 2;
  const bottomMargin = 18;

  // Ensure the section header isn't orphaned at the very bottom.
  cursorY = ensureSpace(doc, cursorY, 24, headerImg);
  cursorY = drawH2(doc, title, cursorY);

  doc.setFont('Montserrat', 'normal');
  doc.setFontSize(9);
  const chipPaddingX = 3.5;
  const chipGap = 2;
  const lineH = 6.5;
  let xCursor = MARGIN;
  let yCursor = cursorY + 2;
  let isContinuation = false;

  const newPageWithHeader = () => {
    doc.addPage();
    const bH = drawBanner(doc, headerImg);
    isContinuation = true;
    yCursor = bH + 14;
    xCursor = MARGIN;
    doc.setFont('Montserrat', 'normal');
    doc.setFontSize(9);
  };

  items.filter(Boolean).forEach((raw) => {
    const text = String(raw).trim();
    if (!text) return;
    const textW = doc.getTextWidth(text);
    const chipW = textW + chipPaddingX * 2;
    if (xCursor + chipW > MARGIN + usableW) {
      xCursor = MARGIN;
      yCursor += lineH;
    }
    if (yCursor + 2 > pageHeight - bottomMargin) {
      newPageWithHeader();
    }
    doc.setFillColor(...COLORS.netpeakTableAlt);
    doc.roundedRect(xCursor, yCursor - 3.8, chipW, lineH - 1.2, 1.5, 1.5, 'F');
    doc.setTextColor(...COLORS.netpeakAccent);
    doc.text(text, xCursor + chipPaddingX, yCursor);
    xCursor += chipW + chipGap;
  });

  return yCursor + 8;
};

/** Sentiment block: large score on the left, label + explanation on the right. */
const drawSentiment = (doc: jsPDF, result: AnalysisResult, cursorY: number, lang: Lang): number => {
  const t = I18N[lang];
  if (!result.sentiment) return cursorY;

  const pageWidth = doc.internal.pageSize.width;
  cursorY = drawH2(doc, t.sentiment, cursorY);

  const fullW = pageWidth - MARGIN * 2;
  const textX = MARGIN + 30;
  const textW = fullW - 38;

  // Pre-compute explanation lines to make the card auto-size to fit.
  doc.setFont('Montserrat', 'normal');
  doc.setFontSize(9);
  const lines = (doc.splitTextToSize(softWrap(result.sentiment.explanation || ''), textW) as string[]).slice(0, 6);
  const explanationH = lines.length * 4.5;
  const cardH = Math.max(34, explanationH + 12); // breathe at least 6mm top + 6mm bottom

  // Background card
  doc.setFillColor(...COLORS.netpeakTableAlt);
  doc.setDrawColor(...COLORS.border);
  doc.setLineWidth(0.2);
  doc.roundedRect(MARGIN, cursorY, fullW, cardH, 2, 2, 'FD');

  // Score + label — vertically centered as a single block on the left.
  // jsPDF text uses BASELINE positioning. Cap-height of N-pt text ≈ N * 0.72 / 2.83 mm.
  const scoreNum = result.sentiment.score ?? 0;
  const scoreColor = scoreNum >= 70 ? COLORS.success : scoreNum >= 40 ? COLORS.warning : COLORS.danger;
  const scoreCap = 22 * 0.72 / 2.83;   // ~5.6 mm (visual height of "52")
  const labelCap = 7 * 0.72 / 2.83;    // ~1.8 mm
  const gapBetween = 2;
  const blockVisH = scoreCap + gapBetween + labelCap;
  // Visual block top inside the card:
  const blockVisTop = cursorY + (cardH - blockVisH) / 2;

  doc.setFont('Montserrat', 'bold');
  doc.setFontSize(22);
  doc.setTextColor(...scoreColor);
  // Score baseline = block top + score cap height.
  doc.text(`${scoreNum}`, MARGIN + 8, blockVisTop + scoreCap);

  doc.setFont('Montserrat', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(...COLORS.netpeakAccent);
  // Label baseline = block top + score cap + gap + label cap.
  doc.text((result.sentiment.label || '').toUpperCase(), MARGIN + 8, blockVisTop + scoreCap + gapBetween + labelCap);

  // Explanation — vertically centered against the card middle.
  doc.setFont('Montserrat', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...COLORS.black);
  const lineCap = 9 * 0.72 / 2.83; // ~2.3 mm visual height of one line
  const explVisH = lineCap + (lines.length - 1) * 4.5;
  const explTop = cursorY + (cardH - explVisH) / 2;
  // First line baseline: explTop + lineCap
  lines.forEach((line, idx) => doc.text(line, textX, explTop + lineCap + idx * 4.5));

  return cursorY + cardH + 10;
};

// ─── Per-format reports ──────────────────────────────────────────────────────

const buildReport = async (result: AnalysisResult, format: ReportFormat, langOverride?: Lang) => {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  await ensureMontserratFont(doc);

  const lang: Lang = langOverride ?? result.language ?? 'en';
  const t = I18N[lang];

  // Load brand assets in parallel (graceful fallback if missing).
  const [headerImg, starImg] = await Promise.all([
    tryLoadImage('/netpeak-header.png'),
    tryLoadImage('/netpeak-footer-star.png'),
  ]);

  const bannerH = drawBanner(doc, headerImg);
  let cursorY = bannerH + 12;

  const title = format === 'brief' ? t.briefTitle : t.fullTitle;
  cursorY = drawH1(doc, title, cursorY);
  cursorY = drawUrl(doc, result.url, cursorY);
  cursorY = drawScoreCards(doc, result, cursorY);

  const summaryTitle = format === 'brief' ? t.briefSummary : t.summary;
  cursorY = drawSummaryBlock(doc, result.summary, cursorY, summaryTitle);

  cursorY = drawStrengthsWeaknesses(doc, result, cursorY, lang, true, headerImg);

  if (format === 'full') {
    drawRecommendationsFull(doc, result, headerImg, lang);
    // Continue right after the recommendations table — no forced page break.
    // ensureSpace handles pagination per section.
    let cy = ((doc as any).lastAutoTable?.finalY ?? cursorY) + 12;
    cy = ensureSpace(doc, cy, 40, headerImg);
    cy = drawSentiment(doc, result, cy, lang);
    cy = drawChipList(doc, t.keywordGaps,  result.keywordGaps  || [], cy, COLORS.danger,        headerImg);
    cy = drawChipList(doc, t.lsiKeywords,  result.lsiKeywords  || [], cy, COLORS.netpeakAccent, headerImg);
    cy = drawChipList(doc, t.llmEntities,  result.llmEntities  || [], cy, COLORS.success,      headerImg);
  } else if (format === 'brief') {
    cursorY = drawRecommendationsBrief(doc, result, cursorY, lang, headerImg);
    cursorY = ensureSpace(doc, cursorY, 40, headerImg);
    cursorY = drawSentiment(doc, result, cursorY, lang);
  }

  drawFooter(doc, starImg, lang);
  return doc;
};

// ─── Public API ──────────────────────────────────────────────────────────────

export const generatePdfReport = async (result: AnalysisResult, format: ReportFormat = 'full') => {
  const doc = await buildReport(result, format);
  doc.save(`audit-${format}-${Date.now()}.pdf`);
};

// ─── Bulk strategy report ────────────────────────────────────────────────────

const buildBulkPdf = async (summary: BulkSummary, urls: string[], lang: Lang = 'en'): Promise<{ doc: jsPDF; filename: string }> => {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  await ensureMontserratFont(doc);
  const t = I18N[lang];

  const [headerImg, starImg] = await Promise.all([
    tryLoadImage('/netpeak-header.png'),
    tryLoadImage('/netpeak-footer-star.png'),
  ]);

  const bannerH = drawBanner(doc, headerImg);
  let cursorY = bannerH + 12;
  cursorY = drawH1(doc, t.bulkTitle, cursorY);

  // List the actual URLs analysed (small italic blue, one per line).
  // Each rendered line gets a clickable link overlay pointing at the full
  // original URL, so wrapping doesn't truncate the href.
  doc.setFont('Montserrat', 'italic');
  doc.setFontSize(9);
  doc.setTextColor(...COLORS.netpeakAccent);
  const pageWidth = doc.internal.pageSize.width;
  const urlMaxW = pageWidth - MARGIN * 2;
  urls.forEach((u) => {
    const breakable = u.replace(/([/?&=#._-])/g, '$1​');
    const lines = doc.splitTextToSize(breakable, urlMaxW) as string[];
    lines.forEach((line) => {
      const visible = line.replace(/​/g, '');
      doc.text(visible, MARGIN, cursorY);
      const w = doc.getTextWidth(visible);
      doc.link(MARGIN, cursorY - 3.0, w, 4.5, { url: u });
      cursorY += 4.5;
    });
    cursorY += 0.5;
  });
  cursorY += 6;

  // ─── Aggregated Score (compact KPI) ──────────────────────────────────────
  const kpiW = 60;
  const kpiH = 30;
  doc.setFillColor(...COLORS.netpeakTableAlt);
  doc.setDrawColor(...COLORS.border);
  doc.roundedRect(MARGIN, cursorY, kpiW, kpiH, 2, 2, 'FD');
  doc.setFont('Montserrat', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...COLORS.netpeakAccent);
  doc.text(t.overallScore.toUpperCase(), MARGIN + 6, cursorY + 10);
  const scoreColor = summary.overallScore >= 80 ? COLORS.success : summary.overallScore >= 50 ? COLORS.warning : COLORS.danger;
  doc.setTextColor(...scoreColor);
  doc.setFontSize(20);
  doc.text(`${summary.overallScore}`, MARGIN + 6, cursorY + 24);
  const scoreW = doc.getTextWidth(`${summary.overallScore}`);
  doc.setFontSize(10);
  doc.setTextColor(...COLORS.slateLight);
  doc.text('/100', MARGIN + 6 + scoreW + 1, cursorY + 24);

  // ─── Trust Standing — full-width block to the right of score ─────────────
  const trustX = MARGIN + kpiW + 8;
  const trustW = pageWidth - MARGIN - trustX;
  doc.setFillColor(...COLORS.netpeakTableAlt);
  doc.setDrawColor(...COLORS.border);
  doc.roundedRect(trustX, cursorY, trustW, kpiH, 2, 2, 'FD');
  doc.setFont('Montserrat', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...COLORS.netpeakAccent);
  doc.text(t.trustLevel.toUpperCase(), trustX + 6, cursorY + 7);

  doc.setFont('Montserrat', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(...COLORS.black);
  const trustText = softWrap(summary.domainAuthorityEstimate);
  const trustLines = doc.splitTextToSize(trustText, trustW - 12) as string[];
  trustLines.forEach((line, idx) => {
    if (idx >= 4) return; // hard cap at 4 lines visually
    doc.text(line, trustX + 6, cursorY + 13 + idx * 4.5);
  });

  cursorY += kpiH + 12;

  // ─── Strategic Directive ────────────────────────────────────────────────
  cursorY = ensureSpace(doc, cursorY, 30, headerImg);
  cursorY = drawH2(doc, t.strategicAdvice, cursorY);
  (autoTable as any)(doc, {
    startY: cursorY,
    margin: { left: MARGIN, right: MARGIN },
    body: [[softWrap(summary.strategicAdvice)]],
    theme: 'plain',
    styles: { font: 'Montserrat', fontSize: 11, textColor: COLORS.black, lineHeight: 1.4, cellPadding: 4, fillColor: COLORS.netpeakTableAlt, overflow: 'linebreak' },
  });
  cursorY = (doc as any).lastAutoTable.finalY + 10;

  // ─── Core Growth Pillars (СТОВП-prefix stripped) ────────────────────────
  cursorY = ensureSpace(doc, cursorY, 50, headerImg);
  cursorY = drawH2(doc, t.pillars, cursorY);
  (autoTable as any)(doc, {
    startY: cursorY,
    margin: { left: MARGIN, right: MARGIN },
    head: [[t.tableHeads.pillar, t.tableHeads.strategy]],
    body: summary.strategicPillars
      .filter(p => isMeaningful(p.title) || isMeaningful(p.description))
      .map(p => [softWrap(stripPillarPrefix(p.title)), softWrap(p.description)]),
    theme: 'grid',
    styles: { font: 'Montserrat', fontSize: 9, cellPadding: 4, valign: 'middle', lineHeight: 1.3, textColor: COLORS.black, lineColor: COLORS.border, lineWidth: 0.1, overflow: 'linebreak' },
    headStyles: { fillColor: COLORS.netpeakTableHead, textColor: COLORS.black, font: 'Montserrat', fontStyle: 'bold', halign: 'left', fontSize: 8, cellPadding: 3 },
    columnStyles: { 0: { cellWidth: 50, fontStyle: 'bold', fillColor: COLORS.netpeakTableAlt }, 1: { cellWidth: 'auto' } },
  });
  cursorY = (doc as any).lastAutoTable.finalY + 12;

  // ─── Execution Roadmap (filtered, plain rows — no nested numbering) ─────
  const cleanRoadmap = (summary.technicalRoadmap || []).filter(isMeaningful);
  if (cleanRoadmap.length) {
    cursorY = ensureSpace(doc, cursorY, 40, headerImg);
    cursorY = drawH2(doc, t.roadmap, cursorY);
    (autoTable as any)(doc, {
      startY: cursorY,
      margin: { left: MARGIN, right: MARGIN },
      head: [[t.roadmap]],
      body: cleanRoadmap.map(step => [softWrap(step)]),
      theme: 'grid',
      headStyles: { fillColor: COLORS.netpeakTableHead, textColor: COLORS.black, font: 'Montserrat', fontStyle: 'bold', halign: 'left', fontSize: 8, cellPadding: 3 },
      styles: { font: 'Montserrat', fontSize: 9, cellPadding: 3, textColor: COLORS.black, lineColor: COLORS.border, lineWidth: 0.1, overflow: 'linebreak' },
      alternateRowStyles: { fillColor: COLORS.netpeakTableAlt },
    });
    cursorY = (doc as any).lastAutoTable.finalY + 10;
  }

  // ─── Systemic Failures (filtered, plain rows — no "!" prefix) ───────────
  const cleanFailures = (summary.topCriticalFixes || []).filter(isMeaningful);
  if (cleanFailures.length) {
    cursorY = ensureSpace(doc, cursorY, 40, headerImg);
    cursorY = drawH2(doc, t.failures, cursorY);
    (autoTable as any)(doc, {
      startY: cursorY,
      margin: { left: MARGIN, right: MARGIN },
      head: [[t.failures]],
      body: cleanFailures.map(fix => [softWrap(fix)]),
      theme: 'grid',
      headStyles: { fillColor: COLORS.netpeakTableHead, textColor: COLORS.black, font: 'Montserrat', fontStyle: 'bold', halign: 'left', fontSize: 8, cellPadding: 3 },
      styles: { font: 'Montserrat', fontSize: 9, cellPadding: 3, textColor: COLORS.black, lineColor: COLORS.border, lineWidth: 0.1, overflow: 'linebreak' },
      alternateRowStyles: { fillColor: COLORS.netpeakTableAlt },
    });
    cursorY = (doc as any).lastAutoTable.finalY + 12;
  }

  // ─── Semantic Gap Analysis (parsed into a bullet list) ───────────────────
  const gapItems = splitNumberedList(summary.contentGapAnalysis || '');
  const usableW = pageWidth - MARGIN * 2;
  doc.setFont('Montserrat', 'normal');
  doc.setFontSize(10);
  const gapEstLines = gapItems
    .map(t => (doc.splitTextToSize(softWrap(t), usableW - 10) as string[]).length)
    .reduce((a, b) => a + b, 0);
  const gapNeeded = 14 + gapEstLines * 5;
  cursorY = ensureSpace(doc, cursorY, gapNeeded, headerImg);
  cursorY = drawH2(doc, t.semanticGap, cursorY);

  if (gapItems.length > 1) {
    // Render as a clean bullet list
    let y = cursorY;
    doc.setFont('Montserrat', 'normal');
    doc.setFontSize(10);
    gapItems.forEach((it) => {
      const wrapped = doc.splitTextToSize(softWrap(it), usableW - 6) as string[];
      doc.setTextColor(...COLORS.netpeakAccent);
      doc.setFont('Montserrat', 'bold');
      doc.text('•', MARGIN, y);
      doc.setTextColor(...COLORS.black);
      doc.setFont('Montserrat', 'normal');
      wrapped.forEach((line, idx) => doc.text(line, MARGIN + 5, y + idx * 4.5));
      y += wrapped.length * 4.5 + 2;
    });
    cursorY = y + 4;
  } else {
    // Single paragraph fallback
    (autoTable as any)(doc, {
      startY: cursorY,
      margin: { left: MARGIN, right: MARGIN },
      body: [[softWrap(summary.contentGapAnalysis || '')]],
      theme: 'plain',
      styles: { font: 'Montserrat', fontSize: 10, textColor: COLORS.black, lineHeight: 1.4, cellPadding: 0, overflow: 'linebreak' },
    });
    cursorY = (doc as any).lastAutoTable.finalY + 8;
  }

  // ─── Aggregated insights across all analysed URLs ────────────────────────
  const kwGaps = (summary.aggregatedKeywordGaps || []).slice(0, 50);
  const lsi    = (summary.aggregatedLsiKeywords  || []).slice(0, 50);
  const ents   = (summary.aggregatedLlmEntities  || []).slice(0, 50);

  if (kwGaps.length) cursorY = drawChipList(doc, t.keywordGaps, kwGaps, cursorY + 4, COLORS.danger, headerImg);
  if (lsi.length)    cursorY = drawChipList(doc, t.lsiKeywords, lsi,    cursorY,     COLORS.netpeakAccent, headerImg);
  if (ents.length)   cursorY = drawChipList(doc, t.llmEntities, ents,   cursorY,     COLORS.success, headerImg);

  drawFooter(doc, starImg, lang);
  return { doc, filename: `website-strategy-${new Date().toISOString().slice(0, 10)}.pdf` };
};

export const generateBulkPdfReport = async (summary: BulkSummary, urls: string[], lang: Lang = 'en') => {
  const { doc, filename } = await buildBulkPdf(summary, urls, lang);
  doc.save(filename);
};
