import { CreditCard, FileText, HelpCircle, Settings, Store, UserRound } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Footer } from '@/components/Footer';

type Section = 'profile' | 'listings' | 'settings' | 'billing' | 'help';
interface WorkspacePayload {
  user: { email: string; role: string };
  dealer: null | { display_name: string | null; company_name: string | null; city: string | null; country_code: string | null; profile_summary: string | null; avatar_url: string | null; contact_consent: boolean; rating: number | null; review_count: number; whatsapp_group_count: number };
  profile_stamp: null | { name: string | null; company: string | null; phone: string | null; location: string | null; avatar_url: string | null; rating: number | null; review_count: number; group_count: number };
  preferences: { display_currency: string; email_notifications: boolean };
  stats: null | { active_listings: number; wts_posts: number; wtb_posts: number; posting_years: number };
  listings: Array<{ id: string; brand: string | null; reference: string | null; dial_color: string | null; listing_type: string; listing_date: string | null; price_usd: number | null }>;
  submissions: Array<{ id: string; intent: string; category: string; review_status: string; created_at: string; claimed_fields: Record<string, string> }>;
  tickets: Array<{ id: string; subject: string; status: string; created_at: string }>;
}

const tabs = [
  ['profile', 'Profile', UserRound], ['listings', 'My listings', Store], ['settings', 'Settings', Settings],
  ['billing', 'Billing', CreditCard], ['help', 'Help', HelpCircle],
] as const;

export default function DealerAccount() {
  const location = useLocation();
  const section = (location.pathname.split('/').at(-1) || 'profile') as Section;
  const [data, setData] = useState<WorkspacePayload | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const reload = () => fetch('/api/dealer-workspace', { credentials: 'include' })
    .then(async response => { const body = await response.json(); if (!response.ok) throw new Error(body.error || 'Unable to load workspace'); return body; })
    .then(setData).catch(caught => setError(caught.message));
  useEffect(() => { void reload(); }, []);

  async function update(sectionName: string, payload: Record<string, unknown>) {
    setError(''); setNotice('');
    const response = await fetch('/api/dealer-workspace', {
      method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ section: sectionName, ...payload }),
    });
    const result = await response.json();
    if (!response.ok) { setError(result.error || 'Unable to save changes.'); return false; }
    setNotice(sectionName === 'ticket' ? 'Support ticket submitted.' : 'Changes saved.');
    await reload();
    return true;
  }

  return (
    <main className="min-h-screen bg-[#08080c] text-white">
      <header className="border-b border-white/10 px-5 py-5 sm:px-8">
        <div className="mx-auto flex max-w-6xl items-center justify-between"><Link to="/dealer/workspace" className="font-serif text-xl">Curated Luxury</Link><span className="text-xs text-white/40">{data?.user.email || 'Dealer workspace'}</span></div>
      </header>
      <div className="mx-auto grid max-w-6xl gap-8 px-5 py-7 sm:px-8 lg:grid-cols-[210px_minmax(0,1fr)]">
        <nav aria-label="Account sections" className="flex gap-2 overflow-x-auto lg:flex-col">
          {tabs.map(([value, label, Icon]) => <Link key={value} to={`/dealer/account/${value}`} className={`flex h-11 shrink-0 items-center gap-2 border px-3 text-sm ${section === value ? 'border-[#c9a96e] bg-[#c9a96e] text-black' : 'border-white/12 text-white/60'}`}><Icon size={16} /> {label}</Link>)}
        </nav>
        <section className="min-w-0">
          {error && <p role="alert" className="mb-5 border-l-2 border-red-500 bg-red-500/10 px-3 py-2 text-xs text-red-200">{error}</p>}
          {notice && <p role="status" className="mb-5 border-l-2 border-emerald-400 bg-emerald-400/10 px-3 py-2 text-xs text-emerald-100">{notice}</p>}
          {!data ? <p className="text-sm text-white/40">Loading workspace...</p> : <AccountSection section={section} data={data} update={update} />}
        </section>
      </div>
      <Footer />
    </main>
  );
}

