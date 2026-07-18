import { useEffect, useRef, useState } from 'react';

export function AppSplash() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [visible, setVisible] = useState(true);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (video) {
      video.currentTime = 0;
      void video.play().catch(() => {
        // Keep the branded poster visible until the fallback closes the splash.
      });
    }

    const fallback = window.setTimeout(() => setVisible(false), 6500);
    return () => window.clearTimeout(fallback);
  }, []);

  useEffect(() => {
    if (!ready) return;
    const timeout = window.setTimeout(() => setVisible(false), 4200);
    return () => window.clearTimeout(timeout);
  }, [ready]);

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-[200] grid place-items-center overflow-hidden bg-[#070706] px-6" role="status" aria-label="Loading Curated Luxury">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_48%,rgba(205,167,78,0.24),transparent_48%),linear-gradient(130deg,#070706_5%,#15110a_50%,#070706_92%)]" />
      <video
        ref={videoRef}
        className="relative h-full w-full object-cover sm:object-contain"
        autoPlay
        muted
        playsInline
        preload="auto"
        poster="/images/curated-luxury-logo-dark.png"
        onLoadedData={() => setReady(true)}
        onPlaying={() => setReady(true)}
        onEnded={() => setVisible(false)}
        aria-hidden="true"
      >
        <source src="/video/curated-luxury-splash.mp4" type="video/mp4" />
      </video>
      <span className="absolute bottom-8 left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] font-medium uppercase tracking-[0.28em] text-[#e1c77e]/75">Curated Luxury</span>
    </div>
  );
}
