'use client';

import { useLanguage } from '@/i18n/language-provider';

export default function Select({ label, error, id, options = [], className = '', children, required, ...props }) {
  const { t } = useLanguage();
  const selectId = id ?? props.name;
  return (
    <label className={`ui-field ${className}`.trim()} htmlFor={selectId}>
      {label && <span className="field-label">{t(label)}{required && <span className="text-red-600" aria-hidden="true"> *</span>}</span>}
      <select id={selectId} className={`ui-select${error ? ' field-invalid' : ''}`} aria-invalid={Boolean(error)} required={required} {...props}>
        {children ?? options.map((option) => (
          <option key={option.value} value={option.value}>{t(option.label)}</option>
        ))}
      </select>
      {error && <span className="field-error">{t(error)}</span>}
    </label>
  );
}