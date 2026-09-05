import React, { useState } from 'react';
import { AnalysisResult, ReportFormat } from '../types';
import { ResponsiveContainer, RadarChart, PolarGrid, PolarAngleAxis, Radar, Tooltip, PolarRadiusAxis } from 'recharts';
import { generatePdfReport } from '../services/pdfService';
import { generateDocxReport } from '../services/docxService';
import ContentPreviewModal from './ContentPreviewModal';
import css from './ResultCard.module.css';

interface ResultCardProps {
  result: AnalysisResult;
  reportFormat?: ReportFormat;
}

const menuItemStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  textAlign: 'left',
  padding: '8px 12px',
  fontSize: 12,
  fontWeight: 600,
  color: '#0f172a',
  background: 'transparent',
  border: 0,
  cursor: 'pointer',
};

// ─── Score Badge ────────────────────────────────────────────────────────────
const ScoreBadge: React.FC<{ label: string; score: number | string }> = ({ label, score }) => {
  const num = Number(score) || 0;
  const colorClass = num > 80 ? css.scoreBadgeGreen : num > 50 ? css.scoreBadgeYellow : css.scoreBadgeRed;
  const valueClass = num > 80 ? css.scoreValueGreen  : num > 50 ? css.scoreValueYellow  : css.scoreValueRed;
  return (
    <div className={`${css.scoreBadge} ${colorClass}`}>
      <span className={`${css.scoreValue} ${valueClass}`}>{num}</span>
      <span className={css.scoreLabel}>{label}</span>
    </div>
  );
};

