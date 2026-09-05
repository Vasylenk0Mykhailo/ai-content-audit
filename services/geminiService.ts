
import { AnalysisCriteria, AnalysisResult, ModelType, ModelProvider, getModelProvider, AdminSettings, Recommendation, BulkSummary } from "../types";
import { searchQualityGuidelines } from "../data/searchQualityGuidelines";

const strictnessMap: Record<string, number> = { low: 0.5, medium: 0.3, high: 0.1 };

// ─── Page-type-aware prompt supplement ───────────────────────────────────────
// Picked up at runtime and appended to the user-editable admin template so that
// product-card audits don't get the generic "blog article" treatment. Mirrors
// the muscle.ua / Content Rules for LLM/AI (Ecommerce UA) checklist.
const PRODUCT_CARD_BLOCK = `

--- PRODUCT-CARD SPECIFIC CHECKLIST (MANDATORY FOR E-COMMERCE PAGES) ---
The page is a product card. In addition to the generic checks above, you MUST
explicitly audit each of the following blocks and produce recommendations for
the ones that are missing, incomplete, or weak. Quote the exact piece of
on-page content (or its absence) in \`affectedContent\`.

1. ОПИС ТОВАРУ (Product description)
   - Чи присутній розгорнутий опис? Не лише назва + ціна.
   - Чи унікальний він, або це копія з сайту виробника?
   - Чи містить пейн-поінти користувача + сценарії використання?
   - Чи має концентровану 40–60-слівну анотацію для AI/featured snippets?

2. ХАРАКТЕРИСТИКИ ТА СКЛАД (Specs)
   - Склад / матеріал, щільність, розміри, технологія, країна виробництва.
   - Розмірна сітка (для одягу/взуття) — текстом, не лише картинкою.
   - Сумісність / комплектація / гарантія (де доречно).

3. ІНФОРМАЦІЯ ПРО БРЕНД (Brand context)
   - Чи є блок «Про бренд» з історією, технологіями, цінностями?
   - Чи лінкається на категорію бренду / офіційний бренд-стор?

4. ДОДАТКОВІ СЕКЦІЇ (Additional content blocks)
   - FAQ зі specific Q&A для саме цього товару (не загального).
   - Догляд за виробом / інструкція використання.
   - Сценарії: для кого, в яких ситуаціях (B2B/роздріб, спорт/casual тощо).
   - Cross-sell / related products з релевантним анкором.

5. МЕДІА (Media)
   - Кількість і якість фото, lifestyle-кадри, відео або 360°-перегляд.
   - Чи показано продукт у реальному використанні?

6. ВІДГУКИ ТА СОЦДОВЕДЕННЯ (Reviews & social proof)
   - Чи є відгуки на сторінці? З фото? З оцінкою?
   - aggregateRating у schema.org?
   - UGC / Q&A від інших покупців?

7. ТЕХНІЧНА SEO / AI-ВИДИМІСТЬ
   - schema.org Product з повним набором полів (name, brand, sku, gtin,
     description, image, offers, aggregateRating, review, audience, usageInfo).
   - ProductVariant для розмірів/кольорів.
   - Breadcrumbs schema.
   - OpenGraph / Twitter Card з product-specific тегами.

8. КОНВЕРСІЯ ТА UX
   - CTA: чіткий, value-led (не «Замовити», а «Додати до кошика — доставка
     завтра»).
   - Доступність вибору варіантів (розмір/колір) і їх поведінка.
   - Інформація про доставку, повернення, оплату на сторінці.
   - Запас / наявність.

EVERY missing block above MUST become at least one recommendation. Якщо опису
товару немає або він обмежений до 1–2 речень — це HIGH priority. Якщо відсутня
інформація про бренд або характеристики — MEDIUM. Не дозволяй прихованих
блоків («читати далі», табів) обманути тебе: якщо в наданому контенті блока
немає, він відсутній з точки зору LLM/SEO.

`.trim();

const JSON_STRUCTURE = `
MANDATORY JSON STRUCTURE — return ONLY a valid JSON object with no markdown fences:
{
  "seoScore": number (0-100),
  "eeatScore": number (0-100),
  "llmOptimizationScore": number (0-100),
  "isYMYL": boolean,
  "summary": "2-3 sentence executive summary",
  "strengths": ["strength 1", ...],
  "weaknesses": ["weakness 1", ...],
  "keywordGaps": ["gap 1", ...],
  "lsiKeywords": ["lsi 1", ...],
  "llmEntities": ["entity 1", ...],
  "sentiment": {
    "label": "Positive" | "Negative" | "Neutral" | "Mixed",
    "score": number (0-100),
    "explanation": "Why this sentiment was chosen"
  },
  "recommendations": [
    {
      "category": "SEO" | "EEAT" | "Content" | "Technical",
      "priority": "High" | "Medium" | "Low",
      "action": "Specific imperative title",
      "description": "The precise problem — DO NOT be vague.",
      "affectedContent": "MANDATORY: Quote the EXACT sentence or section from the page.",
      "fixSteps": ["Step 1", "Step 2"],
      "expectedImpact": "Specific benefit"
    }
  ]
}`;

