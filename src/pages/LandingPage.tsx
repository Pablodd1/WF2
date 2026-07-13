import { ArrowRight, BarChart3, Building2, Search, ShieldCheck } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';

const routes = [
  { icon: Search, label: 'Price research', detail: 'Reference-level market evidence', to: '/price-research' },
  { icon: BarChart3, label: 'Trading floor', detail: 'Dated dealer listings', to: '/trading' },
  { icon: ShieldCheck, label: 'Dealer access', detail: 'Operations and review workspace', to: '/dashboard' },
];

export default function LandingPage() {
  const navigate = useNavigate();

  return (
    <main className="min-h-screen bg-[#080808] text-white">
      <header className="relative z-20 flex h-16 items-center justify-between border-b border-white/10 px-5 sm:px-8 lg:px-12">
        <Link to="/" className="text-sm font-extrabold uppercase tracking-[0.16em] text-white">WatchFacts</Link>
        <nav className="flex items-center gap-5 text-xs font-medium text-white/70 sm:gap-7">
          <Link to="/price-research" className="transition-colors hover:text-white">Research</Link>
          <Link to="/trading" className="transition-colors hover:text-white">Trading</Link>
          <Link to="/dashboard" className="hidden transition-colors hover:text-white sm:block">Dealer login</Link>
        </nav>
      </header>

      <section className="relative isolate flex min-h-[calc(100svh-4rem)] items-end overflow-hidden border-b border-white/10 px-5 pb-10 pt-16 sm:px-8 sm:pb-14 lg:px-12 lg:pb-16">
        <div className="absolute inset-y-0 right-0 z-[-1] w-full overflow-hidden lg:w-[58%]">
          <img
            src="/images/watchfacts-hero-watch.png"
            alt="Unbranded steel sports watch with a dark blue dial"
            className="h-full w-full object-cover object-center opacity-90 lg:object-[58%_50%]"
          />
          <div className="absolute inset-0 bg-black/40" />
        </div>

        <div className="relative z-10 max-w-3xl">
          <p className="mb-5 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#d8bd80]">Independent luxury market intelligence</p>
          <h1 className="max-w-2xl text-5xl font-semibold leading-[0.94] tracking-normal sm:text-7xl lg:text-8xl">
            See the market<br />
            <span className="text-white/55">before the noise.</span>
          </h1>
          <p className="mt-7 max-w-md text-base leading-7 text-white/72 sm:text-lg">
            WatchFacts turns fragmented dealer listings into dated, comparable market evidence for the watches that matter.
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            <button onClick={() => navigate('/trading')} className="flex h-12 items-center gap-2 bg-white px-5 text-sm font-semibold text-black transition-colors hover:bg-[#d8bd80]">
              Explore listings <ArrowRight size={17} />
            </button>
            <button onClick={() => navigate('/price-research')} className="flex h-12 items-center gap-2 border border-white/35 bg-black/20 px-5 text-sm font-semibold text-white backdrop-blur-sm transition-colors hover:border-white">
              Research a reference <Search size={16} />
            </button>
          </div>
        </div>

        <div className="absolute bottom-6 right-5 hidden items-center gap-3 text-[10px] font-medium uppercase tracking-[0.12em] text-white/55 sm:flex lg:right-12">
          <span className="h-px w-10 bg-white/35" /> Scroll to explore
        </div>
      </section>

      <section className="border-b border-white/10 bg-[#101010] px-5 py-9 sm:px-8 lg:px-12">
        <div className="mx-auto grid max-w-[1440px] gap-6 lg:grid-cols-[1.1fr_2fr] lg:items-start">
          <h2 className="max-w-sm text-2xl font-medium leading-tight text-white sm:text-3xl">Built for decisions that need a real market.</h2>
          <div className="grid divide-y divide-white/10 border-t border-white/10 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            <div className="py-4 sm:px-5 sm:py-0"><p className="text-[11px] uppercase tracking-[0.13em] text-[#d8bd80]">Evidence</p><p className="mt-2 text-sm leading-6 text-white/65">Source text and message time stay connected to each observation.</p></div>
            <div className="py-4 sm:px-5 sm:py-0"><p className="text-[11px] uppercase tracking-[0.13em] text-[#d8bd80]">Comparison</p><p className="mt-2 text-sm leading-6 text-white/65">Price signals are separated by reference, configuration, condition, and intent.</p></div>
            <div className="py-4 sm:px-5 sm:py-0"><p className="text-[11px] uppercase tracking-[0.13em] text-[#d8bd80]">Control</p><p className="mt-2 text-sm leading-6 text-white/65">Ambiguous listings move into review instead of becoming false certainty.</p></div>
          </div>
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
        <span>WatchFacts</span>
        <span className="flex items-center gap-2"><Building2 size={13} /> Dealer network intelligence</span>
        <Link to="/dashboard" className="text-white/70 transition-colors hover:text-white">Open operations</Link>
      </footer>
    </main>
  );
}
