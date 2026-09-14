import type { HttpMethod } from '@apion/contracts';

/**
 * The identity motif from DESIGN.md: `GET /orders/{orderId}` as one typographic
 * unit. It appears in tree rows, editor headers, search results, diffs, status
 * history and the activity feed, so recognising an endpoint anywhere in the
 * product is the same act of reading.
 *
 * Path parameters are set apart from literal segments because a reader scanning
 * a long list needs to see the shape of a route, not just its text.
 */
export function EndpointLine({
  method,
  path,
  size = 'base',
}: {
  method: HttpMethod;
  path: string;
  size?: 'sm' | 'base' | 'lg';
}) {
  return (
    /*
      Below the tree/detail split the method wraps above the path rather than
      stealing width from it, which is why the row may wrap at all.
    */
    <span
      className={`inline-flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 font-mono sm:flex-nowrap sm:gap-y-0 ${SIZES[size]}`}
    >
      {/*
        Fixed-width and right-aligned once there is room, so paths line up down
        a list: without that the eye re-finds the start of every path, which is
        the whole cost of a long tree.
      */}
      <span
        className={`flex-none text-[0.85em] font-semibold tracking-[0.02em] text-method-other sm:text-right ${METHOD_WIDTHS[size]}`}
        data-method={method}
      >
        {method.toUpperCase()}
      </span>
      <span className="min-w-0 [overflow-wrap:anywhere] text-text sm:overflow-hidden sm:text-ellipsis sm:whitespace-nowrap">
        {renderPath(path)}
      </span>
    </span>
  );
}

const SIZES: Record<'sm' | 'base' | 'lg', string> = {
  sm: 'text-xs',
  base: 'text-sm',
  lg: 'text-md',
};

/** The method column widens with the type size so the paths still align. */
const METHOD_WIDTHS: Record<'sm' | 'base' | 'lg', string> = {
  sm: 'sm:w-14',
  base: 'sm:w-17',
  lg: 'sm:w-20',
};

/**
 * Splits on `{param}` so the braces and the name can be styled apart.
 *
 * Index is the right key here: the segments are positional and a path may
 * legitimately repeat text (`/orders/{id}/orders`), so nothing else about a
 * segment identifies it. The list is also derived fresh from `path` and never
 * reordered, which is the case index keys are unsafe for.
 */
function renderPath(path: string) {
  return path.split(/(\{[^}]*\})/g).map((segment, index) => {
    if (!segment.startsWith('{')) {
      // biome-ignore lint/suspicious/noArrayIndexKey: positional, see above
      return <span key={`${index}-literal`}>{segment}</span>;
    }
    return (
      // biome-ignore lint/suspicious/noArrayIndexKey: positional, see above
      <span key={`${index}-param`} className="text-text-muted">
        {segment}
      </span>
    );
  });
}
