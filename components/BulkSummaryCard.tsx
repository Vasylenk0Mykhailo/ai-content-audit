import React, { useState } from 'react';
import { BulkSummary } from '../types';
import { generateBulkPdfReport } from '../services/pdfService';
import { generateBulkDocxReport } from '../services/docxService';
import css from './BulkSummaryCard.module.css';

interface BulkSummaryCardProps {
  summary: BulkSummary;
  urls: string[];
  language?: 'en' | 'ua';
  /** Model identifier used to generate the synthesis (e.g. "gpt-5-mini"). */
  modelUsed?: string;
}

/** Same formatter as in ResultCard: strip the `gemini-` prefix, uppercase. */
const formatModelLabel = (m?: string): string => {
  if (!m) return '';
  return m.replace(/^gemini-/i, '').toUpperCase();
};

const LABELS = {
  en: {
    strategicActive:   'Strategic Synthesis Active',
    exportPdf:         'Export Master PDF',
    generating:        'Generating...',
    mainTitle:         'Website Strategy',
    aggregatedPerf:    'Aggregated Performance',
    analysedUrls:      'Analysed URLs',
    coreGrowth:        'Core Growth Pillars',
    pillarLabel:       'Pillar',
    techGrowthRoadmap: 'Technical Growth Roadmap',
    contentGap:        'Content Gap Analysis',
    systemicVuln:      'Systemic Vulnerabilities',
    topOpts:           'Top Optimization Opportunities',
    // Technical SEO terms — kept in English in both modes.
    keywordGaps:       'Keyword Gaps',
    lsiEntities:       'LSI Entities',
    geoAnchors:        'GEO Anchors',
  },
  ua: {
    strategicActive:   'Стратегічний синтез активний',
    exportPdf:         'Експорт майстер-PDF',
    generating:        'Генерація…',
    mainTitle:         'Стратегія сайту',
    aggregatedPerf:    'Загальна ефективність',
    analysedUrls:      'Проаналізовані URL',
    coreGrowth:        'Опорні точки росту',
    pillarLabel:       'Напрямок',
    techGrowthRoadmap: 'Технічна дорожня карта',
    contentGap:        'Семантичний розрив',
    systemicVuln:      'Системні проблеми',
    topOpts:           'Топові можливості оптимізації',
    keywordGaps:       'Keyword Gaps',
    lsiEntities:       'LSI Entities',
    geoAnchors:        'GEO Anchors',
  },
} as const;

