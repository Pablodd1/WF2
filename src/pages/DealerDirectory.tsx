import { BadgeCheck, Building2, Search, Star, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { MarketNav } from '@/components/MarketNav';

interface DealerStats {
  total_posts: number;
  wts_posts: number;
  wtb_posts: number;
  active_listings: number;
  first_post_at: string | null;
  last_post_at: string | null;
  posting_years: number;
}

interface DealerSummary {
  id: string;
  slug: string | null;
  display_name: string | null;
  company_name: string | null;
  country_code: string | null;
  city: string | null;
  rating: number | null;
  review_count: number;
  whatsapp_group_count: number;
  avatar_url: string | null;
  profile_summary: string | null;
  stats: DealerStats | null;
}

export default function DealerDirectory() {
  const [dealers, setDealers] = useState<DealerSummary[]>([]);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const pageSize = 24;

  useEffect(() => {
    const timer = window.setTimeout(() => { setLoading(true); setSearch(searchInput.trim()); setPage(1); }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (search) params.set('q', search);
    fetch(`/api/dealers?${params}`, { credentials: 'include', signal: controller.signal })
      .then(async response => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'Unable to load dealers');
        setDealers(payload.dealers || []);
        setTotal(Number(payload.total) || 0);
        setError('');
      })
      .catch(caught => { if (caught?.name !== 'AbortError') setError(caught.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [page, search]);

  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <main className="min-h-screen bg-[#08080c] text-white">
      <MarketNav />
      <section className="border-b border-white/10 px-5 py-10 sm:px-8 lg:px-12">
        <div className="mx-auto max-w-7xl">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#c9a96e]">Verified network</p>
          <div className="mt-3 grid gap-6 lg:grid-cols-[1fr_420px] lg:items-end">
            <div>
              <h1 className="font-serif text-4xl sm:text-5xl">Dealer directory</h1>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-white/55">Profiles reconcile verified identity, reputation, active inventory, WTS activity, and WTB demand without guessing from free-form messages.</p>
            </div>
            <label className="relative block">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" size={17} />
              <input value={searchInput} onChange={event => setSearchInput(event.target.value)} placeholder="Search dealer, company, or city" className="h-12 w-full border border-white/15 bg-[#111118] pl-10 pr-3 text-sm outline-none focus:border-[#c9a96e]" />
            </label>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-5 py-8 sm:px-8 lg:px-12">
        <div className="mb-5 flex items-center justify-between text-sm text-white/45">
          <span>{loading ? 'Loading verified profiles...' : `${total.toLocaleString()} verified dealers`}</span>
          <span>Page {page} of {pages}</span>
        </div>
        {error && <div role="alert" className="border border-amber-300/25 bg-amber-300/[0.07] px-4 py-3 text-sm text-amber-100/75">{error}</div>}
        {!error && !loading && dealers.length === 0 && <div className="border border-white/10 px-5 py-12 text-center text-sm text-white/45">No verified profiles match this search.</div>}
        <div className="grid gap-px bg-white/10 md:grid-cols-2 xl:grid-cols-3">
          {dealers.map(dealer => {
            const stats = dealer.stats;
            const name = dealer.display_name || dealer.company_name || 'Verified dealer';
            return (
              <Link key={dealer.id} to={`/dealers/${dealer.slug || dealer.id}`} className="group min-h-72 bg-[#101016] p-6 transition-colors hover:bg-[#15151d]">
                <div className="flex items-start justify-between gap-4">
                  <div className="grid h-12 w-12 place-items-center border border-[#c9a96e]/35 bg-[#08080c] text-[#c9a96e]">
                    {dealer.avatar_url ? <img src={dealer.avatar_url} alt="" className="h-full w-full object-cover" /> : <Building2 size={21} />}
                  </div>
                  <BadgeCheck size={19} className="text-[#c9a96e]" aria-label="Verified dealer" />
                </div>
                <h2 className="mt-7 text-xl font-semibold">{name}</h2>
                <p className="mt-1 text-xs text-white/42">{[dealer.city, dealer.country_code].filter(Boolean).join(', ') || 'Location not published'}</p>
                <div className="mt-5 flex items-center gap-4 text-xs text-white/60">
                  <span className="flex items-center gap-1"><Star size={13} className="text-[#c9a96e]" /> {dealer.rating == null ? 'Unrated' : Number(dealer.rating).toFixed(2)}</span>
                  <span>{dealer.review_count.toLocaleString()} feedback reviews</span>
                  <span className="flex items-center gap-1"><Users size={13} /> {dealer.whatsapp_group_count > 0 ? `${dealer.whatsapp_group_count.toLocaleString()} groups` : 'Groups not published'}</span>
                </div>
                <div className="mt-7 grid grid-cols-2 border-t border-white/10 pt-5 text-center sm:grid-cols-4">
                  <Metric label="Posts" value={stats?.total_posts ?? null} />
                  <Metric label="For sale" value={stats?.wts_posts || 0} />
                  <Metric label="Looking for" value={stats?.wtb_posts || 0} />
                  <Metric label="Active" value={stats?.active_listings || 0} />
                </div>
              </Link>
            );
          })}
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" disabled={page <= 1 || loading} onClick={() => { setLoading(true); setPage(value => Math.max(1, value - 1)); }} className="h-10 border border-white/15 px-4 text-xs disabled:opacity-35">Previous</button>
          <button type="button" disabled={page >= pages || loading} onClick={() => { setLoading(true); setPage(value => Math.min(pages, value + 1)); }} className="h-10 bg-[#c9a96e] px-4 text-xs font-semibold text-[#08080c] disabled:opacity-35">Next</button>
        </div>
      </section>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: number | null }) {
  return <div><div className="font-mono text-base text-white">{value == null ? '—' : Number(value).toLocaleString()}</div><div className="mt-1 text-[10px] uppercase tracking-wider text-white/35">{label}</div></div>;
}
