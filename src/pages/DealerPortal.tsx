import { ArrowLeft, ArrowRight, BadgeCheck, LogOut, Search, ShieldCheck, Store, Users } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';

const portalLinks = [
  {
    title: 'Price Search',
    description: 'Research a reference using dated, comparable market observations.',
    to: '/price-research',
    icon: Search,
  },
  {
    title: 'Trading Floor',
    description: 'Browse current dealer inventory, WTS and WTB signals, and source evidence.',
    to: '/trading',
    icon: Store,
  },
  {
    title: 'Dealer Directory',
    description: 'Review verified counterparties, ratings, market activity, and current inventory.',
    to: '/dealers',
    icon: Users,
  },
];

export default function DealerPortal() {
  const navigate = useNavigate();
  const betaAccess = sessionStorage.getItem('wf_beta_skip') === '1';

  async function exitAccess() {
    sessionStorage.removeItem('wf_beta_skip');
    await fetch('/api/dealer-auth', { method: 'DELETE', credentials: 'include' }).catch(() => undefined);
    navigate('/dealer-login', { replace: true });
  }

  return (
    <main className="min-h-screen bg-[#08080c] px-5 py-7 text-white sm:px-8 lg:px-12">
      <div className="mx-auto max-w-6xl">
        <header className="flex items-center justify-between border-b border-white/10 pb-5">
          <Link to="/" className="flex items-center gap-2 text-sm text-white/60 transition-colors hover:text-white">
            <ArrowLeft size={16} /> Curated Luxury
          </Link>
          <button type="button" onClick={exitAccess} className="flex items-center gap-2 border border-white/15 px-3 py-2 text-xs font-semibold text-white/65 transition-colors hover:border-white/40 hover:text-white">
            <LogOut size={14} /> Exit access
          </button>
        </header>

        <section className="grid gap-8 border-b border-white/10 py-10 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <div className="mb-5 flex h-11 w-11 items-center justify-center border border-[#c9a96e]/45 text-[#c9a96e]">
              <ShieldCheck size={22} />
            </div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#c9a96e]">Dealer workspace</p>
            <h1 className="mt-3 max-w-2xl font-serif text-4xl leading-tight sm:text-5xl">Market access, with the evidence attached.</h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-white/58">Search prices, review the live trading floor, and verify counterparties before a transaction.</p>
          </div>
          <div className={`flex items-center gap-2 border px-3 py-2 text-xs ${betaAccess ? 'border-amber-300/25 bg-amber-300/[0.08] text-amber-100/75' : 'border-emerald-300/25 bg-emerald-300/[0.08] text-emerald-100/75'}`}>
            <BadgeCheck size={15} /> {betaAccess ? 'Beta session access' : 'Credentialed dealer session'}
          </div>
        </section>

        <section className="grid gap-4 py-8 md:grid-cols-2">
          {portalLinks.map(({ title, description, to, icon: Icon }) => (
            <Link key={to} to={to} className="group flex min-h-56 flex-col justify-between border border-white/12 bg-[#111118] p-6 transition-colors hover:border-[#c9a96e]/55 sm:p-7">
              <div>
                <div className="flex h-10 w-10 items-center justify-center border border-white/15 text-[#c9a96e]"><Icon size={19} /></div>
                <h2 className="mt-7 text-2xl font-semibold">{title}</h2>
                <p className="mt-3 max-w-md text-sm leading-6 text-white/52">{description}</p>
              </div>
              <span className="mt-8 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-[#c9a96e]">Open <ArrowRight size={15} className="transition-transform group-hover:translate-x-1" /></span>
            </Link>
          ))}

        </section>

        {betaAccess && (
          <aside className="mb-8 border-l-2 border-amber-300/55 bg-amber-300/[0.08] px-4 py-3 text-xs leading-6 text-amber-100/70">
            Beta skip grants temporary browsing access in this tab. Review approvals and other privileged dealer actions continue to require an authenticated role.
          </aside>
        )}
      </div>
    </main>
  );
}
