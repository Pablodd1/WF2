import { type ReactNode, useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';

interface DealerGateProps {
  children: ReactNode;
  allowBetaSkip?: boolean;
}

export function DealerGate({ children, allowBetaSkip = false }: DealerGateProps) {
  const location = useLocation();
  // The demo entry point is deliberately limited to the routes that pass
  // allowBetaSkip. Do not let a stale Vercel build variable show the Skip
  // button while silently rejecting the session on the next route.
  const betaSkipEnabled = allowBetaSkip;
  const [state, setState] = useState<'loading' | 'authorized' | 'beta' | 'denied'>(() =>
    betaSkipEnabled && sessionStorage.getItem('wf_beta_skip') === '1' ? 'beta' : 'loading'
  );

  useEffect(() => {
    if (state === 'authorized') return;
    if (state === 'beta' && betaSkipEnabled) return;
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
  }, [betaSkipEnabled, state]);

  if (state === 'loading' || (state === 'beta' && !betaSkipEnabled)) {
    return <div className="flex min-h-screen items-center justify-center bg-bg-primary text-sm text-text-secondary">Checking dealer session...</div>;
  }
  if (state === 'denied') {
    return <Navigate to="/dealer-login" replace state={{ from: `${location.pathname}${location.search}` }} />;
  }
  return children;
}
