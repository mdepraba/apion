import type { HttpMethod } from '@apion/contracts';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { projectsQuery, searchQuery } from '../api/queries.js';
import { EndpointLine } from './EndpointLine.js';

/**
 * FR-1.2 (project switcher) and FR-1.6 (cross-project search) in one surface,
 * because they answer the same question: "take me to the thing I am thinking
 * about". Search results only ever contain projects the caller may read; the
 * server scopes that, not this component.
 */
export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const projects = useQuery({ ...projectsQuery(), enabled: open });
  const search = useQuery({ ...searchQuery(query), enabled: open });

  const trimmed = query.trim().toLowerCase();

  const projectRows = (projects.data ?? [])
    .filter(
      (project) =>
        project.lifecycleState === 'active' &&
        (trimmed.length === 0 ||
          project.name.toLowerCase().includes(trimmed) ||
          project.slug.includes(trimmed)),
    )
    .slice(0, 6)
    .map((project) => ({
      key: `project:${project.id}`,
      kind: 'project' as const,
      label: project.name,
      detail: project.slug,
      go: () =>
        navigate({ to: '/projects/$slug', params: { slug: project.slug } }),
    }));

  const searchRows = (search.data ?? []).slice(0, 12).map((hit) => ({
    key: `${hit.kind}:${hit.id}`,
    kind: hit.kind,
    label: hit.label,
    detail: `${hit.projectName} · ${hit.versionLabel}`,
    go: () =>
      navigate({
        to: '/projects/$slug/versions/$versionId',
        params: { slug: hit.projectSlug, versionId: hit.versionId },
        search: hit.kind === 'endpoint' ? { endpoint: hit.id } : {},
      }),
  }));

  const rows = [...projectRows, ...searchRows];

  // The highlighted row must not survive a change in what is under it. `query`
  // is watched, not read.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on change
  useEffect(() => setActiveIndex(0), [query]);

  // Focus moves in on open and returns to whatever opened it on close, so a
  // keyboard user is never dropped at the top of the document (R-32).
  useEffect(() => {
    if (!open) {
      setQuery('');
      return;
    }

    const opener = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();

    return () => opener?.focus();
  }, [open]);

  // Ctrl/Cmd+K from anywhere. Registered once on the document so the shortcut
  // works while focus is inside an editor field.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        onOpenChange(true);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onOpenChange]);

  if (!open) return null;

  const commit = (index: number) => {
    const row = rows[index];
    if (!row) return;
    onOpenChange(false);
    void row.go();
  };

  return (
    // Click-outside is a mouse convenience, not the only way out: Escape
    // closes the dialog for keyboard users, so the backdrop needs no handler.
    // biome-ignore lint/a11y/noStaticElementInteractions: Escape is the a11y path
    <div
      className="fixed inset-0 z-50 flex justify-center bg-black/40 p-3 sm:px-4 sm:pt-[10vh] sm:pb-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onOpenChange(false);
      }}
    >
      <div
        ref={dialogRef}
        className="flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-md border border-line-control bg-surface-1 shadow-[var(--shadow-overlay)] focus-within:outline-2 focus-within:-outline-offset-2 focus-within:outline-accent sm:max-h-[70vh]"
        role="dialog"
        aria-modal="true"
        aria-label="Search and switch project"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            onOpenChange(false);
            return;
          }
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setActiveIndex((index) => Math.min(index + 1, rows.length - 1));
            return;
          }
          if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActiveIndex((index) => Math.max(index - 1, 0));
            return;
          }
          if (event.key === 'Enter') {
            event.preventDefault();
            commit(activeIndex);
            return;
          }
          // The input is the dialog's only focusable control, so Tab would
          // otherwise walk into the page behind it while the modal is open.
          if (event.key === 'Tab') event.preventDefault();
        }}
      >
        <input
          ref={inputRef}
          className="border-0 border-b border-line bg-transparent px-4 py-3 text-[max(var(--text-md),16px)] text-text focus:outline-none"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search endpoints, schemas and projects"
          aria-label="Search endpoints, schemas and projects"
          // The list is the control being driven; the input reports that.
          role="combobox"
          aria-expanded={rows.length > 0}
          aria-controls="palette-results"
          aria-activedescendant={
            rows[activeIndex] ? `palette-${activeIndex}` : undefined
          }
          autoComplete="off"
        />

        {/*
          The combobox pattern (WAI-ARIA 1.2) puts role="listbox" on the
          container and role="option" on its children, with focus staying in
          the input and aria-activedescendant pointing at the active row. Biome
          reads these as interactive roles on non-interactive elements; the
          pattern is correct, and moving focus onto the options would break it.
        */}
        {/* biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: see above */}
        <ul className="overflow-y-auto p-1" id="palette-results" role="listbox">
          {rows.map((row, index) => (
            // biome-ignore-start lint/a11y/noNoninteractiveElementToInteractiveRole: combobox option
            // biome-ignore-start lint/a11y/useFocusableInteractive: focus stays on the input
            <li
              key={row.key}
              id={`palette-${index}`}
              role="option"
              aria-selected={index === activeIndex}
              className="flex cursor-pointer flex-col items-baseline justify-between gap-1 rounded-sm px-3 py-2 data-[active=true]:bg-surface-2 data-[active=true]:shadow-[inset_0_0_0_1px_var(--line-control)] sm:flex-row sm:gap-3"
              data-active={index === activeIndex}
              onMouseEnter={() => setActiveIndex(index)}
              onMouseDown={(event) => {
                event.preventDefault();
                commit(index);
              }}
            >
              <span className="flex min-w-0 items-baseline gap-2 overflow-hidden text-ellipsis whitespace-nowrap">
                {row.kind === 'endpoint' ? (
                  <EndpointLine {...splitEndpointLabel(row.label)} size="sm" />
                ) : (
                  <>
                    <span className="text-xs text-text-muted capitalize">
                      {row.kind}
                    </span>
                    {row.label}
                  </>
                )}
              </span>
              <span className="flex-none self-start text-xs text-text-muted">
                {row.detail}
              </span>
            </li>
          ))}
          {/* biome-ignore-end lint/a11y/noNoninteractiveElementToInteractiveRole: combobox option */}
          {/* biome-ignore-end lint/a11y/useFocusableInteractive: focus stays on the input */}
        </ul>

        {rows.length === 0 ? (
          <p className="p-4 text-sm text-text-muted">
            {trimmed.length < 2
              ? 'Type at least two characters to search across your projects.'
              : `Nothing matches "${query.trim()}" in the projects you can read.`}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** The server sends an endpoint hit as `GET /orders/{id}`; the motif needs both parts. */
function splitEndpointLabel(label: string): {
  method: HttpMethod;
  path: string;
} {
  const [method, ...rest] = label.split(' ');
  return { method: method.toLowerCase() as HttpMethod, path: rest.join(' ') };
}
