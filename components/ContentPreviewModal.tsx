import React from 'react';
import css from './ContentPreviewModal.module.css';

interface ContentPreviewModalProps {
  data: {
    url: string;
    title: string;
    content: string;
    author?: string;
  };
  onClose: () => void;
}

const ContentPreviewModal: React.FC<ContentPreviewModalProps> = ({ data, onClose }) => {
  const isContentShort = !data.content || data.content.length < 500;

  return (
    <div className={css.overlay}>
      <div className={css.modal}>

        <div className={css.header}>
          <div>
            <h2 className={css.headerTitle}>Raw Scraped Data</h2>
            <p className={css.headerUrl}>{data.url}</p>
          </div>
          <button onClick={onClose} className={css.closeButton}>
            <svg className={css.closeIcon} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className={css.body}>
          <div className={css.metaSection}>
            <h3 className={css.pageTitle}>{data.title || 'No Title Found'}</h3>
            <div className={`${css.authorBadge} ${data.author ? css.authorBadgeFound : css.authorBadgeMissing}`}>
              <svg className={css.authorIcon} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
              {data.author ? `Author: ${data.author}` : 'Author: Not found (May negatively impact E-E-A-T scoring)'}
            </div>
          </div>

          {isContentShort && (
            <div className={css.warningBox}>
              <svg className={css.warningIcon} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <div>
                <h4 className={css.warningTitle}>Warning: Incomplete Parse Detected</h4>
                <p className={css.warningText}>
                  The extracted content is unusually short or missing. The page might be protected by anti-bot measures,
                  require JavaScript to render, or be behind a paywall. The analysis results may be inaccurate.
                </p>
              </div>
            </div>
          )}

          <div className={css.contentBox}>{data.content || 'No content extracted.'}</div>
        </div>

        <div className={css.footer}>
          <button onClick={onClose} className={css.closeButton2}>Close</button>
        </div>

      </div>
    </div>
  );
};

export default ContentPreviewModal;
