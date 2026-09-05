import React, { useState } from 'react';
import { CustomProxy } from '../types';
import CustomSelect from './CustomSelect';
import css from './ProxyModal.module.css';

interface ProxyModalProps {
  onClose: () => void;
  onSave: (proxies: CustomProxy[]) => void;
  initialProxies: CustomProxy[];
}

const STORAGE_KEY = 'content_audit_user_proxies';

const PROTOCOL_OPTIONS = [
  { value: 'http',   label: 'HTTP' },
  { value: 'https',  label: 'HTTPS' },
  { value: 'socks5', label: 'SOCKS5' },
];

const ProxyModal: React.FC<ProxyModalProps> = ({ onClose, onSave, initialProxies }) => {
  const [proxies, setProxies] = useState<CustomProxy[]>(() => {
    if (initialProxies.length > 0) return initialProxies;
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) return JSON.parse(stored);
    } catch { /* ignore */ }
    return [];
  });

  const [ip,       setIp]       = useState('');
  const [port,     setPort]     = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [protocol, setProtocol] = useState<'http' | 'https' | 'socks5'>('http');

  const persistProxies = (updated: CustomProxy[]) => {
    setProxies(updated);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    onSave(updated);
  };

  const addProxy = () => {
    if (!ip || !port) return;
    persistProxies([...proxies, {
      id: Math.random().toString(36).substr(2, 9),
      ip, port, username, password, protocol, isActive: true,
    }]);
    setIp(''); setPort(''); setUsername(''); setPassword('');
  };

  const removeProxy = (id: string) => persistProxies(proxies.filter(p => p.id !== id));
  const toggleProxy = (id: string) => persistProxies(proxies.map(p => p.id === id ? { ...p, isActive: !p.isActive } : p));

  return (
    <div className={css.overlay}>
      <div className={css.modal}>

        <div className={css.header}>
          <div>
            <h2 className={css.headerTitle}>
              <svg className={css.headerTitleIcon} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
              Network & Proxy Configuration
            </h2>
            <p className={css.headerSubtitle}>Configure custom proxies to bypass restrictions. Data is stored locally.</p>
          </div>
          <button onClick={onClose} className={css.closeButton}>
            <svg className={css.closeIcon} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className={css.body}>

          <div className={css.formSection}>
            <h3 className={css.formTitle}>Add New Proxy</h3>
            <div className={css.formGrid}>
              <div className={css.colProtocol}>
                <CustomSelect label="Protocol" value={protocol} onChange={v => setProtocol(v as any)} options={PROTOCOL_OPTIONS} />
              </div>
              <div className={css.colIp}>
                <label className={css.fieldLabel}>IP Address / Host</label>
                <input type="text" value={ip} onChange={e => setIp(e.target.value)} placeholder="192.168.1.1" className={css.fieldInput} />
              </div>
              <div className={css.colPort}>
                <label className={css.fieldLabel}>Port</label>
                <input type="text" value={port} onChange={e => setPort(e.target.value)} placeholder="8080" className={css.fieldInput} />
              </div>
              <div className={css.colUser}>
                <label className={css.fieldLabel}>Username</label>
                <input type="text" value={username} onChange={e => setUsername(e.target.value)} placeholder="user" className={css.fieldInput} />
              </div>
              <div className={css.colPass}>
                <label className={css.fieldLabel}>Password</label>
                <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="pass" className={css.fieldInput} />
              </div>
            </div>
            <div className={css.formFooter}>
              <button onClick={addProxy} disabled={!ip || !port} className={css.addButton}>
                Add Proxy Config
              </button>
            </div>
          </div>

          <div className={css.listSection}>
            <h3 className={css.listTitle}>Saved Proxies</h3>
            {proxies.length === 0 ? (
              <div className={css.emptyState}>
                No proxies configured. The app will use default public relays.
              </div>
            ) : proxies.map(p => (
              <div key={p.id} className={css.proxyItem}>
                <div className={css.proxyLeft}>
                  <button
                    onClick={() => toggleProxy(p.id)}
                    title={p.isActive ? 'Active' : 'Inactive'}
                    className={`${css.statusDot} ${p.isActive ? css.statusDotActive : css.statusDotInactive}`}
                  />
                  <div className={css.proxyInfo}>
                    <div className={css.proxyMeta}>
                      <span className={css.proxyAddress}>{p.ip}:{p.port}</span>
                      <span className={css.proxyProtocol}>{p.protocol}</span>
                    </div>
                    {p.username && <span className={css.proxyAuth}>Auth: {p.username} / ******</span>}
                  </div>
                </div>
                <button onClick={() => removeProxy(p.id)} className={css.deleteButton}>
                  <svg className={css.deleteIcon} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
            ))}
          </div>

        </div>

        <div className={css.footer}>
          <button onClick={onClose} className={css.doneButton}>Done</button>
        </div>

      </div>
    </div>
  );
};

export default ProxyModal;
