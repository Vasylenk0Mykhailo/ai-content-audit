/**
 * Generates an editable .docx report from an AnalysisResult.
 * Uses the `docx` library — all output is editable in Word/Google Docs.
 * Visual style mirrors the PDF: Netpeak banner image as header, star icon in
 * the footer, Arial typeface, brand-blue accents.
 */
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  Footer,
  Header,
  HorizontalPositionAlign,
  HorizontalPositionRelativeFrom,
  ImageRun,
  Packer,
  PageOrientation,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  TextWrappingSide,
  TextWrappingType,
  UnderlineType,
  VerticalPositionAlign,
  VerticalPositionRelativeFrom,
  WidthType,
} from 'docx';
import type { AnalysisResult, BulkSummary, ReportFormat } from '../types';

// Netpeak palette (hex without # for docx)
const COLOR = {
  accent: '29ABE2',
  bannerBg: 'A7D5F0',
  altBg: 'E0F0FA',
  black: '000000',
  slate: '475569',
  slateMid: '64748B',
  border: 'C8DCEB',
  success: '10B981',
  warning: 'F59E0B',
  danger: 'EF4444',
  white: 'FFFFFF',
};

// Use Arial as the base typeface per brand request — universal, Cyrillic-safe.
const FONT = 'Arial';

type Lang = 'en' | 'ua';

const I18N = {
  en: {
    fullTitle: 'Content Audit Report',
    briefTitle: 'Content Audit Brief',
    bulkTitle: 'Website Strategy',
    summary: 'Executive Summary',
    briefSummary: 'Key Finding',
    strengths: 'Key Strengths',
    weaknesses: 'Critical Issues',
    actionPlan: 'Action Plan & Recommendations',
    improvements: 'Improvement Directions',
    sentiment: 'Sentiment Analysis',
    keywordGaps: 'Keyword Gaps',
    lsiKeywords: 'LSI Entities',
    llmEntities: 'GEO Anchors',
    overallScore: 'Aggregated Score',
    trustLevel: 'Trust Standing',
    strategicAdvice: 'Strategic Directive',
    pillars: 'Core Growth Pillars',
    roadmap: 'Execution Roadmap',
    failures: 'Systemic Failures',
    semanticGap: 'Semantic Gap Analysis',
    seoHealth: 'SEO',
    eeatQuality: 'E-E-A-T',
    geoReadiness: 'GEO',
    priority: 'Priority',
    category: 'Category',
    action: 'Recommendation',
    impact: 'Impact',
    area: 'Area',
    direction: 'Direction',
    fixLabel: 'FIX STEPS:',
  },
  ua: {
    fullTitle: 'Аудит контенту',
    briefTitle: 'Аудит контенту · скорочений звіт',
    bulkTitle: 'Стратегія сайту',
    summary: 'Загальний висновок',
    briefSummary: 'Ключовий висновок',
    strengths: 'Сильні сторони',
    weaknesses: 'Критичні проблеми',
    actionPlan: 'План дій та рекомендації',
    improvements: 'Напрямки покращення',
    sentiment: 'Аналіз тональності',
    keywordGaps: 'Keyword Gaps',
    lsiKeywords: 'LSI Entities',
    llmEntities: 'GEO Anchors',
    overallScore: 'Загальна оцінка',
    trustLevel: 'Рівень довіри',
    strategicAdvice: 'Стратегічний орієнтир',
    pillars: 'Опорні точки росту',
    roadmap: 'Дорожня карта',
    failures: 'Системні проблеми',
    semanticGap: 'Семантичний розрив',
    seoHealth: 'SEO',
    eeatQuality: 'E-E-A-T',
    geoReadiness: 'GEO',
    priority: 'Пріоритет',
    category: 'Категорія',
    action: 'Рекомендація',
    impact: 'Очікуваний ефект',
    area: 'Сфера',
    direction: 'Напрямок',
    fixLabel: 'КОНКРЕТНІ КРОКИ:',
  },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const h1 = (text: string) =>
  new Paragraph({
    spacing: { before: 0, after: 240 },
    children: [new TextRun({ text, bold: true, size: 44, color: COLOR.black, font: FONT })],
  });

const h2 = (text: string) =>
  new Paragraph({
    spacing: { before: 360, after: 180 },
    children: [new TextRun({ text, bold: true, size: 28, color: COLOR.accent, font: FONT })],
  });

const body = (text: string, opts: { italic?: boolean; color?: string } = {}) =>
  new Paragraph({
    spacing: { after: 120 },
    children: [
      new TextRun({
        text,
        size: 22,
        color: opts.color || COLOR.black,
        italics: opts.italic,
        font: FONT,
      }),
    ],
  });

const bullet = (text: string, accent = COLOR.accent) =>
  new Paragraph({
    spacing: { after: 60 },
    indent: { left: 360 },
    children: [
      new TextRun({ text: '• ', bold: true, color: accent, size: 24, font: FONT }),
      new TextRun({ text, size: 22, color: COLOR.black, font: FONT }),
    ],
  });

/**
 * Renders a URL as a real clickable hyperlink (not just blue text).
 * Word's auto-detect can't span line wraps, so we have to wrap the runs in
 * an ExternalHyperlink — without this the user gets a 404 when the visible
 * text wraps at a slash and Word treats only the first line as the href.
 */
const link = (text: string) =>
  new Paragraph({
    spacing: { after: 240 },
    children: [
      new ExternalHyperlink({
        link: text,
        children: [
          new TextRun({
            text,
            size: 20,
            color: COLOR.accent,
            italics: true,
            font: FONT,
            underline: { type: UnderlineType.SINGLE, color: COLOR.accent },
          }),
        ],
      }),
    ],
  });

/**
 * Fetches a PNG asset and re-encodes it through `<canvas>` so any embedded
 * `iCCP` color-profile chunk is stripped. Word double-converts PNGs that
 * carry an sRGB profile (read → convert → display) which visibly desaturates
 * the rendered image. Canvas-exported PNGs have no embedded profile, so Word
 * shows them straight.
 */
async function fetchAsset(path: string): Promise<ArrayBuffer | null> {
  try {
    const res = await fetch(path);
    if (!res.ok) return null;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = (e) => reject(e);
        i.src = url;
      });
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return await blob.arrayBuffer(); // fallback to raw bytes
      ctx.drawImage(img, 0, 0);
      const reencoded: Blob = await new Promise((resolve, reject) => {
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error('canvas.toBlob returned null'))),
          'image/png',
        );
      });
      return await reencoded.arrayBuffer();
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch {
    return null;
  }
}

