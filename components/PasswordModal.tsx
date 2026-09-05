import React, { useState } from 'react';
import { verifyPassword } from '../services/adminService';
import css from './PasswordModal.module.css';

interface PasswordModalProps {
  onAuthenticated: () => void;
  onClose: () => void;
}

const PasswordModal: React.FC<PasswordModalProps> = ({ onAuthenticated, onClose }) => {
  const [password, setPassword] = useState('');
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    await new Promise(r => setTimeout(r, 500));
    const isValid = await verifyPassword(password);
    if (isValid) {
      onAuthenticated();
    } else {
      setError('Invalid Access Key');
      setLoading(false);
    }
  };

  return (
    <div className={css.overlay}>
      <div className={css.modal}>

        <h3 className={css.title}>
          <svg className={css.titleIcon} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
          Admin Access
        </h3>

        <form onSubmit={handleSubmit} className={css.form}>
          <div>
            <label className={css.fieldLabel}>Security Key</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className={css.input}
              placeholder="Enter password..."
              autoFocus
            />
          </div>

          {error && <p className={css.errorText}>{error}</p>}

          <div className={css.actions}>
            <button type="button" onClick={onClose} className={css.cancelButton}>Cancel</button>
            <button type="submit" disabled={loading} className={css.submitButton}>
              {loading ? 'Verifying...' : 'Unlock'}
            </button>
          </div>
        </form>

      </div>
    </div>
  );
};

export default PasswordModal;
