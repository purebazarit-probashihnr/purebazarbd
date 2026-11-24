'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useLanguage } from '@/i18n/language-provider';
import { isTopModal, registerModal, unregisterModal } from './modal-stack.cjs';

export default function Modal({
  open,
  onClose,
  title,
  children,
  className = '',
  backdropClassName = '',
  ariaLabel,
  bare = false,
}) {
  const { t } = useLanguage();
  const id = useId();
  const panelRef = useRef(null);
  const onCloseRef = useRef(onClose);
  const [ready, setReady] = useState(false);
  const [layer, setLayer] = useState(1000);

  useEffect(() => setReady(true), []);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    if (!open || !ready) return undefined;
    const opener = document.activeElement;
    setLayer(registerModal(id));
    panelRef.current?.focus();

    function handleKeyDown(event) {
      if (event.key === 'Escape' && isTopModal(id)) {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current?.();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      unregisterModal(id);
      if (opener?.isConnected) opener.focus();
    };
  }, [id, open, ready]);

  if (!open || !ready) return null;

  return createPortal(
    <div
      className={`modal-backdrop ${backdropClassName}`.trim()}
      style={{ zIndex: layer }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && isTopModal(id)) onCloseRef.current?.();
      }}
    >
      <section
        ref={panelRef}
        className={`${bare ? '' : 'modal-panel'} ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        aria-labelledby={!ariaLabel && !bare ? `modal-title-${id}` : undefined}
        tabIndex={-1}
      >
        {bare ? children : (
          <>
            <header className="modal-header">
              <h2 id={`modal-title-${id}`}>{typeof title === 'string' ? t(title) : title}</h2>
              <button className="icon-button" aria-label={t('Close dialog')} onClick={onClose}><X size={19} /></button>
            </header>
            <div className="modal-content">{children}</div>
          </>
        )}
      </section>
    </div>,
    document.body,
  );
}