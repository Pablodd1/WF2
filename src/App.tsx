import { useRef } from 'react';

export default function App() {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  return (
    <div style={{ width: '100%', height: '100vh', overflow: 'hidden', position: 'relative' }}>
      <div style={{ position: 'absolute', top: 8, right: 12, zIndex: 100 }}>
        <a href="/dashboard" style={{ color: '#7a7f94', fontSize: 12, textDecoration: 'none', background: '#1a1d28', padding: '4px 12px', borderRadius: 6, border: '1px solid #2a2d3a' }}>Dashboard &rarr;</a>
      </div>
      <iframe
        ref={iframeRef}
        src="/extract.html"
        style={{ width: '100%', height: '100%', border: 'none' }}
        title="WatchFacts Extractor"
        sandbox="allow-scripts allow-same-origin"
      />
    </div>
  );
}
