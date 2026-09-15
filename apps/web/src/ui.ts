/**
 * The control vocabulary, as Tailwind class lists.
 *
 * Every form in the product is the same handful of controls, so they are named
 * once here rather than retyped at each call site. This is the layer that used
 * to be the repeated `.input` / `.primary` / `.label` rule in ten CSS modules:
 * naming them keeps a change to "what an input looks like" a change in one
 * place, which is what DESIGN.md means by a design system rather than a set of
 * styles that happen to match.
 *
 * Anything used once belongs inline on its element instead. These are here
 * because they are used everywhere.
 */

/** A field's caption. Muted, because the value is what is being read. */
export const LABEL = 'text-sm font-medium text-text-muted';

/**
 * 16px minimum on the font size, whatever the density elsewhere: iOS zooms the
 * viewport when a focused input is smaller than that, and the zoom does not
 * come back.
 */
export const INPUT =
  'rounded-md border border-line-control bg-surface-1 px-3 py-2 text-[max(var(--text-base),16px)] text-text';

export const TEXTAREA = `${INPUT} resize-y`;

/** Mono, because what goes in it is JSON rather than prose. */
export const JSON_INPUT = `${TEXTAREA} font-mono`;

export const SELECT =
  'rounded-md border border-line-control bg-surface-1 px-2 py-1 text-base text-text';

/** The help line under a field: what to type, or what the field will do. */
export const HELP = 'text-xs text-text-muted';

export const BUTTON_BASE =
  'min-h-9 cursor-pointer rounded-md px-4 disabled:cursor-not-allowed disabled:opacity-55';

/** Amber. One primary action per view, and it is the one that commits. */
export const PRIMARY = `${BUTTON_BASE} border border-accent bg-accent font-semibold text-accent-text`;

export const SECONDARY = `${BUTTON_BASE} border border-line-control text-text hover:bg-surface-2`;

/** A button that reads as prose: used inside a sentence, not beside one. */
export const INLINE_BUTTON =
  'cursor-pointer border-0 bg-transparent p-0 text-text underline';

/** Amber's second job from DESIGN.md: unsaved state, and nothing else. */
export const UNSAVED = 'text-sm font-medium text-accent';

export const ERROR_TEXT =
  'rounded-md border border-status-danger px-3 py-2 text-status-danger';

export const MUTED = 'text-sm text-text-muted';

/** A stack of fields, at the one gap the forms all use. */
export const FIELD = 'flex flex-col gap-1';

/**
 * The body a client receives, on a sunken surface. Scrolls in its own box so a
 * wide example never widens the page.
 */
export const CODE_BLOCK =
  'overflow-x-auto rounded-md border border-line bg-surface-sunken p-3 text-sm/relaxed';

/**
 * A data table that scrolls inside its own box rather than moving the page.
 * R-03 allows a table wider than the screen only when it is contained like
 * this, and the `min-w-0` is what makes the containment hold: a grid or flex
 * child otherwise floors at its content width.
 */
export const TABLE_WRAP =
  'min-w-0 max-w-full overflow-x-auto rounded-md border border-line';

export const TABLE =
  'w-full border-collapse text-sm [&_td]:border-b [&_td]:border-line [&_td]:px-3 [&_td]:py-2 [&_td]:text-left [&_td]:align-top [&_th]:border-b [&_th]:border-line [&_th]:bg-surface-1 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-medium [&_th]:whitespace-nowrap [&_th]:text-text-muted [&_tbody_tr:last-child_td]:border-b-0';

/** A full-height page that scrolls on its own inside the app shell. */
export const PAGE_SCROLL = 'h-full min-h-0 overflow-y-auto';

/** The band at the top of a section page: breadcrumb and whatever sits beside it. */
export const PAGE_HEADER =
  'flex flex-wrap items-baseline gap-3 border-b border-line bg-surface-1 px-3 py-3 sm:px-5';

export const PAGE_SECTION = 'border-b border-line px-3 py-5 sm:px-5';