/**
 * Word page header.
 * Image is floating with "Square" wrap so the user can resize/move it freely
 * in Word, and dimensions match the natural aspect of the asset
 * (≈21cm × 2.49cm → 595pt × 70.5pt) — no stretching, no fade.
 */
function buildPageHeader(headerImage: ArrayBuffer | null): Header {
  if (!headerImage) {
    return new Header({
      children: [
        new Paragraph({
          children: [
            new TextRun({ text: 'netpeak', bold: true, size: 32, color: COLOR.accent, font: FONT }),
            new TextRun({ text: '  |  ', size: 28, color: COLOR.border, font: FONT }),
            new TextRun({ text: 'POWERED BY AI SOLUTIONS', bold: true, size: 16, color: COLOR.slate, font: FONT, characterSpacing: 24 }),
          ],
        }),
      ],
    });
  }
  // docx `transformation` is in PIXELS at 96 DPI:
  //   A4 width  = 21 cm  = 8.268"  × 96 = 794 px
  //   A4 height = 29.7cm = 11.69"  × 96 = 1123 px
  // Source asset is 21 cm × 2.49 cm → 794 × 94 px at natural aspect.
  return new Header({
    children: [
      new Paragraph({
        spacing: { after: 0 },
        children: [
          new ImageRun({
            data: headerImage,
            transformation: { width: 794, height: 94 },
            type: 'png',
            floating: {
              horizontalPosition: {
                relative: HorizontalPositionRelativeFrom.PAGE,
                align: HorizontalPositionAlign.CENTER,
              },
              verticalPosition: {
                relative: VerticalPositionRelativeFrom.PAGE,
                align: VerticalPositionAlign.TOP,
              },
              wrap: { type: TextWrappingType.SQUARE, side: TextWrappingSide.BOTH_SIDES },
              margins: { left: 0, right: 0, top: 0, bottom: 100 },
            },
          } as any),
        ],
      }),
    ],
  });
}