// ─── Main component ──────────────────────────────────────────────────────────
const ResultCard: React.FC<ResultCardProps> = ({ result, reportFormat = 'full' }) => {
  const [activeTab,      setActiveTab]      = useState<'overview' | 'recommendations' | 'details'>('overview');
  const [expandedRecs,   setExpandedRecs]   = useState<Set<number>>(new Set());
  const [showRoadmap,    setShowRoadmap]    = useState(false);
  const [showPreview,    setShowPreview]    = useState(false);
  const [roadmapContent, setRoadmapContent] = useState('');
  const [isExporting,    setIsExporting]    = useState(false);
  const [showFormatMenu, setShowFormatMenu] = useState(false);

  // ── Error state ──────────────────────────────────────────────────────────
  if (result.error) {
    return (
      <div className={css.errorCard}>
        <div className={css.errorBody}>
          <div className={css.errorIconWrapper}>
            <svg className={css.errorIcon} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h3 className={css.errorTitle}>Audit Node Error</h3>
          <p className={css.errorMessage}>{result.error}</p>
          <code className={css.errorUrl}>{result.url}</code>
        </div>
      </div>
    );
  }

  const sentiment = result.sentiment ?? { label: 'Neutral', score: 50, explanation: 'Sentiment data missing.' };

  const chartData = [
    { subject: 'SEO',       A: Number(result.seoScore) || 0, full: 100 },
    { subject: 'E-E-A-T',   A: Number(result.eeatScore) || 0, full: 100 },
    { subject: 'GEO',       A: Number(result.llmOptimizationScore) || 0, full: 100 },
    { subject: 'Sentiment', A: Number(sentiment.score) || 50, full: 100 },
    { subject: 'Richness',  A: Math.min(100, ((result.lsiKeywords?.length ?? 0) + (result.llmEntities?.length ?? 0)) * 5), full: 100 },
  ];

  const generateRoadmap = () => {
    const high = (result.recommendations || []).filter(r => r.priority === 'High');
    setRoadmapContent(`
**STRATEGIC OPTIMIZATION ROADMAP: ${result.pageTitle || 'Untitled Page'}**
Target URL: ${result.url} | Engine: ${result.modelUsed}

--- PHASE 1: FOUNDATION & TRUST ---
${high.length ? high.map(r => `[ ] **${r.action}**: ${r.description}`).join('\n') : 'No critical errors detected.'}

--- PHASE 2: SEMANTIC EXPANSION ---
[ ] Missing Keywords: ${(result.keywordGaps || []).join(', ')}
[ ] Entity Coverage:  ${(result.llmEntities  || []).join(', ')}

--- PHASE 3: GEO OPTIMIZATION ---
[ ] Add direct-answer blocks for AI snippets.
[ ] Align sentiment (current: ${sentiment.label}).

Generated via ContentAudit AI.
`.trim());
    setShowRoadmap(true);
  };

  // Pushes a log line into App's Live Execution Feed via the shared window
  // CustomEvent bus. Cheaper than prop-drilling addLog through every card.
  const log = (message: string, type: 'info' | 'success' | 'error' | 'warning' = 'info') => {
    window.dispatchEvent(new CustomEvent('audit:log', { detail: { message, type } }));
  };

  const exportPdf = async (format: ReportFormat = reportFormat) => {
    setIsExporting(true);
    log(`Generating PDF (${format}) for ${result.url}…`);
    try {
      await generatePdfReport(result, format);
      log(`PDF ready (${format}) for ${result.url}`, 'success');
    } catch (e: any) {
      console.error('PDF Export failed:', e);
      log(`PDF export failed for ${result.url}: ${e?.message || e}`, 'error');
      alert('Failed to export PDF.');
    } finally {
      setIsExporting(false);
    }
  };

  const exportDocx = async (format: ReportFormat = reportFormat) => {
    setIsExporting(true);
    log(`Generating Word document (${format}) for ${result.url}…`);
    try {
      await generateDocxReport(result, (result.language as 'en' | 'ua') || 'en', format);
      log(`Word document ready (${format}) for ${result.url}`, 'success');
    } catch (e: any) {
      console.error('DOCX Export failed:', e);
      log(`Word export failed for ${result.url}: ${e?.message || e}`, 'error');
      alert('Failed to export Word document.');
    } finally {
      setIsExporting(false);
    }
  };

  const toggleRec = (i: number) => {
    setExpandedRecs(prev => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  };

  const TABS = ['overview', 'recommendations', 'details'] as const;

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className={css.card}>

      {/* ── Header ── */}
      <div className={css.cardHeader}>
        <div className={css.cardHeaderRow}>
          <div className={css.cardHeaderLeft}>
            <div className={css.metaRow}>
              {result.isYMYL && <span className={css.ymylBadge}>YMYL</span>}
              <span className={css.modelBadge}>{result.modelUsed.replace('gemini-', '').toUpperCase()}</span>
              <span className={css.timeBadge}>{new Date(result.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
            <h2 className={css.pageTitle}>{result.pageTitle || result.url}</h2>
            <div className={css.linksRow}>
              <button onClick={() => setShowPreview(true)} className={css.rawDataButton}>
                <svg className={css.rawDataIcon} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" /></svg>
                View Raw Data
              </button>
              <a href={result.url} target="_blank" rel="noreferrer" className={css.liveLink}>
                View Live
                <svg className={css.liveLinkIcon} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
              </a>
              <span className={`${css.authorInfo} ${result.author ? css.authorFound : css.authorMissing}`}>
                <svg className={css.authorIcon} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                {result.author ? `Author: ${result.author}` : 'Author: Not found (May negatively impact E-E-A-T scoring)'}
              </span>
            </div>
          </div>

          <div className={css.cardHeaderRight}>
            <div style={{ position: 'relative' }}>
              <button
                disabled={isExporting}
                onClick={() => setShowFormatMenu(v => !v)}
                className={css.pdfButton}
                title={`Export PDF (current: ${reportFormat})`}
              >
                {isExporting
                  ? <div className={css.pdfSpinner} />
                  : <svg className={css.pdfIcon} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                }
              </button>
              {showFormatMenu && !isExporting && (
                <div style={{ position: 'absolute', right: 0, top: '100%', marginTop: 4, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.08)', zIndex: 50, minWidth: 200 }}>
                  <button onClick={() => { setShowFormatMenu(false); exportPdf('full'); }} style={menuItemStyle}>Full report (PDF)</button>
                  <button onClick={() => { setShowFormatMenu(false); exportPdf('brief'); }} style={menuItemStyle}>Brief (PDF)</button>
                  <div style={{ height: 1, background: '#e2e8f0', margin: '4px 0' }} />
                  <button onClick={() => { setShowFormatMenu(false); exportDocx('full'); }} style={menuItemStyle}>Full report (Word)</button>
                  <button onClick={() => { setShowFormatMenu(false); exportDocx('brief'); }} style={menuItemStyle}>Brief (Word)</button>
                </div>
              )}
            </div>
            <button onClick={generateRoadmap} className={css.roadmapButton}>
              <svg className={css.roadmapButtonIcon} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" /></svg>
              Roadmap
            </button>
          </div>
        </div>
      </div>

      {/* ── Tabs ── */}
      <div className={css.tabBar}>
        {TABS.map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)} className={`${css.tab} ${activeTab === tab ? css.tabActive : ''}`}>
            {tab}
            {activeTab === tab && <div className={css.tabIndicator} />}
          </button>
        ))}
      </div>

      {/* ── Tab content ── */}
      <div className={css.tabContent}>

        {activeTab === 'overview' && (
          <div className={css.overviewGrid}>
            <div className={css.overviewLeft}>
              <div className={css.scoresRow}>
                <ScoreBadge label="SEO"    score={result.seoScore} />
                <ScoreBadge label="E-E-A-T" score={result.eeatScore} />
                <ScoreBadge label="GEO"    score={result.llmOptimizationScore} />
              </div>
              <div className={css.summaryCard}>
                <h3 className={css.summaryLabel}>Summary</h3>
                <p className={css.summaryText}>"{result.summary}"</p>
              </div>
              <div className={css.swGrid}>
                <div className={css.strengthsCard}>
                  <h4 className={css.strengthsTitle}>
                    <svg className={css.swIcon} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                    Strengths
                  </h4>
                  <ul className={css.swList}>
                    {(result.strengths || []).slice(0, 3).map((s, i) => (
                      <li key={i} className={css.swItem}><span className={css.dotGreen}>•</span> {s}</li>
                    ))}
                  </ul>
                </div>
                <div className={css.weaknessesCard}>
                  <h4 className={css.weaknessesTitle}>
                    <svg className={css.swIcon} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01" /></svg>
                    Weaknesses
                  </h4>
                  <ul className={css.swList}>
                    {(result.weaknesses || []).slice(0, 3).map((w, i) => (
                      <li key={i} className={css.swItem}><span className={css.dotRed}>•</span> {w}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>

            <div className={css.radarCard}>
              <h3 className={css.radarLabel}>Semantic Footprint</h3>
              <div className={css.radarWrapper}>
                <ResponsiveContainer width="100%" height="100%">
                  <RadarChart cx="50%" cy="50%" outerRadius="55%" data={chartData}>
                    <PolarGrid stroke="#f1f5f9" />
                    <PolarAngleAxis dataKey="subject" tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 600 }} />
                    <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} axisLine={false} />
                    <Radar name="Audit" dataKey="A" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.15} isAnimationActive />
                    <Tooltip contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)', fontSize: '10px' }} />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'recommendations' && (
          <div className={css.recList}>
            {(result.recommendations || []).map((rec, idx) => {
              const expanded = expandedRecs.has(idx);
              const priorityClass = rec.priority === 'High' ? css.priorityHigh : rec.priority === 'Medium' ? css.priorityMedium : css.priorityLow;
              return (
                <div key={`rec-${idx}`} className={`${css.recCard} ${expanded ? css.recCardExpanded : css.recCardCollapsed}`}>
                  <button onClick={() => toggleRec(idx)} className={css.recTrigger}>
                    <div className={css.recTriggerLeft}>
                      <span className={`${css.recPriorityBadge} ${priorityClass}`}>{rec.priority}</span>
                      <h4 className={expanded ? css.recTitleExpanded : css.recTitle}>{rec.action}</h4>
                    </div>
                    <svg className={`${css.recChevron} ${expanded ? css.recChevronExpanded : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>

                  {expanded && (
                    <div className={css.recBody}>
                      <p className={css.recDescription}>{rec.description}</p>
                      <div className={css.recGrid}>
                        <div className={css.recSourceBox}>
                          <h5 className={css.recSourceLabel}>Source</h5>
                          <p className={css.recSourceText}>"{rec.affectedContent}"</p>
                        </div>
                        <div className={css.recImpactBox}>
                          <h5 className={css.recImpactLabel}>Impact</h5>
                          <p className={css.recImpactText}>{rec.expectedImpact}</p>
                        </div>
                      </div>
                      <div className={css.recStepsSection}>
                        <h5 className={css.recStepsLabel}>Implementation Steps</h5>
                        <ul className={css.recStepsList}>
                          {rec.fixSteps.map((step, si) => (
                            <li key={si} className={css.recStep}>
                              <span className={css.recStepNumber}>{si + 1}</span>
                              <span className="pt-0.5">{step}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {activeTab === 'details' && (
          <div className={css.detailsSection}>
            <div className={css.sentimentCard}>
              <h4 className={css.sentimentTitle}>
                <span className={css.sentimentDot} />
                Sentiment Analysis
              </h4>
              <div className={css.sentimentRow}>
                <div className={css.sentimentScore}>
                  <div className={css.sentimentValue}>{sentiment.score}</div>
                  <span className={css.sentimentBadge}>{sentiment.label}</span>
                </div>
                <p className={css.sentimentExplanation}>"{sentiment.explanation}"</p>
              </div>
            </div>

            <div className={css.tagsGrid}>
              <div className={css.tagsCard}>
                <h4 className={css.tagsLabelSlate}>Keyword Gaps</h4>
                <div className={css.tagsList}>
                  {(result.keywordGaps || []).map((k, i) => <span key={i} className={css.tagSlate}>{k}</span>)}
                </div>
              </div>
              <div className={css.tagsCard}>
                <h4 className={css.tagsLabelBlue}>LSI Entities</h4>
                <div className={css.tagsList}>
                  {(result.lsiKeywords || []).map((k, i) => <span key={i} className={css.tagBlue}>{k}</span>)}
                </div>
              </div>
              <div className={css.tagsCard}>
                <h4 className={css.tagsLabelPurple}>GEO Anchors</h4>
                <div className={css.tagsList}>
                  {(result.llmEntities || []).map((k, i) => <span key={i} className={css.tagPurple}>{k}</span>)}
                </div>
              </div>
            </div>
          </div>
        )}

      </div>

      {/* ── Roadmap modal ── */}
      {showRoadmap && (
        <div className={css.roadmapModal}>
          <div className={css.roadmapModalInner}>
            <div className={css.roadmapModalHeader}>
              <h3 className={css.roadmapModalTitle}>Implementation Plan</h3>
              <button onClick={() => setShowRoadmap(false)} className={css.roadmapModalCloseButton}>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className={css.roadmapModalBody}>
              <textarea readOnly value={roadmapContent} className={css.roadmapTextarea} />
            </div>
            <div className={css.roadmapModalFooter}>
              <button onClick={() => { navigator.clipboard.writeText(roadmapContent); alert('Copied!'); }} className={css.copyButton}>
                Copy Plan
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Content preview modal ── */}
      {showPreview && (
        <ContentPreviewModal
          data={{ url: result.url, title: result.pageTitle || result.url, content: result.rawContent || 'No raw content available.', author: result.author }}
          onClose={() => setShowPreview(false)}
        />
      )}

    </div>
  );
};

export default ResultCard;
