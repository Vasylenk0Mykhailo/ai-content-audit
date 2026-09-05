import React from 'react';
import { AnalysisCriteria } from '../types';
import CustomSelect from './CustomSelect';
import css from './CriteriaSettings.module.css';

interface CriteriaSettingsProps {
  criteria: AnalysisCriteria;
  onCriteriaChange: (c: AnalysisCriteria) => void;
}

const AUDIT_POINTS = [
  'Target Audience', 'Contextual signals', 'Introduction', 'Conclusion',
  'Technical requirements', 'Trigger elements', 'Originality, authority, E-E-A-T signals',
  'Brand', 'Content Refresh', 'FAQ', 'CTA', 'Internal Links',
  'External Links', 'UX', 'Images', 'Approaches', 'Style', 'Content Distribution',
];

const LANGUAGE_OPTIONS  = [{ value: 'en', label: 'English' }, { value: 'ua', label: 'Ukrainian' }];
// Strictness maps to LLM `temperature` — number in parentheses is the actual
// value passed to the model (lower = more deterministic / strict).
const STRICTNESS_OPTIONS = [
  { value: 'low',    label: 'Low (0.5)' },
  { value: 'medium', label: 'Medium (0.3)' },
  { value: 'high',   label: 'High (0.1)' },
];
// Thinking level — `reasoning_effort` for GPT-5.x / o-series and mapped to
// extended-thinking token budget for Claude 4.x. Higher = deeper reasoning.
const THINKING_OPTIONS = [
  { value: 'minimal', label: 'Minimal (fastest)' },
  { value: 'low',     label: 'Low' },
  { value: 'medium',  label: 'Medium' },
  { value: 'high',    label: 'High (deepest)' },
];
const FOCUS_OPTIONS = [
  { value: 'General SEO',           label: 'General SEO' },
  { value: 'Medical/Health',        label: 'Medical (YMYL)' },
  { value: 'Finance',               label: 'Finance (YMYL)' },
  { value: 'E-commerce',            label: 'E-commerce' },
  { value: 'Blog/News',             label: 'Editorial' },
  { value: 'Technical Documentation', label: 'Technical Docs' },
];

const CriteriaSettings: React.FC<CriteriaSettingsProps> = ({ criteria, onCriteriaChange }) => {
  const update = (field: keyof AnalysisCriteria, value: any) =>
    onCriteriaChange({ ...criteria, [field]: value });

  const togglePoint = (point: string) => {
    const current = criteria.selectedAuditPoints || [];
    update('selectedAuditPoints', current.includes(point)
      ? current.filter(p => p !== point)
      : [...current, point]);
  };

  return (
    <div className={css.card}>
      <h3 className={css.cardTitle}>
        <span className={css.titleAccent} />
        Audit Config
      </h3>

      <div className={css.fieldsSection}>
        <div className={css.twoColGrid}>
          <CustomSelect label="Language"               value={criteria.language}      onChange={v => update('language', v as any)}      options={LANGUAGE_OPTIONS} />
          <CustomSelect label="Strictness (temperature)" value={criteria.strictness}  onChange={v => update('strictness', v as any)}    options={STRICTNESS_OPTIONS} />
        </div>

        <div className={css.twoColGrid}>
          <CustomSelect label="Industry Focus"           value={criteria.focusArea}     onChange={v => update('focusArea', v)}            options={FOCUS_OPTIONS} />
          <CustomSelect label="Thinking / Effort"        value={criteria.thinkingLevel} onChange={v => update('thinkingLevel', v as any)} options={THINKING_OPTIONS} />
        </div>

        <div>
          <div className={css.auditPointsHeader}>
            <label className={css.auditPointsLabel}>Core Audit Points</label>
            <div className={css.auditPointsActions}>
              <button type="button" onClick={() => update('selectedAuditPoints', AUDIT_POINTS)} className={css.selectAllButton}>Select All</button>
              <span className={css.divider}>|</span>
              <button type="button" onClick={() => update('selectedAuditPoints', [])} className={css.clearAllButton}>Clear All</button>
            </div>
          </div>
          <div className={css.auditPointsGrid}>
            {AUDIT_POINTS.map(point => (
              <label key={point} className={css.checkboxLabel}>
                <div className={css.checkboxWrapper}>
                  <input
                    type="checkbox"
                    className={css.checkboxInput}
                    checked={(criteria.selectedAuditPoints || []).includes(point)}
                    onChange={() => togglePoint(point)}
                  />
                  <svg className={css.checkboxTick} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <span className={css.checkboxText}>{point}</span>
              </label>
            ))}
          </div>
        </div>

        <div>
          <label className={css.instructionsLabel}>Custom Instructions</label>
          <textarea
            value={criteria.customInstructions}
            onChange={e => update('customInstructions', e.target.value)}
            placeholder="Focus instructions..."
            className={css.instructionsTextarea}
          />
        </div>
      </div>
    </div>
  );
};

export default CriteriaSettings;
