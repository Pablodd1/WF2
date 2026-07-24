import { ArrowLeft, BadgeCheck, CalendarDays, MessageCircle, Star, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { MarketNav } from '@/components/MarketNav';

interface ProfilePayload {
  dealer: {
    id: string; display_name: string | null; company_name: string | null; country_code: string | null; city: string | null;
    rating: number | null; review_count: number; whatsapp_group_count: number; avatar_url: string | null; profile_summary: string | null;
  };
  stats: { total_posts: number | null; wts_posts: number | null; wtb_posts: number | null; active_listings: number | null; dated_posts: number | null; undated_posts: number | null; first_post_at: string | null; last_post_at: string | null; posting_years: number | null } | null;
  listings: Array<{ id: string; brand: string | null; reference: string | null; dial_color: string | null; condition: string | null; price_usd: number | null; currency: string | null; listing_type: string; listing_date: string | null; created_at: string; raw_message?: string }>;
  raw_message_access: boolean;
}

export default function DealerProfile() {
  const { dealerId = '' } = useParams();
  const [payload, setPayload] = useState<ProfilePayload | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/dealer-profile?id=${encodeURIComponent(dealerId)}`, { credentials: 'include', signal: controller.signal })
      .then(async response => { const body = await response.json(); if (!response.ok) throw new Error(body.error || 'Unable to load profile'); return body; })
      .then(setPayload)
      .catch(caught => { if (caught?.name !== 'AbortError') setError(caught.message); });
    return () => controller.abort();
  }, [dealerId]);

  if (error) return <main className="min-h-screen bg-[#08080c] text-white"><MarketNav /><div className="mx-auto max-w-5xl px-5 py-16"><p className="text-amber-200">{error}</p></div></main>;
  if (!payload) return <main className="min-h-screen bg-[#08080c] text-white"><MarketNav /><div className="mx-auto max-w-5xl px-5 py-16 text-white/45">Loading dealer profile...</div></main>;
  const { dealer, stats, listings } = payload;
  const name = dealer.display_name || dealer.company_name || 'Verified dealer';
  const count = (value: number | null | undefined) => value == null ? 'Not available' : Number(value).toLocaleString();
  const date = (value: string | null | undefined) => value ? value.slice(0, 10) : 'Original date unavailable';

  return (
    <main className="min-h-screen bg-[#08080c] text-white">
      <MarketNav />
      <section className="border-b border-white/10 px-5 py-10 sm:px-8 lg:px-12">
        <div className="mx-auto max-w-6xl">
          <Link to="/trading" className="inline-flex items-center gap-2 text-xs text-white/50 hover:text-white"><ArrowLeft size={14} /> Trading Floor</Link>
          <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_auto] lg:items-end">
            <div className="flex items-start gap-5">
              <div className="grid h-20 w-20 shrink-0 place-items-center border border-[#c9a96e]/35 bg-[#111118] text-2xl text-[#c9a96e]">
                {dealer.avatar_url ? <img src={dealer.avatar_url} alt="" className="h-full w-full object-cover" /> : name.slice(0, 2).toUpperCase()}
              </div>
              <div>
                <div className="flex items-center gap-2 text-xs uppercase tracking-[0.15em] text-[#c9a96e]"><BadgeCheck size={15} /> Verified dealer</div>
                <h1 className="mt-3 font-serif text-4xl sm:text-5xl">{name}</h1>
                <p className="mt-2 text-sm text-white/45">{[dealer.city, dealer.country_code].filter(Boolean).join(', ') || 'Location not published'}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-4 text-sm text-white/60">
              <span className="flex items-center gap-2"><Star size={15} className="text-[#c9a96e]" /> {dealer.rating == null ? 'Unrated' : Number(dealer.rating).toFixed(2)} · {dealer.review_count} reviews</span>
              <span className="flex items-center gap-2"><Users size={15} /> {dealer.whatsapp_group_count > 0 ? `${dealer.whatsapp_group_count.toLocaleString()} WhatsApp groups` : 'WhatsApp groups not published'}</span>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-8 sm:px-8 lg:px-12">
        <div className="grid gap-px bg-white/10 sm:grid-cols-2 lg:grid-cols-6">
          <ProfileMetric label="Total linked posts" value={count(stats?.total_posts)} />
          <ProfileMetric label="Active listings" value={count(stats?.active_listings)} />
          <ProfileMetric label="For sale posts" value={count(stats?.wts_posts)} />
          <ProfileMetric label="Looking for posts" value={count(stats?.wtb_posts)} />
          <ProfileMetric label="Posting years" value={count(stats?.posting_years)} />
          <ProfileMetric label="Dated / undated" value={`${count(stats?.dated_posts)} / ${count(stats?.undated_posts)}`} />
        </div>
        <p className="mt-5 text-xs text-white/40">Original posting range: {date(stats?.first_post_at)} to {date(stats?.last_post_at)}. Import timestamps are never substituted for missing source dates.</p>
        {dealer.profile_summary && <p className="mt-8 max-w-3xl text-sm leading-7 text-white/55">{dealer.profile_summary}</p>}

        <div className="mt-10 flex items-center justify-between border-b border-white/10 pb-4">
          <h2 className="text-xl font-semibold">Recent market activity</h2>
          <span className="text-xs text-white/35">Up to {listings.length} linked posts shown</span>
        </div>
        <div className="divide-y divide-white/10">
          {listings.map(listing => (
            <article key={listing.id} className="grid gap-4 py-5 md:grid-cols-[1fr_auto]">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-[#c9a96e]">{listing.listing_type}</span>
                  <h3 className="font-semibold">{[listing.brand, listing.reference, listing.dial_color].filter(Boolean).join(' · ') || 'Luxury listing'}</h3>
                </div>
                <div className="mt-2 flex flex-wrap gap-4 text-xs text-white/42">
                  <span>{listing.condition || 'Condition unspecified'}</span>
                  <span className="flex items-center gap-1"><CalendarDays size={13} /> {listing.listing_date ? listing.listing_date.split('T')[0] : 'Original date unknown'}</span>
                </div>
                {payload.raw_message_access && listing.raw_message && <details className="mt-4 border-l border-[#c9a96e]/35 pl-4"><summary className="cursor-pointer text-xs text-white/50">Raw source message</summary><pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap text-xs leading-6 text-white/55">{listing.raw_message}</pre></details>}
              </div>
              <div className="md:text-right">
                <div className="text-lg font-semibold text-[#d4b87a]">{listing.price_usd ? `$${Number(listing.price_usd).toLocaleString()}` : 'Price not stated'}</div>
                <Link to={`/trading?q=${encodeURIComponent([listing.brand, listing.reference].filter(Boolean).join(' '))}`} className="mt-3 inline-flex items-center gap-2 text-xs text-white/55 hover:text-white"><MessageCircle size={14} /> Check availability</Link>
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

function ProfileMetric({ label, value }: { label: string; value: string }) {
  return <div className="bg-[#111118] px-4 py-5"><div className="font-mono text-lg text-white sm:text-xl">{value}</div><div className="mt-2 text-[10px] uppercase tracking-wider text-white/35">{label}</div></div>;
}