function AccountSection({ section, data, update }: { section: Section; data: WorkspacePayload; update: (section: string, payload: Record<string, unknown>) => Promise<boolean> }) {
  if (section === 'profile') return <Profile data={data} update={update} />;
  if (section === 'listings') return <Listings data={data} />;
  if (section === 'settings') return <Preferences data={data} update={update} />;
  if (section === 'billing') return <Billing />;
  return <Help data={data} update={update} />;
}

function Profile({ data, update }: { data: WorkspacePayload; update: AccountProps['update'] }) {
  const dealer = data.dealer;
  if (!dealer) return <Empty title="Profile awaiting linkage" copy="Your credential is active, but it is not yet linked to a verified dealer identity. WatchFacts must complete that match before profile edits or contact publication." />;
  return <form onSubmit={event => { event.preventDefault(); const values = Object.fromEntries(new FormData(event.currentTarget)); void update('profile', { ...values, contact_consent: values.contact_consent === 'on' }); }}>
    <Heading title="Account and posting profile" copy="Your saved identity, demographics, reputation, and preferences are reused when you post an item. Ratings and verified phone lineage cannot be edited here." />
    <div className="mb-7 grid gap-px bg-white/10 sm:grid-cols-2 lg:grid-cols-4">
      <ProfileFact label="Account email" value={data.user.email} />
      <ProfileFact label="Verified phone" value={data.profile_stamp?.phone} />
      <ProfileFact label="Posting location" value={data.profile_stamp?.location} />
      <ProfileFact label="Reputation" value={data.profile_stamp?.rating == null ? `${data.profile_stamp?.review_count || 0} reviews` : `${Number(data.profile_stamp.rating).toFixed(2)} · ${data.profile_stamp.review_count} reviews`} />
    </div>
    <div className="grid gap-4 sm:grid-cols-2"><Input name="display_name" label="Display name" defaultValue={dealer.display_name} /><Input name="company_name" label="Company" defaultValue={dealer.company_name} /><Input name="city" label="City" defaultValue={dealer.city} /><Input name="country_code" label="Country code" defaultValue={dealer.country_code} maxLength={3} /></div>
    <label className="mt-4 block text-xs text-white/60">Profile summary<textarea name="profile_summary" defaultValue={dealer.profile_summary || ''} maxLength={1000} rows={5} className="mt-2 w-full border border-white/15 bg-[#111118] p-3 text-sm" /></label>
    <label className="mt-4 flex items-start gap-3 text-sm text-white/60"><input name="contact_consent" type="checkbox" defaultChecked={dealer.contact_consent} className="mt-1" /> Allow verified contact details to appear on linked listings.</label>
    <button className="mt-6 h-11 bg-[#c9a96e] px-5 text-sm font-semibold text-black">Save profile</button>
  </form>;
}

type AccountProps = { update: (section: string, payload: Record<string, unknown>) => Promise<boolean> };
function Listings({ data }: { data: WorkspacePayload }) {
  return <><Heading title="My listings" copy="Verified historical activity and new moderated submissions remain separate until review is complete." />
    <div className="grid gap-px bg-white/10 sm:grid-cols-4"><Metric label="Active" value={data.stats?.active_listings || 0} /><Metric label="For sale" value={data.stats?.wts_posts || 0} /><Metric label="Looking for" value={data.stats?.wtb_posts || 0} /><Metric label="Years active" value={data.stats?.posting_years || 0} /></div>
    <div className="mt-8 flex items-center justify-between"><h2 className="text-lg font-semibold">Moderated submissions</h2><Link to="/dealer/post" className="text-xs font-semibold text-[#c9a96e]">Post new</Link></div>
    <div className="mt-3 divide-y divide-white/10 border-y border-white/10">{data.submissions.length ? data.submissions.map(item => <div key={item.id} className="flex items-center justify-between gap-4 py-4"><span className="text-sm">{item.intent} / {item.category}</span><span className="text-xs text-white/40">{item.review_status.replaceAll('_', ' ')}</span></div>) : <p className="py-5 text-sm text-white/40">No submissions yet.</p>}</div>
  </>;
}

