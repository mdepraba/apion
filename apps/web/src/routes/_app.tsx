import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createFileRoute,
  Link,
  Outlet,
  redirect,
  useNavigate,
} from '@tanstack/react-router';
import { useState } from 'react';
import { readToken, writeToken } from '../api/client.js';
import { sessionQuery } from '../api/queries.js';
import { CommandPalette } from '../components/CommandPalette.js';
import { ThemeToggle } from '../components/ThemeToggle.js';

/**
 * Pathless layout for everything behind a session. `beforeLoad` rejects before
 * any child loader runs, so a signed-out visitor never fires a request that
 * would only come back 401.
 */
export const Route = createFileRoute('/_app')({
  beforeLoad: async ({ context, location }) => {
    if (!readToken()) {
      throw redirect({ to: '/login', search: { next: location.href } });
    }

    try {
      await context.queryClient.ensureQueryData(sessionQuery());
    } catch {
      // The token is present but no longer accepted. Clear it so the login
      // screen does not bounce straight back here.
      writeToken(null);
      throw redirect({ to: '/login', search: { next: location.href } });
    }
  },
  component: AppLayout,
});

function AppLayout() {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const session = useQuery(sessionQuery());

  /**
   * Signing out is a client-side act: the token is a bearer credential the
   * server does not track, so dropping it and clearing the cache is the whole
   * of it. The cache goes too, or the next person to sign in on this machine
   * sees the previous one's projects before their own load.
   */
  const signOut = async () => {
    writeToken(null);
    queryClient.clear();
    await navigate({ to: '/login', search: { next: undefined } });
  };

  return (
    /*
      `minmax(0, 1fr)` rather than `1fr`: a bare `1fr` track refuses to shrink
      below its content, so a tall endpoint pushed the shell past the viewport
      and the whole page scrolled instead of the pane inside it.
    */
    <div className="grid h-full grid-rows-[var(--spacing-header)_minmax(0,1fr)]">
      {/* Above the panes below, so the account menu is not painted under them. */}
      <header className="relative z-10 flex min-w-0 items-center gap-2 border-b border-line bg-surface-1 px-3 sm:gap-4 sm:px-4">
        <Link
          to="/"
          className="min-w-0 flex-none font-semibold tracking-tight text-text no-underline"
        >
          Apion
        </Link>

        {/* FR-1.2: the switcher is the primary way between projects. */}
        <button
          type="button"
          className="flex min-h-8 min-w-0 flex-1 cursor-pointer items-center justify-between gap-3 overflow-hidden rounded-md border border-line-control bg-surface-0 pr-2 pl-3 text-left text-sm text-text-muted hover:text-text sm:max-w-120"
          onClick={() => setPaletteOpen(true)}
        >
          <span className="overflow-hidden text-ellipsis whitespace-nowrap">
            Search endpoints, schemas and projects
          </span>
          {/* Noise on a device with no keyboard. */}
          <kbd className="hidden flex-none rounded-sm border border-line-control px-1 py-px font-mono text-xs sm:block">
            Ctrl K
          </kbd>
        </button>

        <div className="ml-auto flex flex-none items-center gap-2">
          <ThemeToggle />

          {/*
            A `details` element: it opens on click, closes on Escape and is
            reachable by keyboard without any of that being written here.
          */}
          <details className="relative">
            <summary className="flex min-h-8 cursor-pointer list-none items-center whitespace-nowrap rounded-md border border-line-control px-3 text-sm text-text-muted hover:bg-surface-2 hover:text-text [&::-webkit-details-marker]:hidden">
              <span className="max-w-[12ch] overflow-hidden text-ellipsis whitespace-nowrap">
                {session.data?.displayName ?? 'Account'}
              </span>
            </summary>
            <div className="absolute right-0 z-20 mt-1 min-w-56 rounded-md border border-line-control bg-surface-1 p-3 shadow-[var(--shadow-overlay)]">
              <p className="mb-3 [overflow-wrap:anywhere] text-sm text-text-muted">
                {session.data?.email}
              </p>
              <button
                type="button"
                className="w-full cursor-pointer rounded-sm border border-line-control p-2 text-sm text-text hover:bg-surface-2"
                onClick={() => void signOut()}
              >
                Sign out
              </button>
            </div>
          </details>
        </div>
      </header>

      <main id="main" className="min-h-0 overflow-auto">
        <Outlet />
      </main>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}
