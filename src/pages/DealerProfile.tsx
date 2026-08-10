import { BadgeCheck, CalendarDays, ExternalLink, MessageCircle, Star, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Footer } from '@/components/Footer';
import { MarketNav } from '@/components/MarketNav';
import { Breadcrumb } from '@/components/Breadcrumb';

interface ProfilePayload {
  dealer: {
    id: string; display_name: string | null; company_name: string | null; country_code: string | null; city: string | null;
    rating: number | null; review_count: number; whatsapp_group_count: number; avatar_url: string | null; profile_summary: string | null;
  };
  stats: { wts_count: number; wtb_count: number; group_count: number; first_post: string | null; latest_post: string | null; verified_contact_info: { phone: string; verification_status: 'VERIFIED' | 'SOURCE_PUBLISHED' } | null } | null;
  listings: Array<{ id: string; brand: string | null; reference: string | null; dial_color: string | null; condition: string | null; title?: string | null; price_usd: number | null; currency: string | null; listing_type: string; listing_date: string | null; created_at: string | null; raw_message?: string; image_url?: string | null; source_url?: string | null; source_display_price?: string | null; box?: string | null; papers?: string | null; availability_url?: string | null }>;
  source?: string;
  source_crawled_at?: string;
  source_metrics?: { profile_listing_total: number | null; feedback_received: number | null; rendered_feedback_rows: number; feedback_given?: number | null; feedback_requested?: number | null; own_account_view?: boolean };
  source_workflow?: { profile: string | null; reviews: string | null; wts: string | null; wtb: string | null; whatsapp: string | null; request_feedback: string | null };
  reviews?: Array<{ reviewer: string; date: string | null; sentiment: string | null; whatsapp_url: string | null }>;
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
          <Breadcrumb
            dark
            items={[
              { label: 'Home', to: '/' },
              { label: 'Trading Floor', to: '/trading' },
              { label: 'Dealers', to: '/dealers' },
              { label: name },
            ]}
            backTo="/dealers"
            backLabel="Back to Dealer Directory"
          />
          <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_auto] lg:items-end">
            <div className="flex items-start gap-5">
              <div className="grid h-20 w-20 shrink-0 place-items-center border border-[#c9a96e]/35 bg-[#111118] text-2xl text-[#c9a96e]">
                {dealer.avatar_url ? <img src={dealer.avatar_url} alt="" className="h-full w-full object-cover" /> : name.slice(0, 2).toUpperCase()}
              </div>
              <div>
                <div className="flex items-center gap-2 text-xs uppercase tracking-[0.15em] text-[#c9a96e]"><BadgeCheck size={15} /> {payload.source === 'watchfacts_directory_crawl' ? 'Source-published dealer profile' : 'Verified dealer'}</div>
                <h1 className="mt-3 font-serif text-4xl sm:text-5xl">{name}</h1>
                <p className="mt-2 text-sm text-white/45">{[dealer.city, dealer.country_code].filter(Boolean).join(', ') || 'Location not published'}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-4 text-sm text-white/60">
              <span className="flex items-center gap-2"><Star size={15} className="text-[#c9a96e]" /> {dealer.rating == null ? `${dealer.review_count} source feedback ratings` : `${Number(dealer.rating).toFixed(2)} · ${dealer.review_count} reviews`}</span>
              <span className="flex items-center gap-2"><Users size={15} /> {dealer.whatsapp_group_count > 0 ? `${dealer.whatsapp_group_count.toLocaleString()} WhatsApp groups` : 'WhatsApp groups not published'}</span>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-8 sm:px-8 lg:px-12">
        <div className="grid gap-px bg-white/10 sm:grid-cols-3">
          <ProfileMetric label="For sale posts" value={count(stats?.wts_count)} />
          <ProfileMetric label="Want to buy posts" value={count(stats?.wtb_count)} />
          <ProfileMetric label="Common groups" value={count(stats?.group_count)} />
        </div>
        <p className="mt-5 text-xs text-white/40">First post shown: {date(stats?.first_post)} · Latest post shown: {date(stats?.latest_post)}. Import timestamps are never substituted for missing source dates.</p>
        {stats?.verified_contact_info?.phone && (
          <a className="mt-4 inline-flex items-center gap-2 text-sm text-[#d4b87a] hover:text-white" href={`https://wa.me/${stats.verified_contact_info.phone.replace(/[^0-9]/g, '')}`} target="_blank" rel="noreferrer">
            <MessageCircle size={15} /> Contact verified poster on WhatsApp
          </a>
        )}
        {dealer.profile_summary && <p className="mt-8 max-w-3xl text-sm leading-7 text-white/55">{dealer.profile_summary}</p>}
        {payload.source_metrics && <div className="mt-8 grid gap-px bg-white/10 sm:grid-cols-3">
          <ProfileMetric label="Source profile listings" value={count(payload.source_metrics.profile_listing_total)} />
          <ProfileMetric label="Feedback received" value={count(payload.source_metrics.feedback_received)} />
          <ProfileMetric label="Feedback rows inspected" value={count(payload.source_metrics.rendered_feedback_rows)} />
        </div>}
        {payload.source_workflow && <div className="mt-6 flex flex-wrap gap-3 border border-white/10 bg-[#111118] p-4 text-xs">
          <span className="w-full text-[10px] font-semibold uppercase tracking-[0.15em] text-white/35">Source workflow</span>
          {payload.source_workflow.profile && <a href={payload.source_workflow.profile} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[#d4b87a]"><ExternalLink size={13} /> Source profile</a>}
          {payload.source_workflow.reviews && <a href={payload.source_workflow.reviews} target="_blank" rel="noreferrer" className="text-white/60 hover:text-white">Reviews</a>}
          {payload.source_workflow.wts && <a href={payload.source_workflow.wts} target="_blank" rel="noreferrer" className="text-white/60 hover:text-white">WTS route</a>}
          {payload.source_workflow.wtb && <a href={payload.source_workflow.wtb} target="_blank" rel="noreferrer" className="text-white/60 hover:text-white">WTB route</a>}
          {payload.source_workflow.request_feedback && <a href={payload.source_workflow.request_feedback} target="_blank" rel="noreferrer" className="text-white/60 hover:text-white">Request feedback</a>}
        </div>}

        <div className="mt-10 flex items-center justify-between border-b border-white/10 pb-4">
          <h2 className="text-xl font-semibold">Recent market activity</h2>
          <span className="text-xs text-white/35">{listings.length} route-exposed posts inspected</span>
        </div>
        <div className="divide-y divide-white/10">
          {listings.map(listing => (
            <article key={listing.id} className="grid gap-4 py-5 sm:grid-cols-[96px_1fr] md:grid-cols-[96px_1fr_auto]">
              <div className="h-24 w-24 overflow-hidden border border-white/10 bg-white/[0.03]">
                {listing.image_url ? <img src={listing.image_url} alt="" className="h-full w-full object-cover" loading="lazy" /> : <div className="grid h-full place-items-center text-[10px] text-white/30">No source image</div>}
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-[#c9a96e]">{listing.listing_type}</span>
                  <h3 className="font-semibold">{listing.title || [listing.brand, listing.reference, listing.dial_color].filter(Boolean).join(' · ') || 'Luxury listing'}</h3>
                </div>
                <div className="mt-2 flex flex-wrap gap-4 text-xs text-white/42">
                  <span>{listing.condition || 'Condition unspecified'}</span>
                  <span className="flex items-center gap-1"><CalendarDays size={13} /> {listing.listing_date ? listing.listing_date.split('T')[0] : 'Original date unknown'}</span>
                  {listing.box && <span>Box: {listing.box}</span>}
                  {listing.papers && <span>Papers: {listing.papers}</span>}
                </div>
                {payload.raw_message_access && listing.raw_message && <details className="mt-4 border-l border-[#c9a96e]/35 pl-4"><summary className="cursor-pointer text-xs text-white/50">Raw source message</summary><pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap text-xs leading-6 text-white/55">{listing.raw_message}</pre></details>}
              </div>
              <div className="md:text-right">
                <div className="text-lg font-semibold text-[#d4b87a]">{listing.price_usd ? `$${Number(listing.price_usd).toLocaleString()}` : listing.source_display_price === '$0.00' ? 'Price not supplied' : 'Price not stated'}</div>
                {listing.source_url && <a href={listing.source_url} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-2 text-xs text-white/55 hover:text-white"><ExternalLink size={14} /> Actual listing</a>}
                {listing.availability_url ? <a href={listing.availability_url} target="_blank" rel="noreferrer" className="mt-3 flex items-center gap-2 text-xs text-[#d4b87a] hover:text-white"><MessageCircle size={14} /> Check availability</a> : <Link to={`/trading?q=${encodeURIComponent(listing.title || [listing.brand, listing.reference].filter(Boolean).join(' '))}`} className="mt-3 flex items-center gap-2 text-xs text-white/55 hover:text-white"><MessageCircle size={14} /> Find on Trading Floor</Link>}
              </div>
            </article>
          ))}
        </div>
        {payload.reviews && payload.reviews.length > 0 && <section className="mt-12" id="dealer-feedback-div">
          <div className="flex items-center justify-between border-b border-white/10 pb-4">
            <h2 className="text-xl font-semibold">Dealer feedback</h2>
            <span className="text-xs text-white/35">{payload.reviews.length} source-rendered entries</span>
          </div>
          <div className="grid gap-px bg-white/10 sm:grid-cols-2">
            {payload.reviews.map((review, index) => <article key={`${review.reviewer}-${review.date}-${index}`} className="bg-[#111118] p-5">
              <div className="flex items-start justify-between gap-4">
                <div><h3 className="font-semibold">{review.reviewer}</h3><p className="mt-1 text-xs text-white/40">{review.date || 'Date unavailable'}</p></div>
                <span className="text-xs font-semibold text-emerald-300">{review.sentiment || 'Source feedback'}</span>
              </div>
              {review.whatsapp_url && <a href={review.whatsapp_url} target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center gap-2 text-xs text-[#d4b87a]"><MessageCircle size={13} /> Chat on WhatsApp</a>}
            </article>)}
          </div>
        </section>}
      </section>
      <Footer />
    </main>
  );
}

function ProfileMetric({ label, value }: { label: string; value: string }) {
  return <div className="bg-[#111118] px-4 py-5"><div className="font-mono text-lg text-white sm:text-xl">{value}</div><div className="mt-2 text-[10px] uppercase tracking-wider text-white/35">{label}</div></div>;
}
