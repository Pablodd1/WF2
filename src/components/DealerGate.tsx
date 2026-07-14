import { type ReactNode, useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';

interface DealerGateProps { children: ReactNode }

export function DealerGate({ children }: DealerGateProps) {
  const location = useLocation();
  const betaSkipEnabled = import.meta.env.VITE_ENABLE_DEALER_SKIP !== 'false';
  const [state, setState] = useState<'loading' | 'authorized' | 'denied'>(() =>
    betaSkipEnabled && sessionStorage.getItem('wf_beta_skip') === '1' ? 'authorized' : 'loading'
  );

  useEffect(() => {
    if (state === 'authorized') return;
    const controller = new AbortController();
    fetch('/api/dealer-auth', { credentials: 'include', signal: controller.signal })
      .then(async response => {
        const result = response.headers.get('content-type')?.includes('application/json') ? await response.json() : null;
        setState(response.ok && result?.authenticated === true ? 'authorized' : 'denied');
      })
      .catch(error => {
        if (error?.name !== 'AbortError') setState('denied');
      });
    return () => controller.abort();
  }, [state]);

  if (state === 'loading') {
    return <div className="flex min-h-screen items-center justify-center bg-bg-primary text-sm text-text-secondary">Checking dealer session...</div>;
  }
  if (state === 'denied') {
    return <Navigate to="/dealer-login" replace state={{ from: `${location.pathname}${location.search}` }} />;
  }
  return children;
}
