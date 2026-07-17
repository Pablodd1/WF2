import { useEffect, useRef } from 'react';
import { ArrowRight, BarChart3, Building2, Search, ShieldCheck } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { SocialShareRail } from '@/components/SocialShareRail';

const routes = [
  { icon: Search, label: 'Price research', detail: 'Reference-level market evidence', to: '/price-research' },
  { icon: BarChart3, label: 'Trading floor', detail: 'Dated dealer listings', to: '/trading' },
  { icon: ShieldCheck, label: 'Dealer access', detail: 'Secure market workspace', to: '/dealer' },
];

export default function LandingPage() {
  const navigate = useNavigate();
  const heroRef = useRef<HTMLElement>(null);
  const heroMediaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const hero = heroRef.current;
    const media = heroMediaRef.current;
    if (!hero || !media) return;

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const video = media.querySelector('video');
    if (reducedMotion) video?.pause();

    const updateHero = () => {
      const rect = hero.getBoundingClientRect();
      const progress = Math.min(1, Math.max(0, -rect.top / Math.max(1, rect.height)));
      media.style.transform = reducedMotion
        ? 'scale(1.04)'
        : `translate3d(0, ${progress * 72}px, 0) scale(${1.04 + progress * 0.045})`;
      media.style.opacity = String(1 - progress * 0.32);
    };

    updateHero();
    window.addEventListener('scroll', updateHero, { passive: true });
    window.addEventListener('resize', updateHero);
    return () => {
      window.removeEventListener('scroll', updateHero);
      window.removeEventListener('resize', updateHero);
    };
  }, []);

  return (
    <main className="min-h-screen bg-[#080808] text-white">
      <header className="relative z-20 flex h-16 items-center justify-between border-b border-white/10 px-5 sm:px-8 lg:px-12">
        <Link to="/" aria-label="Curated Luxury home">
          <img src="/images/curated-luxury-logo-dark.png" alt="Curated Luxury" className="h-9 w-auto" />
        </Link>
        <nav className="flex items-center gap-5 text-xs font-medium text-white/70 sm:gap-7">
          <Link to="/price-research" className="transition-colors hover:text-white">Research</Link>
          <Link to="/trading" className="transition-colors hover:text-white">Trading</Link>
          <Link to="/dealer-login" className="hidden transition-colors hover:text-white sm:block">Dealer login</Link>
        </nav>
      </header>

      <section ref={heroRef} className="relative isolate flex min-h-[calc(94svh-4rem)] items-end overflow-hidden border-b border-white/10 bg-black px-5 pb-10 pt-16 sm:px-8 sm:pb-14 lg:px-12 lg:pb-16">
        <div ref={heroMediaRef} className="absolute -inset-[5%] z-[-2] origin-center will-change-transform">
          <video
            className="h-full w-full object-cover"
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
            poster="/video/curated-luxury-hero-poster.jpg"
            aria-hidden="true"
          >
            <source src="/video/curated-luxury-hero.webm" type="video/webm" />
            <source src="/video/curated-luxury-hero.mp4" type="video/mp4" />
          </video>
        </div>
        <div className="absolute inset-0 z-[-1] bg-[linear-gradient(180deg,rgba(0,0,0,0.2)_0%,rgba(0,0,0,0.36)_48%,rgba(0,0,0,0.9)_100%)]" />

        <div className="absolute inset-x-0 top-[2%] flex justify-center px-5">
          <img src="/images/curated-luxury-logo-dark.png" alt="Curated Luxury" className="h-auto w-[min(86vw,920px)] drop-shadow-[0_5px_24px_rgba(0,0,0,0.72)]" />
        </div>

        <div className="relative z-10 max-w-3xl">
          <h1 className="max-w-3xl text-5xl font-semibold leading-[0.94] tracking-normal sm:text-7xl lg:text-8xl">
            Objects beyond<br />
            <span className="text-white/55">the ordinary.</span>
          </h1>
          <p className="mt-7 max-w-xl text-base leading-7 text-white/72 sm:text-lg">
            Discover important watches, high jewelry, rare handbags, collectible art, and singular objects selected for people who value provenance and distinction.
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            <button onClick={() => navigate('/trading')} className="flex h-12 items-center gap-2 bg-white px-5 text-sm font-semibold text-black transition-colors hover:bg-[#d8bd80]">
              Explore listings <ArrowRight size={17} />
            </button>
            <button onClick={() => navigate('/price-research')} className="flex h-12 items-center gap-2 border border-white/35 bg-black/20 px-5 text-sm font-semibold text-white backdrop-blur-sm transition-colors hover:border-white">
              Explore watch research <Search size={16} />
            </button>
          </div>
        </div>

        <div className="absolute bottom-6 right-5 hidden items-center gap-3 text-[10px] font-medium uppercase tracking-[0.12em] text-white/55 sm:flex lg:right-12">
          <span className="h-px w-10 bg-white/35" /> Scroll to explore
        </div>
      </section>

      <section className="bg-[#080808] px-5 py-14 sm:px-8 sm:py-18 lg:px-12">
        <div className="mx-auto max-w-[1440px] border-t border-white/10">
          {routes.map(({ icon: Icon, label, detail, to }, index) => (
            <Link key={to} to={to} className="group grid min-h-28 grid-cols-[42px_1fr_auto] items-center gap-3 border-b border-white/10 py-5 transition-colors hover:bg-white/[0.035] sm:grid-cols-[80px_1fr_1fr_auto] sm:gap-5 sm:px-5">
              <span className="text-xs font-mono text-white/40">0{index + 1}</span>
              <span className="flex items-center gap-3 text-lg font-medium sm:text-2xl"><Icon size={20} className="text-[#d8bd80]" />{label}</span>
              <span className="hidden text-sm text-white/55 sm:block">{detail}</span>
              <ArrowRight size={19} className="text-white/45 transition-transform group-hover:translate-x-1 group-hover:text-white" />
            </Link>
          ))}
        </div>
      </section>

      <footer className="flex flex-col gap-3 border-t border-white/10 px-5 py-6 text-[11px] uppercase tracking-[0.1em] text-white/45 sm:flex-row sm:items-center sm:justify-between sm:px-8 lg:px-12">
        <img src="/images/curated-luxury-logo-dark.png" alt="Curated Luxury" className="h-8 w-auto" />
        <span className="flex items-center gap-2"><Building2 size={13} /> Curated luxury marketplace</span>
        <Link to="/dealer-login" className="text-white/70 transition-colors hover:text-white">Open operations</Link>
      </footer>
      <SocialShareRail />
    </main>
  );
}
