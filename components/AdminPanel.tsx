import React, { useRef, useState } from 'react';
import { AdminSettings, InstructionFile } from '../types';
import { exportSettingsToFile } from '../services/adminService';
import css from './AdminPanel.module.css';

interface AdminPanelProps {
  settings: AdminSettings;
  onSave: (settings: AdminSettings) => void;
  onClose: () => void;
}

const TEMPLATE_VARS = ['{{url}}', '{{content}}', '{{focusArea}}', '{{strictness}}', '{{customInstructions}}'];

const AdminPanel: React.FC<AdminPanelProps> = ({ settings, onSave, onClose }) => {
  const [localSettings, setLocalSettings] = useState<AdminSettings>(settings);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const configInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files) return;
    Array.from(files).forEach((file: File) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const newFile: InstructionFile = {
          id: Math.random().toString(36).substr(2, 9),
          name: file.name,
          content: e.target?.result as string,
          size: file.size,
        };
        setLocalSettings(prev => ({ ...prev, instructionFiles: [...prev.instructionFiles, newFile] }));
      };
      reader.readAsText(file);
    });
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleConfigImport = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const parsed = JSON.parse(e.target?.result as string) as AdminSettings;
        if (!parsed.promptTemplate) throw new Error('Invalid format');
        setLocalSettings(parsed);
        alert('Configuration imported successfully!');
      } catch {
        alert('Failed to import configuration. Invalid file format.');
      }
    };
    reader.readAsText(file);
    if (configInputRef.current) configInputRef.current.value = '';
  };

  const removeFile = (id: string) => {
    setLocalSettings(prev => ({
      ...prev,
      instructionFiles: prev.instructionFiles.filter(f => f.id !== id),
    }));
  };

  return (
    <div className={css.overlay}>
      <div className={css.modal}>

        <div className={css.header}>
          <div>
            <h2 className={css.headerTitle}>
              <svg className={css.headerTitleIcon} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              Admin & Logic Configuration
            </h2>
            <p className={css.headerSubtitle}>Customize analysis prompts and knowledge base.</p>
          </div>
          <div className={css.headerActions}>
            <input type="file" ref={configInputRef} accept=".json" className="hidden" onChange={handleConfigImport} />
            <button onClick={() => configInputRef.current?.click()} className={css.headerButton}>Import Config</button>
            <button onClick={() => exportSettingsToFile(localSettings)} className={css.headerButton}>Export Config</button>
            <button onClick={onClose} className={css.closeButton}>
              <svg className={css.closeIcon} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className={css.body}>

          <div>
            <h3 className={css.sectionTitle}>Analysis Prompt Template</h3>
            <div className={css.variablesBox}>
              <p className={css.variablesLabel}>Available Variables:</p>
              <div className={css.variablesList}>
                {TEMPLATE_VARS.map(v => <code key={v} className={css.variableChip}>{v}</code>)}
              </div>
            </div>
            <textarea
              value={localSettings.promptTemplate}
              onChange={e => setLocalSettings(prev => ({ ...prev, promptTemplate: e.target.value }))}
              className={css.promptTextarea}
              spellCheck={false}
            />
          </div>

          <div>
            <div className={css.kbHeader}>
              <div>
                <h3 className={css.kbTitle}>Instruction Files / Knowledge Base</h3>
                <p className={css.kbSubtitle}>Upload guidelines, best practices, or specific criteria files (.txt, .md).</p>
              </div>
              <div>
                <input type="file" ref={fileInputRef} accept=".txt,.md,.json" multiple className="hidden" onChange={handleFileUpload} />
                <button onClick={() => fileInputRef.current?.click()} className={css.uploadButton}>
                  <svg className={css.uploadIcon} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                  Upload Files
                </button>
              </div>
            </div>

            <div className={css.fileGrid}>
              {localSettings.instructionFiles.length === 0 && (
                <div className={css.emptyState}>
                  No instruction files uploaded. The analysis will rely solely on the prompt template.
                </div>
              )}
              {localSettings.instructionFiles.map(file => (
                <div key={file.id} className={css.fileCard}>
                  <div className={css.fileCardLeft}>
                    <svg className={css.fileIcon} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <div>
                      <p className={css.fileName} title={file.name}>{file.name}</p>
                      <p className={css.fileSize}>{(file.size / 1024).toFixed(1)} KB</p>
                    </div>
                  </div>
                  <button onClick={() => removeFile(file.id)} className={css.deleteButton}>
                    <svg className={css.deleteIcon} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          </div>

        </div>

        <div className={css.footer}>
          <button onClick={onClose} className={css.cancelButton}>Cancel</button>
          <button onClick={() => { onSave(localSettings); onClose(); }} className={css.saveButton}>
            Save Configuration
          </button>
        </div>

      </div>
    </div>
  );
};

export default AdminPanel;