/**
 * Word page footer.
 * Star icon as a floating "Square" wrap image in the bottom-right corner,
 * sized to match its natural aspect (~0.76cm square → 21pt).
 */
function buildPageFooter(starImage: ArrayBuffer | null): Footer {
  if (!starImage) {
    return new Footer({
      children: [
        new Paragraph({
          alignment: AlignmentType.RIGHT,
          children: [new TextRun({ text: 'Netpeak · AI Solutions', size: 14, color: COLOR.slateMid, font: FONT })],
        }),
      ],
    });
  }
  // Star asset natural size 0.76 × 0.76 cm → 29 × 29 px at 96 DPI.
  // Position relative to TEXT MARGIN (not PAGE edge) — that's why earlier
  // versions sat glued to the paper edge. With MARGIN relative + RIGHT/BOTTOM
  // alignment, the star ends up at the bottom-right of the text content area
  // (i.e. inside the page margins), which is what we want visually.
  return new Footer({
    children: [
      new Paragraph({
        spacing: { after: 0 },
        children: [
          new ImageRun({
            data: starImage,
            transformation: { width: 29, height: 29 },
            type: 'png',
            floating: {
              horizontalPosition: {
                relative: HorizontalPositionRelativeFrom.MARGIN,
                align: HorizontalPositionAlign.RIGHT,
              },
              verticalPosition: {
                relative: VerticalPositionRelativeFrom.MARGIN,
                align: VerticalPositionAlign.BOTTOM,
              },
              wrap: { type: TextWrappingType.SQUARE, side: TextWrappingSide.BOTH_SIDES },
              margins: { left: 180, right: 180, top: 180, bottom: 180 },
            },
          } as any),
        ],
      }),
    ],
  });
}

function scoreCell(label: string, value: number) {
  const color = value >= 80 ? COLOR.success : value >= 50 ? COLOR.warning : COLOR.danger;
  return new TableCell({
    margins: { top: 200, bottom: 200, left: 200, right: 200 },
    shading: { type: ShadingType.CLEAR, color: 'auto', fill: COLOR.altBg },
    children: [
      new Paragraph({
        spacing: { after: 80 },
        children: [new TextRun({ text: label.toUpperCase(), bold: true, size: 16, color: COLOR.accent, font: FONT, characterSpacing: 24 })],
      }),
      new Paragraph({
        children: [
          new TextRun({ text: `${value}`, bold: true, size: 40, color, font: FONT }),
          new TextRun({ text: ' /100', size: 18, color: COLOR.slateMid, font: FONT }),
        ],
      }),
    ],
  });
}

function scoresRow(result: AnalysisResult, t: typeof I18N.en): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.NONE, size: 0, color: 'auto' },
      bottom: { style: BorderStyle.NONE, size: 0, color: 'auto' },
      left: { style: BorderStyle.NONE, size: 0, color: 'auto' },
      right: { style: BorderStyle.NONE, size: 0, color: 'auto' },
      insideHorizontal: { style: BorderStyle.NONE, size: 0, color: 'auto' },
      insideVertical: { style: BorderStyle.NONE, size: 8, color: COLOR.white },
    },
    rows: [
      new TableRow({
        children: [
          scoreCell(t.seoHealth, result.seoScore),
          scoreCell(t.eeatQuality, result.eeatScore),
          scoreCell(t.geoReadiness, result.llmOptimizationScore),
        ],
      }),
    ],
  });
}

