import React, { useState, useRef, useEffect } from 'react';
import css from './CustomSelect.module.css';

interface Option {
  value: string;
  label: string;
  disabled?: boolean;
}

interface CustomSelectProps {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  options: Option[];
  placeholder?: string;
  icon?: React.ReactNode;
}

const CustomSelect: React.FC<CustomSelectProps> = ({ label, value, onChange, options, placeholder, icon }) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selected = options.find(o => o.value === value);

  return (
    <div className={css.wrapper} ref={containerRef}>
      {label && <label className={css.label}>{label}</label>}

      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`${css.trigger} ${isOpen ? css.triggerOpen : ''}`}
      >
        <div className={css.triggerInner}>
          {icon && <span className={css.triggerIcon}>{icon}</span>}
          <span className={selected ? css.triggerValue : css.triggerPlaceholder}>
            {selected ? selected.label : placeholder || 'Select...'}
          </span>
        </div>
        <svg className={`${css.chevron} ${isOpen ? css.chevronOpen : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div className={css.dropdown}>
          <div className={css.dropdownInner}>
            {options.map(opt => (
              <button
                key={opt.value}
                type="button"
                disabled={opt.disabled}
                onClick={() => { if (opt.disabled) return; onChange(opt.value); setIsOpen(false); }}
                className={`${css.option} ${opt.value === value ? css.optionSelected : css.optionDefault}`}
                style={opt.disabled ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
                title={opt.disabled ? 'Provider not configured on this deployment' : undefined}
              >
                {opt.label}
                {opt.value === value && !opt.disabled && (
                  <svg className={css.optionCheckIcon} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default CustomSelect;