/** Routes an LLM call to the correct backend endpoint based on model provider. */
async function callLLM(
  endpoint: 'analyze' | 'summarize',
  model: ModelType,
  prompt: string,
  temperature: number,
  thinkingLevel?: 'minimal' | 'low' | 'medium' | 'high',
): Promise<any> {
  const provider = getModelProvider(model);
  const providerPath = provider === ModelProvider.CLAUDE ? 'claude'
    : provider === ModelProvider.GEMINI ? 'gemini'
    : 'openai';

  const response = await fetch(`/api/${providerPath}/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, temperature, model, thinkingLevel }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `${providerPath} ${endpoint} failed (${response.status})`);
  }

  return response.json();
}

export const analyzeContent = async (
  url: string,
  pageTitle: string,
  content: string,
  criteria: AnalysisCriteria,
  model: ModelType,
  adminSettings: AdminSettings,
  author?: string,
  onProgress?: (msg: string) => void
): Promise<AnalysisResult> => {
  try {
    const temperature = strictnessMap[criteria.strictness] ?? 0.3;
    const langLabel = criteria.language === 'ua' ? 'Ukrainian' : 'English';
    const pageTypeLabel = criteria.pageType === 'product' ? 'product card (e-commerce)' : 'blog article';

    const basePrompt = adminSettings.promptTemplate
      .replace('{{url}}', url)
      .replace('{{content}}', content)
      .replace('{{focusArea}}', criteria.focusArea)
      .replace('{{strictness}}', criteria.strictness)
      .replace('{{customInstructions}}', criteria.customInstructions || 'None')
      .replace('{{auditPoints}}', criteria.selectedAuditPoints?.join(', ') || 'None');

    const pageTypeBlock = criteria.pageType === 'product' ? PRODUCT_CARD_BLOCK : '';

    // Selected Core Audit Points → mandatory coverage block.
    // Even if the admin's template ignores {{auditPoints}}, we always append
    // this block so the LLM is forced to address every dimension the user picked.
    const auditPointsBlock = (criteria.selectedAuditPoints && criteria.selectedAuditPoints.length > 0)
      ? `

--- MANDATORY CORE AUDIT POINTS COVERAGE ---
The user explicitly selected the following audit dimensions. You MUST address
EACH one in your output. For every selected point:
  • Either produce at least one recommendation that targets that dimension
    (set the matching keyword in the \`action\` so it's clear which point
    it covers), OR
  • Add a brief sentence to \`summary\` / \`weaknesses\` explaining the state
    of that dimension on the page.
DO NOT silently skip any selected point. If a dimension is genuinely not
applicable to this page type, explicitly say so in \`weaknesses\` with the
reason.

SELECTED POINTS:
${criteria.selectedAuditPoints.map((p, i) => `  ${i + 1}. ${p}`).join('\n')}
`.trim()
      : '';

    const languageDirective = criteria.language === 'ua'
      ? `OUTPUT LANGUAGE IS UKRAINIAN. Every textual field in the JSON output (summary, strengths,
weaknesses, recommendations.action, recommendations.description, recommendations.affectedContent,
recommendations.fixSteps, recommendations.expectedImpact, sentiment.explanation, lsiKeywords,
llmEntities, keywordGaps) MUST be written in Ukrainian. Technical SEO/HTML terms (schema.org,
E-E-A-T, YMYL, CTA, FAQ, H1/H2, alt-text, sitemap, canonical, GEO, LLM, schema property names like
'aggregateRating') may stay in English. Brand and product names stay in original spelling.
DO NOT respond in English even if the analysed page is in English.`
      : `OUTPUT LANGUAGE IS ENGLISH. Every textual field in the JSON output MUST be written in
English. Technical terms stay in English. Brand and product names stay in original spelling.
DO NOT respond in any other language.`;

    const prompt = `${languageDirective}

${basePrompt}

TITLE: ${pageTitle}
AUTHOR: ${author || 'Not explicitly found'}
PAGE TYPE: ${pageTypeLabel}

CRITICAL INSTRUCTIONS FOR RECOMMENDATIONS:
1. You MUST provide at least 5 to 10 highly specific recommendations.
2. DO NOT give vague or generic recommendations (e.g., "improve readability", "add more keywords").
3. EVERY recommendation MUST identify a specific problem and quote the EXACT text from the page in the \`affectedContent\` field.
4. MANDATORY: If a recommendation relates to E-E-A-T, YMYL status, or Page Quality, you MUST explicitly reference the relevant section or principle from the "GOOGLE SEARCH QUALITY EVALUATOR GUIDELINES" in the \`description\` or \`fixSteps\` field.

ENTITY EXTRACTION RULES (CRITICAL — APPLIES TO \`llmEntities\`, \`lsiKeywords\`, \`keywordGaps\`):
- \`llmEntities\`: ONLY entities, brands, technologies, people or places that are
  ACTUALLY MENTIONED in the page content provided above AND are topically
  relevant to the page subject. Do NOT invent entities. Do NOT include payment
  processors, banks, generic platforms, social networks or unrelated companies
  unless they are the subject of the page or directly discussed in it.
- If the page is about sneakers, do not list banks. If the page is about
  banking, do not list shoe brands. Strict topical match.
- \`lsiKeywords\`: only LSI terms that semantically support the page topic.
- \`keywordGaps\`: only terms a competitor page on the same topic would cover.
- All three arrays should be empty arrays \`[]\` if you cannot satisfy the rules
  honestly — empty is better than off-topic noise.

${pageTypeBlock}

${auditPointsBlock}

GOOGLE SEARCH QUALITY EVALUATOR GUIDELINES (USE AS YOUR EVALUATION STANDARD):
${searchQualityGuidelines}

${languageDirective}
MANDATORY LANGUAGE: ${langLabel}.
${JSON_STRUCTURE}`;

    if (onProgress) onProgress(`PROGRESS:pass1_start`);
    let parsedData = await callLLM('analyze', model, prompt, temperature, criteria.thinkingLevel);
    if (onProgress) onProgress(`PROGRESS:pass1_done`);

    if (criteria.advancedMode) {
      if (onProgress) onProgress(`PROGRESS:pass2_start`);
      const advancedPrompt = `${languageDirective}

You are a Principal SEO & E-E-A-T Auditor. Review this initial audit for:
URL: ${url}
TITLE: ${pageTitle}
AUTHOR: ${author || 'Not explicitly found'}

Original Content:
${content}

Initial Audit Result:
${JSON.stringify(parsedData, null, 2)}

Perform a rigorous second-pass validation focused on Google's E-E-A-T and Helpful Content signals.
1. Critically evaluate the recommendations — are they truly impactful and specific to this content?
2. Refine, replace, or upgrade recommendations to be extremely high-quality and actionable.
3. Re-evaluate eeatScore and isYMYL with stricter criteria.
4. Ensure summary, strengths, and weaknesses reflect a deep E-E-A-T analysis.
5. EVERY recommendation MUST quote the EXACT text in \`affectedContent\`.
6. E-E-A-T recommendations MUST reference the relevant SQEG guideline section.

GOOGLE SEARCH QUALITY EVALUATOR GUIDELINES:
${searchQualityGuidelines}

MANDATORY LANGUAGE REQUIREMENT: Generate the entire analysis in ${langLabel}.
${JSON_STRUCTURE}`;

      parsedData = await callLLM('analyze', model, advancedPrompt, temperature, criteria.thinkingLevel);
      if (onProgress) onProgress(`PROGRESS:pass2_done`);
    }
    if (onProgress) onProgress(`PROGRESS:finalize`);

    // Sort by priority: High → Medium → Low
    const priorityOrder: Record<string, number> = { High: 3, Medium: 2, Low: 1 };
    if (Array.isArray(parsedData.recommendations)) {
      parsedData.recommendations.sort(
        (a: Recommendation, b: Recommendation) =>
          (priorityOrder[b.priority] || 0) - (priorityOrder[a.priority] || 0)
      );
    }

    return {
      url,
      pageTitle,
      author,
      rawContent: content,
      modelUsed: model,
      language: criteria.language,
      pageType: criteria.pageType,
      timestamp: Date.now(),
      ...parsedData,
    };
  } catch (error: any) {
    console.error("Analysis error:", error);
    throw new Error(`Analysis failed: ${error.message}`, { cause: error });
  }
};

export const generateBulkSummary = async (
  results: AnalysisResult[],
  model: ModelType,
  language: 'en' | 'ua'
): Promise<BulkSummary> => {
  const langLabel = language === 'ua' ? 'Ukrainian' : 'English';

  const synthesisData = results.map(r => ({
    url: r.url,
    summary: r.summary,
    scores: { seo: r.seoScore, eeat: r.eeatScore, geo: r.llmOptimizationScore },
    weaknesses: r.weaknesses,
    topRecs: r.recommendations.slice(0, 3).map(rec => rec.action),
    entities: r.llmEntities,
  }));

  const prompt = `You are a visionary Head of Growth and SEO Strategy. Synthesize this cluster audit into a "Master Website Strategy".

AUDIT DATA:
${JSON.stringify(synthesisData, null, 2)}

MANDATORY LANGUAGE REQUIREMENT: Generate the entire report in ${langLabel}.

Return ONLY a valid JSON object (no markdown fences) with this structure:
{
  "overallScore": number — weighted average score,
  "domainAuthorityEstimate": string — qualitative trust level,
  "coreOpportunities": ["opportunity 1", ...] — 4-6 high-level tactical opportunities,
  "topCriticalFixes": ["fix 1", "fix 2", "fix 3"] — 3 systemic issues,
  "strategicAdvice": "2-3 sentence directive",
  "strategicPillars": [{ "title": string, "description": string }] — 3 detailed pillars,
  "technicalRoadmap": ["step 1", "step 2", "step 3", "step 4"] — 4 implementation steps,
  "contentGapAnalysis": "50-word deep-dive into semantic missing layers"
}`;

  try {
    return await callLLM('summarize', model, prompt, 0.2);
  } catch (error: any) {
    console.error("Bulk synthesis error:", error);
    throw error;
  }
};