function recommendationsTable(items: AnalysisResult['recommendations'], t: typeof I18N.en, fixLabel: string): Table {
  const headRow = new TableRow({
    tableHeader: true,
    children: [t.priority, t.category, t.action, t.impact].map(text =>
      new TableCell({
        shading: { type: ShadingType.CLEAR, color: 'auto', fill: COLOR.bannerBg },
        margins: { top: 120, bottom: 120, left: 120, right: 120 },
        children: [
          new Paragraph({
            children: [new TextRun({ text: text.toUpperCase(), bold: true, size: 18, color: COLOR.black, font: FONT, characterSpacing: 24 })],
          }),
        ],
      }),
    ),
  });

  const rows = (items || []).map((r, idx) => {
    const priorityColor =
      r.priority === 'High' ? COLOR.danger :
      r.priority === 'Medium' ? COLOR.warning :
      COLOR.success;
    const fill = idx % 2 === 0 ? COLOR.white : COLOR.altBg;
    return new TableRow({
      children: [
        new TableCell({
          shading: { type: ShadingType.CLEAR, color: 'auto', fill },
          margins: { top: 120, bottom: 120, left: 120, right: 120 },
          children: [
            new Paragraph({
              children: [new TextRun({ text: r.priority.toUpperCase(), bold: true, size: 18, color: priorityColor, font: FONT })],
            }),
          ],
        }),
        new TableCell({
          shading: { type: ShadingType.CLEAR, color: 'auto', fill },
          margins: { top: 120, bottom: 120, left: 120, right: 120 },
          children: [body(r.category)],
        }),
        new TableCell({
          shading: { type: ShadingType.CLEAR, color: 'auto', fill },
          margins: { top: 120, bottom: 120, left: 120, right: 120 },
          children: [
            new Paragraph({ spacing: { after: 80 }, children: [new TextRun({ text: r.action, bold: true, size: 22, color: COLOR.black, font: FONT })] }),
            body(r.description),
            new Paragraph({
              spacing: { before: 120, after: 60 },
              children: [new TextRun({ text: fixLabel, bold: true, size: 18, color: COLOR.accent, font: FONT, characterSpacing: 12 })],
            }),
            ...(r.fixSteps || []).filter(Boolean).map(step => bullet(step, COLOR.accent)),
          ],
        }),
        new TableCell({
          shading: { type: ShadingType.CLEAR, color: 'auto', fill },
          margins: { top: 120, bottom: 120, left: 120, right: 120 },
          children: [body(r.expectedImpact, { italic: true, color: COLOR.accent })],
        }),
      ],
    });
  });

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    columnWidths: [1100, 1300, 5500, 2500],
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: COLOR.border },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: COLOR.border },
      left: { style: BorderStyle.SINGLE, size: 4, color: COLOR.border },
      right: { style: BorderStyle.SINGLE, size: 4, color: COLOR.border },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: COLOR.border },
      insideVertical: { style: BorderStyle.SINGLE, size: 4, color: COLOR.border },
    },
    rows: [headRow, ...rows],
  });
}

function briefRecommendationsTable(items: AnalysisResult['recommendations'], t: typeof I18N.en): Table {
  const top = (items || []).slice(0, 8);
  const headRow = new TableRow({
    tableHeader: true,
    children: [t.priority, t.area, t.direction].map(text =>
      new TableCell({
        shading: { type: ShadingType.CLEAR, color: 'auto', fill: COLOR.bannerBg },
        margins: { top: 120, bottom: 120, left: 120, right: 120 },
        children: [
          new Paragraph({
            children: [new TextRun({ text: text.toUpperCase(), bold: true, size: 18, color: COLOR.black, font: FONT, characterSpacing: 24 })],
          }),
        ],
      }),
    ),
  });

  const rows = top.map((r, idx) => {
    const priorityColor =
      r.priority === 'High' ? COLOR.danger :
      r.priority === 'Medium' ? COLOR.warning :
      COLOR.success;
    const fill = idx % 2 === 0 ? COLOR.white : COLOR.altBg;
    return new TableRow({
      children: [
        new TableCell({
          shading: { type: ShadingType.CLEAR, color: 'auto', fill },
          margins: { top: 120, bottom: 120, left: 120, right: 120 },
          children: [new Paragraph({ children: [new TextRun({ text: r.priority.toUpperCase(), bold: true, size: 18, color: priorityColor, font: FONT })] })],
        }),
        new TableCell({
          shading: { type: ShadingType.CLEAR, color: 'auto', fill },
          margins: { top: 120, bottom: 120, left: 120, right: 120 },
          children: [body(r.category)],
        }),
        new TableCell({
          shading: { type: ShadingType.CLEAR, color: 'auto', fill },
          margins: { top: 120, bottom: 120, left: 120, right: 120 },
          children: [new Paragraph({ children: [new TextRun({ text: r.action, bold: true, size: 22, color: COLOR.black, font: FONT })] })],
        }),
      ],
    });
  });

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    columnWidths: [1200, 1800, 7000],
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: COLOR.border },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: COLOR.border },
      left: { style: BorderStyle.SINGLE, size: 4, color: COLOR.border },
      right: { style: BorderStyle.SINGLE, size: 4, color: COLOR.border },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: COLOR.border },
      insideVertical: { style: BorderStyle.SINGLE, size: 4, color: COLOR.border },
    },
    rows: [headRow, ...rows],
  });
}

