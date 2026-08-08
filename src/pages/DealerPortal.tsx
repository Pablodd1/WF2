import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Download, Globe2, MessageCircle, PlusCircle, Search, ShieldCheck, Smartphone, Store, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import { COMMUNITY_GROUPS, CONTACT_WHATSAPP_URL } from '@/components/Footer';
import { LUXFI_URL } from '@/components/MarketHeader';

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const portalLinks = [
  {
    title: 'Trading Floor',
    description: 'Browse current dealer inventory, WTS and WTB signals, and source evidence.',
    to: '/trading',
    icon: Store,
  },
  {
    title: 'Price Research',
    description: 'Research a reference using dated, comparable market observations.',
    to: '/price-research',
    icon: Search,
  },
  {
    title: 'Post Item',
    description: 'Submit a WTS offer or WTB request for moderated review before publication.',
    to: '/dealer/post',
    icon: PlusCircle,
  },
  {
    title: 'Hire FI',
    description: 'Let FI search the world for the watch or luxury item you need.',
    to: LUXFI_URL,
    external: true,
    icon: Globe2,
  },
  {
    title: 'Dealer Directory',
    description: 'Review verified counterparties, ratings, market activity, and current inventory.',
    to: '/dealers',
    icon: Users,
  },
  {
    title: 'Dealer Account',
    description: 'Manage your profile, listings, settings, billing status, and support tickets.',
    to: '/dealer/account/profile',
    icon: ShieldCheck,
  },
];

export default function DealerPortal() {
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);

  useEffect(() => {
    const captureInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', captureInstallPrompt);
    return () => window.removeEventListener('beforeinstallprompt', captureInstallPrompt);
  }, []);

  async function installApp() {
    if (!installPrompt) return;
    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  }

  return (
    <main className="min-h-screen bg-[#08080c] px-5 py-7 text-white sm:px-8 lg:px-12">
      <div className="mx-auto max-w-6xl">
        <header className="flex items-center justify-between border-b border-white/10 pb-5">
          <Link to="/" className="flex items-center gap-2 text-sm text-white/60 transition-colors hover:text-white">
            <ArrowLeft size={16} /> Curated Luxury
          </Link>
          <Link to="/dealer/account/profile" className="border border-white/15 px-3 py-2 text-xs font-semibold text-white/65 transition-colors hover:border-white/40 hover:text-white">Dealer Account</Link>
        </header>

        <section className="grid gap-8 border-b border-white/10 py-10 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <div className="mb-5 flex h-11 w-11 items-center justify-center border border-[#c9a96e]/45 text-[#c9a96e]">
              <ShieldCheck size={22} />
            </div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#c9a96e]">Workspace</p>
            <h1 className="mt-3 max-w-2xl font-serif text-4xl leading-tight sm:text-5xl">Market access, with the evidence attached.</h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-white/58">Search prices, review the live trading floor, and verify counterparties before a transaction.</p>
          </div>
          <div className="flex items-center gap-2 border border-[#c9a96e]/30 bg-[#c9a96e]/[0.08] px-3 py-2 text-xs text-[#ead6aa]">Public workspace</div>
        </section>

        <section className="grid gap-4 py-8 md:grid-cols-2">
          {portalLinks.map(({ title, description, to, external, icon: Icon }) => {
            const content = <>
              <div>
                <div className="flex h-10 w-10 items-center justify-center border border-white/15 text-[#c9a96e]"><Icon size={19} /></div>
                <h2 className="mt-7 text-2xl font-semibold">{title}</h2>
                <p className="mt-3 max-w-md text-sm leading-6 text-white/52">{description}</p>
              </div>
              <span className="mt-8 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-[#c9a96e]">Open <ArrowRight size={15} className="transition-transform group-hover:translate-x-1" /></span>
            </>;
            const className = "group flex min-h-56 flex-col justify-between border border-white/12 bg-[#111118] p-6 transition-colors hover:border-[#c9a96e]/55 sm:p-7";
            return external
              ? <a key={to} href={to} target="_blank" rel="noreferrer" className={className}>{content}</a>
              : <Link key={to} to={to} className={className}>{content}</Link>;
          })}

        </section>

        <section className="border-t border-white/10 py-10" aria-labelledby="community-heading">
          <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
            <div>
              <div className="flex h-10 w-10 items-center justify-center border border-white/15 text-[#c9a96e]"><MessageCircle size={19} /></div>
              <p className="mt-5 text-xs font-semibold uppercase tracking-[0.18em] text-[#c9a96e]">Community and contact</p>
              <h2 id="community-heading" className="mt-2 font-serif text-3xl">WatchFacts trading groups</h2>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-white/55">Contact WatchFacts or open the appropriate official WhatsApp and Telegram community directly.</p>
            </div>
            <a href={CONTACT_WHATSAPP_URL} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center justify-center gap-2 border border-[#c9a96e] px-5 text-sm font-semibold text-[#c9a96e] transition-colors hover:bg-[#c9a96e] hover:text-[#09090d]">
              <Globe2 size={17} /> Contact us on WhatsApp
            </a>
          </div>

          <div className="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {COMMUNITY_GROUPS.map(group => (
              <a key={group.href} href={group.href} target="_blank" rel="noreferrer" className="group border border-white/12 bg-[#111118] p-5 transition-colors hover:border-[#c9a96e]/55">
                <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#c9a96e]">{group.network}</div>
                <div className="mt-3 text-base font-semibold text-white">{group.name}</div>
                <div className="mt-5 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.1em] text-white/45 group-hover:text-[#c9a96e]">Join group <ArrowRight size={14} /></div>
              </a>
            ))}
          </div>
        </section>

        <section className="border-t border-white/10 py-10" aria-labelledby="install-heading">
          <div className="grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
            <div className="border border-white/12 bg-[#111118] p-7">
              <div className="flex h-12 w-12 items-center justify-center border border-[#c9a96e]/40 text-[#c9a96e]"><Smartphone size={22} /></div>
              <p className="mt-6 text-xs font-semibold uppercase tracking-[0.18em] text-[#c9a96e]">Quick access</p>
              <h2 id="install-heading" className="mt-2 font-serif text-3xl">Add WatchFacts to your phone</h2>
              <p className="mt-3 text-sm leading-6 text-white/55">Keep trading, sourcing, Price Research, and your workspace one tap away.</p>
              {installPrompt ? (
                <button type="button" onClick={() => void installApp()} className="mt-7 flex min-h-12 w-full items-center justify-center gap-2 bg-[#c9a96e] px-5 text-sm font-extrabold text-[#09090d]">
                  <Download size={17} /> Install WatchFacts
                </button>
              ) : (
                <div className="mt-7 border border-white/10 px-4 py-3 text-xs leading-5 text-white/45">If your browser supports direct installation, use its Install app or Add to Home screen command.</div>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="border border-white/12 p-6">
                <div className="text-sm font-semibold text-white">Android</div>
                <ol className="mt-4 space-y-3 text-sm leading-6 text-white/55">
                  <li>1. Open WatchFacts in Chrome.</li>
                  <li>2. Open the browser menu.</li>
                  <li>3. Choose Install app or Add to Home screen.</li>
                </ol>
              </div>
              <div className="border border-white/12 p-6">
                <div className="text-sm font-semibold text-white">iPhone</div>
                <ol className="mt-4 space-y-3 text-sm leading-6 text-white/55">
                  <li>1. Open WatchFacts in Safari.</li>
                  <li>2. Tap the Share button.</li>
                  <li>3. Choose Add to Home Screen.</li>
                </ol>
              </div>
            </div>
          </div>
        </section>

      </div>
    </main>
  );
}
