import { ReactNode, useEffect, useRef } from 'react';

const TAB_STOPS = 'button:not([disabled]), a[href], input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

/**
 * A dialog over the page: Escape or a click outside closes it. The focus starts inside it, Tab and Shift+Tab stay inside it (the page behind is
 * not reachable), and the focus goes back to what opened it when it closes.
 */
export function Modal({ title, onClose, children, wide }: { title: string; onClose(): void; children: ReactNode; wide?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  // the latest onClose without re-running the effect (a new function on every render of the parent must not take the focus again)
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    box.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { close.current(); return; }
      if (e.key !== 'Tab' || !box.current) return;
      const stops = [...box.current.querySelectorAll<HTMLElement>(TAB_STOPS)].filter((el) => !el.hidden && !el.closest('[hidden], [aria-hidden=true]'));
      if (!stops.length) { e.preventDefault(); return; }
      const first = stops[0], last = stops[stops.length - 1];
      const at = document.activeElement;
      if (e.shiftKey && (at === first || at === box.current || !box.current.contains(at))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (at === last || !box.current.contains(at))) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); if (opener?.isConnected) opener.focus(); };
  }, []);
  return (
    <div className="persist-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`persist-modal panel${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={box}>
        {children}
      </div>
    </div>
  );
}