/**
 * Sentiment card: single-cell table styled like the Strengths/Weaknesses cards
 * in the PDF. Coloured header bar on top, then big score + label + explanation.
 */
/**
 * Sentiment card mirrors PDF screenshot 5: a single light-blue rounded panel,
 * NO blue header bar. Two columns: big score + label on the LEFT, explanation
 * on the RIGHT. The section heading "Sentiment Analysis" is rendered as a
 * separate h2() before this card, exactly like in the PDF.
 */
function sentimentCard(sentiment: NonNullable<AnalysisResult['sentiment']>): Table {
  const score = sentiment.score ?? 0;
  const scoreColor = score >= 70 ? COLOR.success : score >= 40 ? COLOR.warning : COLOR.danger;
  // A4 (21cm) − 2× left/right margins (1000 twips ≈ 1.76cm each) ≈ 9920 twips usable.
  const TOTAL_W = 9900;
  const SCORE_COL = 2200; // ~3.9 cm
  const TEXT_COL = TOTAL_W - SCORE_COL;

  return new Table({
    width: { size: TOTAL_W, type: WidthType.DXA },
    columnWidths: [SCORE_COL, TEXT_COL],
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: COLOR.border },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: COLOR.border },
      left: { style: BorderStyle.SINGLE, size: 4, color: COLOR.border },
      right: { style: BorderStyle.SINGLE, size: 4, color: COLOR.border },
      insideHorizontal: { style: BorderStyle.NONE, size: 0, color: 'auto' },
      insideVertical: { style: BorderStyle.NONE, size: 0, color: 'auto' },
    },
    rows: [
      new TableRow({
        children: [
          // Left cell: big score number + label, on light-blue background
          new TableCell({
            width: { size: SCORE_COL, type: WidthType.DXA },
            shading: { type: ShadingType.CLEAR, color: 'auto', fill: COLOR.altBg },
            margins: { top: 320, bottom: 320, left: 300, right: 180 },
            verticalAlign: 'center' as any,
            children: [
              new Paragraph({
                spacing: { after: 60 },
                children: [
                  new TextRun({ text: `${score}`, bold: true, size: 56, color: scoreColor, font: FONT }),
                  new TextRun({ text: ' /100', size: 18, color: COLOR.slateMid, font: FONT }),
                ],
              }),
              new Paragraph({
                children: [
                  new TextRun({
                    text: (sentiment.label || '').toUpperCase(),
                    bold: true,
                    size: 18,
                    color: COLOR.accent,
                    font: FONT,
                    characterSpacing: 28,
                  }),
                ],
              }),
            ],
          }),
          // Right cell: explanation, same light-blue background
          new TableCell({
            width: { size: TEXT_COL, type: WidthType.DXA },
            shading: { type: ShadingType.CLEAR, color: 'auto', fill: COLOR.altBg },
            margins: { top: 320, bottom: 320, left: 180, right: 300 },
            verticalAlign: 'center' as any,
            children: [
              new Paragraph({
                children: [new TextRun({ text: sentiment.explanation || '', size: 22, color: COLOR.black, font: FONT })],
              }),
            ],
          }),
        ],
      }),
    ],
  });
}

