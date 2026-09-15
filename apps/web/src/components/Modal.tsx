import { useEffect, useId, useRef } from 'react';

/**
 * The overlay shell: backdrop, Escape, focus containment, focus restore.
 *
 * Escape is listened for on the document rather than the dialog, because a
 * click on the backdrop leaves focus on the body and a handler bound to the
 * dialog would then never fire. Keeping the shell in one place is also what
 * stops the second and third overlay in the product from each re-deciding how
 * closing works.
 */
export function Modal({
  title,
  titleAside,
  onClose,
  children,
}: {
  title: string;
  /** Sits beside the title; the endpoint line, where there is one. */
  titleAside?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  // `onClose` is read through a ref so a caller passing a fresh closure every
  // render does not tear the listener down and rebuild it on every keystroke.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const returnTo = document.activeElement as HTMLElement | null;
    focusables(dialogRef.current)[0]?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeRef.current();
        return;
      }

      if (event.key !== 'Tab') return;

      // Tab cycles inside the dialog: without this, the next Tab off the last
      // field lands on the page behind, which the reader cannot see.
      const stops = focusables(dialogRef.current);
      const first = stops[0];
      const last = stops.at(-1);
      if (!first || !last) return;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      returnTo?.focus();
    };
  }, []);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Escape covers the keyboard
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 px-2 py-3 sm:px-4 sm:py-6"
      onMouseDown={(event) => {
        // Only a press that both starts and ends on the backdrop closes it, so
        // a drag that overshoots while selecting text inside does not.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="w-[min(44rem,100%)] rounded-md border border-line-control bg-surface-0 shadow-[var(--shadow-overlay)]"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex flex-wrap items-baseline gap-3 border-b border-line px-4 py-3 sm:px-5 sm:py-4">
          <h2 id={titleId} className="text-md">
            {title}
          </h2>
          {titleAside}
          <button
            type="button"
            className="ml-auto flex size-7 cursor-pointer items-center justify-center rounded-sm border border-transparent text-md/none text-text-muted hover:border-line-control hover:bg-surface-2 hover:text-text pointer-coarse:size-11"
            aria-label="Close"
            onClick={onClose}
          >
            <span aria-hidden="true">&times;</span>
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    // A field inside a disabled fieldset is reachable by the selector but not
    // by Tab, so trapping against it would strand focus.
    (element) => element.closest('fieldset[disabled]') === null,
  );
}