const BulkSummaryCard: React.FC<BulkSummaryCardProps> = ({ summary, urls, language = 'en', modelUsed }) => {
  const [isExporting, setIsExporting] = useState(false);
  const L = LABELS[language];
  const modelLabel = formatModelLabel(modelUsed);

  const log = (message: string, type: 'info' | 'success' | 'error' | 'warning' = 'info') => {
    window.dispatchEvent(new CustomEvent('audit:log', { detail: { message, type } }));
  };

  const handleExport = async (kind: 'pdf' | 'docx' = 'pdf') => {
    setIsExporting(true);
    const fmtName = kind === 'docx' ? 'Word document' : 'PDF';
    log(`Generating bulk strategy ${fmtName} (${urls.length} URLs)…`);
    try {
      if (kind === 'docx') await generateBulkDocxReport(summary, urls, language);
      else await generateBulkPdfReport(summary, urls, language);
      log(`Bulk strategy ${fmtName} ready`, 'success');
    } catch (e: any) {
      console.error('Export failed:', e);
      log(`Bulk ${fmtName} export failed: ${e?.message || e}`, 'error');
      alert('Failed to export.');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className={css.card}>
      <div className={css.body}>

        <div className={css.topRow}>
          <div className={css.topLeft}>
            <div className={css.badgeRow}>
              {modelLabel && <span className={css.modelBadge}>{modelLabel}</span>}
              <button disabled={isExporting} onClick={() => handleExport('pdf')} className={css.exportButton}>
                {isExporting
                  ? <div className={css.exportSpinner} />
                  : <svg className={css.exportIcon} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                }
                {isExporting ? L.generating : 'PDF'}
              </button>
              <button disabled={isExporting} onClick={() => handleExport('docx')} className={css.exportButton}>
                {!isExporting && <svg className={css.exportIcon} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>}
                Word
              </button>
            </div>
            <h2 className={css.mainTitle}>{L.mainTitle}</h2>
            <p className={css.strategicAdvice}>"{summary.strategicAdvice}"</p>
          </div>

          <div className={css.scoreCard}>
            <span className={css.scoreValue}>{summary.overallScore}</span>
            <span className={css.scoreLabel}>{L.aggregatedPerf}</span>
            <div className={css.scoreBadge}>{summary.domainAuthorityEstimate}</div>
          </div>
        </div>

        {urls.length > 0 && (
          <div className={css.urlsCard}>
            <h3 className={css.urlsTitle}>{L.analysedUrls}</h3>
            <ul className={css.urlsList}>
              {urls.map((u, i) => (
                <li key={i}>
                  <a href={u} target="_blank" rel="noopener noreferrer" className={css.urlsLink}>{u}</a>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className={css.pillarsGrid}>
          {summary.strategicPillars.map((pillar, idx) => {
            // Strip "Стовп N: " / "Pillar N – " prefix the LLM sometimes prepends.
            const title = (pillar.title || '').replace(/^\s*(стовп|стовпець|pillar)\s*\d+\s*[:\-–—.]?\s*/i, '').trim();
            return (
              <div key={idx} className={css.pillarCard}>
                <h4 className={css.pillarTitle}>{title}</h4>
                <p className={css.pillarDescription}>{pillar.description}</p>
              </div>
            );
          })}
        </div>

        <div className={css.bottomGrid}>
          <div className={css.leftCol}>
            <div className={css.roadmapCard}>
              <h3 className={css.roadmapTitle}>
                <svg className={css.roadmapIcon} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                {L.techGrowthRoadmap}
              </h3>
              <div className={css.roadmapList}>
                {summary.technicalRoadmap
                  .filter(s => s && s.trim().length >= 12 && !/^(розділ|section|см\.|see|page|p\.)\s*[\dіivx]+\.?$/i.test(s.trim()))
                  .map((step, i) => (
                    <div key={i} className={css.roadmapStep}>
                      <div className={css.roadmapStepNumber}>{i + 1}</div>
                      <span className={css.roadmapStepText}>{step}</span>
                    </div>
                  ))}
              </div>
            </div>

            <div className={css.gapCard}>
              <h3 className={css.gapTitle}>{L.contentGap}</h3>
              <p className={css.gapText}>{summary.contentGapAnalysis}</p>
            </div>
          </div>

          <div className={css.rightCol}>
            <div className={css.vulnerabilitiesCard}>
              <h3 className={css.vulnerabilitiesTitle}>
                <svg className={css.vulnerabilitiesIcon} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                {L.systemicVuln}
              </h3>
              <ul className={css.vulnerabilitiesList}>
                {summary.topCriticalFixes
                  .filter(f => f && f.trim().length >= 12 && !/^(розділ|section|см\.|see|page|p\.)\s*[\dіivx]+\.?$/i.test(f.trim()))
                  .map((fix, i) => (
                    <li key={i} className={css.vulnerabilityItem}>
                      <span className={css.vulnerabilityBadge}>!</span>
                      {fix}
                    </li>
                  ))}
              </ul>
            </div>

            <div className={css.opportunitiesCard}>
              <h3 className={css.opportunitiesTitle}>
                <svg className={css.opportunitiesIcon} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                {L.topOpts}
              </h3>
              <div className={css.opportunitiesList}>
                {summary.coreOpportunities.map((opp, i) => (
                  <span key={i} className={css.opportunityChip}>{opp}</span>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Aggregated insights across all URLs (unified chip style) */}
        {((summary.aggregatedKeywordGaps?.length || 0) +
          (summary.aggregatedLsiKeywords?.length || 0) +
          (summary.aggregatedLlmEntities?.length || 0) > 0) && (
          <div className={css.aggregatedGrid}>
            {summary.aggregatedKeywordGaps?.length ? (
              <div className={css.aggregatedCard}>
                <h3 className={css.aggregatedTitleBlue}>{L.keywordGaps}</h3>
                <div className={css.chipRow}>
                  {summary.aggregatedKeywordGaps.slice(0, 30).map((kw, i) => (
                    <span key={i} className={css.chipBlue}>{kw}</span>
                  ))}
                </div>
              </div>
            ) : null}
            {summary.aggregatedLsiKeywords?.length ? (
              <div className={css.aggregatedCard}>
                <h3 className={css.aggregatedTitleBlue}>{L.lsiEntities}</h3>
                <div className={css.chipRow}>
                  {summary.aggregatedLsiKeywords.slice(0, 30).map((kw, i) => (
                    <span key={i} className={css.chipBlue}>{kw}</span>
                  ))}
                </div>
              </div>
            ) : null}
            {summary.aggregatedLlmEntities?.length ? (
              <div className={css.aggregatedCard}>
                <h3 className={css.aggregatedTitleBlue}>{L.geoAnchors}</h3>
                <div className={css.chipRow}>
                  {summary.aggregatedLlmEntities.slice(0, 30).map((kw, i) => (
                    <span key={i} className={css.chipBlue}>{kw}</span>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        )}

      </div>
    </div>
  );
};

export default BulkSummaryCard;