/** Packs a docx Document into a Blob and triggers a browser download. */
async function downloadDocx(doc: Document, filename: string): Promise<void> {
  const blob = await Packer.toBlob(doc);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
}

function chipParagraph(items: string[]): Paragraph {
  const runs: TextRun[] = [];
  items.forEach((it, i) => {
    runs.push(new TextRun({ text: it, size: 20, color: COLOR.accent, font: FONT }));
    if (i < items.length - 1) {
      runs.push(new TextRun({ text: '  ·  ', size: 20, color: COLOR.slateMid, font: FONT }));
    }
  });
  return new Paragraph({ spacing: { after: 240 }, children: runs });
}

// ─── Public API: single-URL audit ───────────────────────────────────────────

/** Builds the docx `Document` object for a single audit. */
async function buildSingleDocx(
  result: AnalysisResult,
  lang: Lang,
  format: ReportFormat,
): Promise<Document> {
  const t = I18N[lang];
  const [headerImage, starImage] = await Promise.all([
    fetchAsset('/netpeak-header.png'),
    fetchAsset('/netpeak-footer-star.png'),
  ]);

  const sections: any[] = [];
  sections.push(h1(format === 'brief' ? t.briefTitle : t.fullTitle));
  sections.push(link(result.url));
  sections.push(scoresRow(result, t));
  sections.push(h2(format === 'brief' ? t.briefSummary : t.summary));
  sections.push(body(result.summary));
  sections.push(h2(t.strengths));
  sections.push(...(result.strengths || []).map(s => bullet(s, COLOR.success)));
  sections.push(h2(t.weaknesses));
  sections.push(...(result.weaknesses || []).map(w => bullet(w, COLOR.danger)));

  if (format === 'brief') {
    const top = (result.recommendations || []).slice(0, 8);
    if (top.length) {
      sections.push(h2(t.improvements));
      sections.push(briefRecommendationsTable(top, t));
    }
  } else {
    sections.push(h2(t.actionPlan));
    sections.push(recommendationsTable(result.recommendations || [], t, t.fixLabel));
  }

  if (result.sentiment) {
    sections.push(new Paragraph({ spacing: { before: 240, after: 0 }, children: [] }));
    sections.push(h2(t.sentiment));
    sections.push(sentimentCard(result.sentiment));
    sections.push(new Paragraph({ spacing: { after: 200 }, children: [] }));
  }

  if (result.keywordGaps?.length) sections.push(h2(t.keywordGaps), chipParagraph(result.keywordGaps));
  if (result.lsiKeywords?.length) sections.push(h2(t.lsiKeywords), chipParagraph(result.lsiKeywords));
  if (result.llmEntities?.length) sections.push(h2(t.llmEntities), chipParagraph(result.llmEntities));

  return new Document({
    creator: 'ContentAudit AI',
    title: format === 'brief' ? t.briefTitle : t.fullTitle,
    styles: { default: { document: { run: { font: FONT, size: 22 } } } },
    sections: [
      {
        properties: {
          page: {
            margin: { top: 1800, bottom: 1300, left: 1000, right: 1000 },
            size: { orientation: PageOrientation.PORTRAIT },
          },
        },
        headers: { default: buildPageHeader(headerImage) },
        footers: { default: buildPageFooter(starImage) },
        children: sections,
      },
    ],
  });
}

export async function generateDocxReport(
  result: AnalysisResult,
  lang: Lang = 'en',
  format: ReportFormat = 'full',
): Promise<void> {
  const doc = await buildSingleDocx(result, lang, format);
  await downloadDocx(doc, `audit-${format}-${Date.now()}.docx`);
}

// ─── Public API: bulk strategy ──────────────────────────────────────────────

