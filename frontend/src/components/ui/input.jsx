'use client';

import { useLanguage } from '@/i18n/language-provider';

export default function Input({ label, error, id, className = '', placeholder, required, ...props }) {
  const { t } = useLanguage();
  const inputId = id ?? props.name;
  return (
    <label className={`ui-field ${className}`.trim()} htmlFor={inputId}>
      {label && <span className="field-label">{t(label)}{required && <span className="text-red-600" aria-hidden="true"> *</span>}</span>}
      <input id={inputId} className={`ui-input${error ? ' field-invalid' : ''}`} aria-invalid={Boolean(error)} placeholder={t(placeholder)} required={required} {...props} />
      {error && <span className="field-error">{t(error)}</span>}
    </label>
  );
}