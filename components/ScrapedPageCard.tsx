import React, { useState } from 'react';
import { ScrapingResult } from '../types';
import ContentPreviewModal from './ContentPreviewModal';
import css from './ScrapedPageCard.module.css';

interface ScrapedPageCardProps {
  page: ScrapingResult;
}

const ScrapedPageCard: React.FC<ScrapedPageCardProps> = ({ page }) => {
  const [showPreview, setShowPreview] = useState(false);

  if (!page.success) {
    return (
      <div className={css.errorCard}>
        <div className={css.errorHeader}>
          <div className={css.errorIconWrapper}>
            <svg className={css.errorIcon} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h3 className={css.errorTitle}>Scraping Failed</h3>
        </div>
        <p className={css.errorMessage}>{page.error}</p>
        <code className={css.errorUrl}>{page.url}</code>
      </div>
    );
  }

  const isContentShort = !page.content || page.content.length < 500;

  return (
    <div className={css.card}>
      <div className={css.cardBody}>

        <div className={css.cardLeft}>
          <h3 className={css.cardTitle}>{page.title || page.url}</h3>
          <div className={css.cardMeta}>
            <code className={css.cardUrl}>{page.url}</code>
            <span className={`${css.authorInfo} ${page.author ? css.authorFound : css.authorMissing}`}>
              <svg className={css.authorIcon} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
              {page.author ? `Author: ${page.author}` : 'Author: Not found (May negatively impact E-E-A-T scoring)'}
            </span>
          </div>
          {isContentShort && (
            <div className={css.warningText}>
              <svg className={css.warningIcon} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              Warning: Incomplete parse detected. Content is unusually short.
            </div>
          )}
        </div>

        <div className={css.cardRight}>
          <button onClick={() => setShowPreview(true)} className={css.previewButton}>
            <svg className={css.previewIcon} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
            View Raw Data
          </button>
        </div>

      </div>

      {showPreview && (
        <ContentPreviewModal
          data={{ url: page.url, title: page.title, content: page.content, author: page.author }}
          onClose={() => setShowPreview(false)}
        />
      )}
    </div>
  );
};

export default ScrapedPageCard;
