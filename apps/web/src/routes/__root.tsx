import type { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, Outlet } from '@tanstack/react-router';
import { ErrorState } from '../components/States.js';

export interface RouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
  notFoundComponent: () => (
    <main className="page-shell">
      <h1>That page does not exist</h1>
      <p>Check the address, or open a project from the switcher.</p>
    </main>
  ),
  errorComponent: ({ error }) => (
    <main className="page-shell">
      <ErrorState error={error} />
    </main>
  ),
});

function RootLayout() {
  return (
    <>
      {/* R-32: keyboard users skip the sidebar and switcher on every navigation. */}
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <Outlet />
    </>
  );
}
