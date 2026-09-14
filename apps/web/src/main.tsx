import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRouter, RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RequestError } from './api/client.js';
import { routeTree } from './routeTree.gen';
import { initialiseTheme } from './state/theme.js';
import './styles.css';

// Applied before the first paint so a light-mode user never sees a dark flash.
initialiseTheme();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // A contract does not change under the reader every few seconds, and this
      // is a tool people leave open for hours. Refetching on every focus would
      // be constant noise on a 1 vCPU host.
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => {
        // Retrying a 401, 403 or 404 just delays the message the user needs.
        if (error instanceof RequestError && error.status < 500) return false;
        return failureCount < 2;
      },
    },
  },
});

const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: 'intent',
  // The loaders read through the query cache, which already knows what is fresh.
  defaultPreloadStaleTime: 0,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

const container = document.getElementById('root');
if (!container)
  throw new Error('The #root element is missing from index.html.');

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
