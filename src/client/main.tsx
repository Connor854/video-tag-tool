import React, { useState } from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { httpBatchLink } from '@trpc/client';
import superjson from 'superjson';
import { trpc } from './trpc';
import { supabase } from '../lib/supabaseClient.js';
import AuthGuard from './components/AuthGuard';
import './styles/globals.css';

function Root() {
  const [queryClient] = useState(() => new QueryClient());
  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [
        httpBatchLink({
          url: '/api/trpc',
          transformer: superjson,
          async headers() {
            const h: Record<string, string> = {};
            const secret = localStorage.getItem('adminSecret');
            if (secret) h['x-admin-secret'] = secret;
            const { data: { session } } = await supabase.auth.getSession();
            if (session?.access_token) h['Authorization'] = `Bearer ${session.access_token}`;
            return h;
          },
        }),
      ],
    }),
  );

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <AuthGuard />
      </QueryClientProvider>
    </trpc.Provider>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