async function buildBulkDocx(summary: BulkSummary, urls: string[], lang: Lang): Promise<Document> {
  const t = I18N[lang];
  const [headerImage, starImage] = await Promise.all([
    fetchAsset('/netpeak-header.png'),
    fetchAsset('/netpeak-footer-star.png'),
  ]);

  const sections: any[] = [];
  sections.push(h1(t.bulkTitle));
  // Listing the actual URLs analysed (italic, brand-blue, one per line) —
  // each is a real clickable hyperlink so wrapping doesn't truncate the href.
  urls.forEach((u) =>
    sections.push(
      new Paragraph({
        spacing: { after: 60 },
        children: [
          new ExternalHyperlink({
            link: u,
            children: [
              new TextRun({
                text: u,
                size: 18,
                color: COLOR.accent,
                italics: true,
                font: FONT,
                underline: { type: UnderlineType.SINGLE, color: COLOR.accent },
              }),
            ],
          }),
        ],
      }),
    ),
  );
  sections.push(new Paragraph({ spacing: { after: 120 }, children: [] }));
  sections.push(h2(t.strategicAdvice));
  sections.push(body(summary.strategicAdvice, { italic: true }));
  sections.push(h2(t.pillars));

  (summary.strategicPillars || []).forEach(p => {
    const title = (p.title || '').replace(/^\s*(стовп|стовпець|pillar)\s*\d+\s*[:\-–—.]?\s*/i, '').trim();
    sections.push(
      new Paragraph({
        spacing: { before: 200, after: 80 },
        children: [new TextRun({ text: title, bold: true, size: 24, color: COLOR.accent, font: FONT })],
      }),
      body(p.description),
    );
  });

  const cleanRoadmap = (summary.technicalRoadmap || [])
    .filter(s => s && s.trim().length >= 12 && !/^(розділ|section|see|page|p\.)\s*\d+\.?$/i.test(s.trim()));
  if (cleanRoadmap.length) {
    sections.push(h2(t.roadmap), ...cleanRoadmap.map(s => bullet(s)));
  }

  const cleanFailures = (summary.topCriticalFixes || [])
    .filter(s => s && s.trim().length >= 12 && !/^(розділ|section|see|page|p\.)\s*\d+\.?$/i.test(s.trim()));
  if (cleanFailures.length) {
    sections.push(h2(t.failures), ...cleanFailures.map(s => bullet(s, COLOR.danger)));
  }

  if (summary.contentGapAnalysis) {
    sections.push(h2(t.semanticGap), body(summary.contentGapAnalysis));
  }
  if (summary.aggregatedKeywordGaps?.length) sections.push(h2(t.keywordGaps), chipParagraph(summary.aggregatedKeywordGaps.slice(0, 60)));
  if (summary.aggregatedLsiKeywords?.length) sections.push(h2(t.lsiKeywords), chipParagraph(summary.aggregatedLsiKeywords.slice(0, 60)));
  if (summary.aggregatedLlmEntities?.length) sections.push(h2(t.llmEntities), chipParagraph(summary.aggregatedLlmEntities.slice(0, 60)));

  const doc = new Document({
    creator: 'ContentAudit AI',
    title: t.bulkTitle,
    styles: { default: { document: { run: { font: FONT, size: 22 } } } },
    sections: [
      {
        properties: {
          page: {
            // top = 1800 twips ≈ 3.17 cm → leaves ~6 mm clearance under the
            // 2.49-cm banner. bottom = 1300 ≈ 2.29 cm — room for footer star.
            margin: { top: 1800, bottom: 1300, left: 1000, right: 1000 },
            size: { orientation: PageOrientation.PORTRAIT },
          },
        },
        headers: { default: buildPageHeader(headerImage) },
        footers: { default: buildPageFooter(starImage) },
        children: sections,
      },
    ],
  });

  return doc;
}

export async function generateBulkDocxReport(summary: BulkSummary, urls: string[], lang: Lang = 'en'): Promise<void> {
  const doc = await buildBulkDocx(summary, urls, lang);
  await downloadDocx(doc, `website-strategy-${new Date().toISOString().slice(0, 10)}.docx`);
}