function Preferences({ data, update }: { data: WorkspacePayload; update: AccountProps['update'] }) {
  return <form onSubmit={event => { event.preventDefault(); const values = Object.fromEntries(new FormData(event.currentTarget)); void update('preferences', { display_currency: values.display_currency, email_notifications: values.email_notifications === 'on' }); }}>
    <Heading title="Settings" copy="Choose display preferences. Historical normalized values and source currencies are never changed." />
    <label className="block max-w-sm text-xs text-white/60">Display currency<select name="display_currency" defaultValue={data.preferences.display_currency} className="mt-2 h-11 w-full border border-white/15 bg-[#111118] px-3 text-sm">{['USD','HKD','EUR','GBP','CHF','CNY','JPY','SGD'].map(value => <option key={value}>{value}</option>)}</select></label>
    <label className="mt-5 flex gap-3 text-sm text-white/60"><input name="email_notifications" type="checkbox" defaultChecked={data.preferences.email_notifications} /> Email account and review updates.</label>
    <button className="mt-6 h-11 bg-[#c9a96e] px-5 text-sm font-semibold text-black">Save settings</button>
  </form>;
}

function Billing() { return <><Heading title="Billing" copy="Commercial plans and payment processing are not enabled during beta." /><Empty title="No billing action required" copy="This page will remain inactive until pricing, entitlements, refund rules, and the payment provider are approved." /></>; }

function Help({ data, update }: { data: WorkspacePayload; update: AccountProps['update'] }) {
  return <><Heading title="Help and support" copy="Submit a private support ticket. Do not include passwords, API keys, or payment-card data." />
    <form onSubmit={async event => { event.preventDefault(); const form = event.currentTarget; const values = Object.fromEntries(new FormData(form)); if (await update('ticket', values)) form.reset(); }} className="space-y-4"><Input name="subject" label="Subject" required /><label className="block text-xs text-white/60">Details<textarea name="message" required minLength={10} maxLength={5000} rows={6} className="mt-2 w-full border border-white/15 bg-[#111118] p-3 text-sm" /></label><button className="flex h-11 items-center gap-2 bg-[#c9a96e] px-5 text-sm font-semibold text-black"><FileText size={16} /> Submit ticket</button></form>
    <h2 className="mt-9 text-lg font-semibold">Recent tickets</h2><div className="mt-3 divide-y divide-white/10 border-y border-white/10">{data.tickets.length ? data.tickets.map(ticket => <div key={ticket.id} className="flex items-center justify-between py-4"><span className="text-sm">{ticket.subject}</span><span className="text-xs text-white/40">{ticket.status.replaceAll('_', ' ')}</span></div>) : <p className="py-5 text-sm text-white/40">No support tickets.</p>}</div>
  </>;
}

function Heading({ title, copy }: { title: string; copy: string }) { return <div className="mb-7 border-b border-white/10 pb-5"><h1 className="font-serif text-3xl sm:text-4xl">{title}</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-white/50">{copy}</p></div>; }
function Input({ name, label, defaultValue, required = false, maxLength = 200 }: { name: string; label: string; defaultValue?: string | null; required?: boolean; maxLength?: number }) { return <label className="block text-xs text-white/60">{label}<input name={name} defaultValue={defaultValue || ''} required={required} maxLength={maxLength} className="mt-2 h-11 w-full border border-white/15 bg-[#111118] px-3 text-sm" /></label>; }
function Metric({ label, value }: { label: string; value: number }) { return <div className="bg-[#111118] p-4"><strong className="font-mono text-2xl">{Number(value).toLocaleString()}</strong><p className="mt-1 text-[10px] uppercase tracking-wider text-white/35">{label}</p></div>; }
function ProfileFact({ label, value }: { label: string; value?: string | null }) { return <div className="bg-[#111118] p-4"><div className="break-words text-sm text-white">{value || 'Not provided'}</div><p className="mt-2 text-[10px] uppercase tracking-wider text-white/35">{label}</p></div>; }
function Empty({ title, copy }: { title: string; copy: string }) { return <div className="border-l-2 border-[#c9a96e] bg-[#111118] px-5 py-4"><h2 className="font-semibold">{title}</h2><p className="mt-2 text-sm leading-6 text-white/50">{copy}</p></div>; }
