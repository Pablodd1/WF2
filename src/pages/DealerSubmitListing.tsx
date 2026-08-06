import { ArrowLeft, Camera, CheckCircle2, ExternalLink, ImagePlus, Plus, Send, ShieldCheck, Trash2, UserRound } from 'lucide-react';
import type { ChangeEvent, ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

const CATEGORIES = [
  ['WATCH', 'Watch'], ['HANDBAG', 'Handbag'], ['JEWELRY', 'Jewelry'],
  ['ACCESSORY', 'Other accessory'], ['OTHER', 'Other luxury item'],
] as const;
const CURRENCIES = ['USD', 'HKD', 'EUR', 'GBP', 'CHF', 'CNY', 'JPY', 'SGD', 'USDT'];
const LUXURY_APP_URL = 'https://luxuryapp-wf.vercel.app/';
const MAX_ITEMS = 20;
const MAX_ITEM_PHOTOS = 5;

type Intent = 'WTS' | 'WTB';
type Mode = 'single' | 'bulk';

interface Submission {
  id: string;
  intent: Intent;
  category: string;
  claimed_fields: { brand?: string; model?: string; reference?: string; title?: string };
  review_status: string;
  publication_status?: string;
  created_at: string;
}

interface CredentialedPoster {
  dealer_id: string;
  email: string | null;
  name: string | null;
  company: string | null;
  phone: string | null;
  location: string | null;
  avatar_url: string | null;
  credential_status: string;
  rating: number | null;
  review_count: number;
  group_count: number;
}

interface DraftItem {
  key: string;
  intent: Intent;
  category: string;
  brand: string;
  model: string;
  reference: string;
  dial_color: string;
  condition: string;
  title: string;
  price_amount: string;
  currency: string;
  raw_message: string;
  photos: File[];
}

function createDraft(): DraftItem {
  return {
    key: crypto.randomUUID(), intent: 'WTS', category: 'WATCH', brand: '', model: '',
    reference: '', dial_color: '', condition: '', title: '', price_amount: '',
    currency: 'USD', raw_message: '', photos: [],
  };
}

async function uploadImage(file: File, kind: 'listing' | 'poster') {
  const response = await fetch('/api/dealer-media', {
    method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content_type: file.type, byte_size: file.size, kind }),
  });
  const prepared = await response.json();
  if (!response.ok) throw new Error(prepared.error || 'Unable to prepare image upload.');
  const upload = await fetch(prepared.signedUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
  if (!upload.ok) throw new Error('Unable to upload an image. Please try again.');
  return prepared.publicUrl as string;
}

export default function DealerSubmitListing() {
  const [postingMode, setPostingMode] = useState<'watchfacts' | 'luxury-app'>('watchfacts');
  const [mode, setMode] = useState<Mode>('single');
  const [items, setItems] = useState<DraftItem[]>([createDraft()]);
  const [poster, setPoster] = useState<CredentialedPoster | null>(null);
  const [credentialError, setCredentialError] = useState('');
  const [posterPhoto, setPosterPhoto] = useState<File | null>(null);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const totalPhotos = useMemo(() => items.reduce((sum, item) => sum + item.photos.length, 0), [items]);

  useEffect(() => {
    fetch('/api/dealer-submissions', { credentials: 'include' })
      .then(response => response.ok ? response.json() : Promise.reject(new Error('Unable to load submissions')))
      .then(payload => {
        setSubmissions(payload.submissions || []);
        setPoster(payload.poster || null);
        setCredentialError(payload.credential_error || '');
      })
      .catch(() => undefined);
  }, []);

  function updateItem(key: string, patch: Partial<DraftItem>) {
    setItems(current => current.map(item => item.key === key ? { ...item, ...patch } : item));
  }

  function changeMode(nextMode: Mode) {
    setMode(nextMode);
    if (nextMode === 'single') setItems(current => [current[0] || createDraft()]);
    if (nextMode === 'bulk' && items.length === 1) setItems(current => [...current, createDraft()]);
  }

  function choosePhotos(key: string, event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files || [])].slice(0, MAX_ITEM_PHOTOS);
    updateItem(key, { photos: files });
    event.target.value = '';
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true); setError(''); setMessage('');
    try {
      const posterImageUrl = posterPhoto ? await uploadImage(posterPhoto, 'poster') : null;
      const normalizedItems = [];
      for (const item of items) {
        const imageUrls = await Promise.all(item.photos.map(photo => uploadImage(photo, 'listing')));
        normalizedItems.push({
          intent: item.intent, category: item.category, brand: item.brand, model: item.model,
          reference: item.reference, dial_color: item.dial_color, condition: item.condition,
          title: item.title, price_amount: item.price_amount, currency: item.currency,
          raw_message: item.raw_message, image_urls: imageUrls,
        });
      }
      const response = await fetch('/api/dealer-submissions', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ poster_image_url: posterImageUrl, items: normalizedItems }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to publish listing.');
      const count = Number(result.count || normalizedItems.length);
      setMessage(`${count} ${count === 1 ? 'item is' : 'items are'} normalized and published to the Trading Floor.`);
      setItems(mode === 'bulk' ? [createDraft(), createDraft()] : [createDraft()]);
      setPosterPhoto(null);
      setSubmissions(current => [...(result.submissions || []), ...current]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to publish listing.');
    } finally { setSaving(false); }
  }

  return (
    <main className="min-h-screen bg-[#08080c] px-5 py-7 text-white sm:px-8 lg:px-12">
      <div className="mx-auto max-w-7xl">
        <header className="flex items-center justify-between border-b border-white/10 pb-5">
          <Link to="/dealer/workspace" className="flex items-center gap-2 text-sm text-white/60 hover:text-white"><ArrowLeft size={16} /> Workspace</Link>
          <span className="flex items-center gap-2 text-xs text-[#c9a96e]"><ShieldCheck size={15} /> Authenticated posting</span>
        </header>

        <nav aria-label="Posting applications" className="mt-7 grid grid-cols-2 gap-2 border-b border-white/10 pb-4 sm:flex">
          <Choice active={postingMode === 'watchfacts'} onClick={() => setPostingMode('watchfacts')}>WatchFacts form</Choice>
          <Choice active={postingMode === 'luxury-app'} onClick={() => setPostingMode('luxury-app')}>Luxury App</Choice>
        </nav>

        {postingMode === 'watchfacts' ? (
          <section className="grid gap-10 py-9 xl:grid-cols-[minmax(0,1fr)_320px]">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#c9a96e]">Direct normalized posting</p>
              <h1 className="mt-3 font-serif text-4xl sm:text-5xl">Photograph it. Describe it. Post it.</h1>
              <p className="mt-4 max-w-3xl text-sm leading-7 text-white/55">Required identity and source fields keep each item organized. Price remains optional; when omitted, the Trading Floor displays “Price not supplied.”</p>

              <div className="mt-7 grid grid-cols-2 gap-2 sm:max-w-md">
                <Choice active={mode === 'single'} onClick={() => changeMode('single')}>Single item</Choice>
                <Choice active={mode === 'bulk'} onClick={() => changeMode('bulk')}>Bulk posting</Choice>
              </div>

              <form onSubmit={submit} className="mt-7 space-y-6">
                <section className="border border-white/12 bg-white/[0.025] p-4 sm:p-5">
                  <div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2 text-sm font-semibold"><UserRound size={17} className="text-[#c9a96e]" /> Credentialed posting user</div>{poster && <span className="border border-emerald-400/30 bg-emerald-400/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-200"><ShieldCheck size={12} className="mr-1 inline" /> {poster.credential_status}</span>}</div>
                  {poster ? (
                    <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-center">
                      {posterPhoto ? <FilePreview file={posterPhoto} alt="Updated credentialed profile" className="h-20 w-20 rounded-full border border-[#c9a96e]/50 object-cover" /> : poster.avatar_url ? <img src={poster.avatar_url} alt="Credentialed profile" className="h-20 w-20 rounded-full border border-[#c9a96e]/50 object-cover" /> : <div className="flex h-20 w-20 items-center justify-center rounded-full border border-white/15 bg-white/5"><UserRound size={28} className="text-white/35" /></div>}
                      <div className="min-w-0 flex-1">
                        <p className="text-lg font-semibold">{poster.name}</p>
                        {poster.company && poster.company !== poster.name && <p className="mt-1 text-xs text-white/45">{poster.company}</p>}
                        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-white/60"><span>{poster.phone}</span><span>{poster.location}</span><span>Rating {poster.rating == null ? '—' : poster.rating.toFixed(1)}</span><span>{poster.review_count} reviews</span><span>{poster.group_count} groups</span></div>
                        <p className="mt-2 text-[11px] text-white/35">Stamped from the signed-in credential · identity fields cannot be edited here.</p>
                      </div>
                    </div>
                  ) : <p className="mt-4 border-l-2 border-amber-400 bg-amber-400/10 px-3 py-2 text-xs text-amber-100">{credentialError || 'Loading credentialed dealer profile...'}</p>}
                  {poster && credentialError && <p className="mt-4 border-l-2 border-amber-400 bg-amber-400/10 px-3 py-2 text-xs text-amber-100">{credentialError}</p>}
                  <PhotoPicker
                    label={poster?.avatar_url ? 'Update credentialed profile photo' : 'Add credentialed profile photo'}
                    hint="Optional. This becomes the posting-user photo attached to the credential."
                    capture="user"
                    files={posterPhoto ? [posterPhoto] : []}
                    onChange={files => setPosterPhoto(files[0] || null)}
                    onRemove={() => setPosterPhoto(null)}
                  />
                </section>

                {items.map((item, index) => (
                  <ItemEditor
                    key={item.key}
                    item={item}
                    number={index + 1}
                    canRemove={mode === 'bulk' && items.length > 2}
                    onChange={patch => updateItem(item.key, patch)}
                    onPhotos={event => choosePhotos(item.key, event)}
                    onRemove={() => setItems(current => current.filter(candidate => candidate.key !== item.key))}
                  />
                ))}

                {mode === 'bulk' && (
                  <button type="button" disabled={items.length >= MAX_ITEMS} onClick={() => setItems(current => [...current, createDraft()])} className="flex h-11 w-full items-center justify-center gap-2 border border-dashed border-white/25 text-sm text-white/70 hover:border-[#c9a96e] hover:text-white disabled:opacity-40">
                    <Plus size={16} /> Add another item ({items.length}/{MAX_ITEMS})
                  </button>
                )}

                {error && <p role="alert" className="border-l-2 border-red-500 bg-red-500/10 px-3 py-2 text-xs text-red-200">{error}</p>}
                {message && <p role="status" className="flex items-center gap-2 border-l-2 border-emerald-400 bg-emerald-400/10 px-3 py-2 text-xs text-emerald-100"><CheckCircle2 size={15} /> {message}</p>}
                <button disabled={saving || !poster || Boolean(credentialError)} className="flex h-12 w-full items-center justify-center gap-2 bg-[#c9a96e] text-sm font-semibold text-[#09090d] disabled:opacity-60"><Send size={16} /> {saving ? `Uploading ${totalPhotos + Number(Boolean(posterPhoto))} photos and publishing...` : `Normalize and publish ${items.length === 1 ? 'item' : `${items.length} items`}`}</button>
              </form>
            </div>

            <aside>
              <h2 className="text-lg font-semibold">Your recent posts</h2>
              <p className="mt-2 text-xs leading-5 text-white/40">Published items remain available for later human quality review.</p>
              <div className="mt-4 divide-y divide-white/10 border-y border-white/10">
                {submissions.length === 0 && <p className="py-5 text-sm text-white/40">No posts yet.</p>}
                {submissions.map(item => (
                  <div key={item.id} className="py-4">
                    <div className="flex items-center justify-between gap-3 text-xs"><span className="font-semibold text-[#c9a96e]">{item.intent} / {item.category}</span><span className="text-emerald-300/70">{(item.publication_status || 'published').replaceAll('_', ' ')}</span></div>
                    <p className="mt-2 text-sm text-white/70">{[item.claimed_fields?.brand, item.claimed_fields?.model, item.claimed_fields?.reference, item.claimed_fields?.title].filter(Boolean).join(' ') || 'Post received'}</p>
                    <p className="mt-1 text-[11px] text-white/30">{new Date(item.created_at).toLocaleDateString()}</p>
                  </div>
                ))}
              </div>
            </aside>
          </section>
        ) : (
          <section className="py-9">
            <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#c9a96e]">Luxury App</p><h1 className="mt-3 font-serif text-4xl sm:text-5xl">Post an item.</h1><p className="mt-3 max-w-2xl text-sm leading-7 text-white/55">Use the connected Luxury App without leaving WatchFacts.</p></div>
              <a href={LUXURY_APP_URL} target="_blank" rel="noreferrer" className="inline-flex h-11 shrink-0 items-center justify-center gap-2 border border-white/20 px-4 text-xs font-semibold text-white/75 hover:border-[#c9a96e] hover:text-white">Open full page <ExternalLink size={14} /></a>
            </div>
            <iframe src={LUXURY_APP_URL} title="Luxury App posting experience" className="min-h-[820px] w-full border border-white/12 bg-white" allow="camera; microphone; clipboard-write" />
          </section>
        )}
      </div>
    </main>
  );
}

function ItemEditor({ item, number, canRemove, onChange, onPhotos, onRemove }: { item: DraftItem; number: number; canRemove: boolean; onChange: (patch: Partial<DraftItem>) => void; onPhotos: (event: ChangeEvent<HTMLInputElement>) => void; onRemove: () => void }) {
  const isWatch = item.category === 'WATCH';
  return (
    <section className="border border-white/12 bg-white/[0.025] p-4 sm:p-5">
      <div className="flex items-center justify-between"><h2 className="text-sm font-semibold">Item {number}</h2>{canRemove && <button type="button" onClick={onRemove} aria-label={`Remove item ${number}`} className="text-white/40 hover:text-red-300"><Trash2 size={17} /></button>}</div>
      <fieldset className="mt-4"><legend className="mb-2 text-xs text-white/45">Listing type</legend><div className="grid grid-cols-2 gap-2"><Choice active={item.intent === 'WTS'} onClick={() => onChange({ intent: 'WTS' })}>For sale</Choice><Choice active={item.intent === 'WTB'} onClick={() => onChange({ intent: 'WTB' })}>Want to buy</Choice></div></fieldset>
      <label className="mt-4 block text-xs text-white/60">Category<select value={item.category} onChange={event => onChange({ category: event.target.value })} className="mt-2 h-11 w-full border border-white/15 bg-[#111118] px-3 text-sm text-white">{CATEGORIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {isWatch ? <><Field value={item.brand} onChange={brand => onChange({ brand })} label="Brand" required /><Field value={item.model} onChange={model => onChange({ model })} label="Model" required /><Field value={item.reference} onChange={reference => onChange({ reference })} label="Reference" required /><Field value={item.dial_color} onChange={dial_color => onChange({ dial_color })} label="Dial color" required /></> : <Field value={item.title} onChange={title => onChange({ title })} label="Item title" required />}
        <Field value={item.condition} onChange={condition => onChange({ condition })} label="Condition" />
      </div>
      {item.intent === 'WTS' && <div className="mt-4 grid gap-4 sm:grid-cols-[1fr_150px]"><Field value={item.price_amount} onChange={price_amount => onChange({ price_amount })} label="Asking price (optional)" type="number" /><label className="block text-xs text-white/60">Currency<select value={item.currency} onChange={event => onChange({ currency: event.target.value })} className="mt-2 h-11 w-full border border-white/15 bg-[#111118] px-3 text-sm text-white">{CURRENCIES.map(currency => <option key={currency}>{currency}</option>)}</select></label></div>}
      <label className="mt-4 block text-xs text-white/60">Original listing or request message<textarea value={item.raw_message} onChange={event => onChange({ raw_message: event.target.value })} required minLength={3} maxLength={10000} rows={5} className="mt-2 w-full resize-y border border-white/15 bg-[#111118] px-3 py-3 text-sm leading-6 text-white outline-none focus:border-[#c9a96e]" /></label>
      <div className="mt-4">
        <label className="flex min-h-28 cursor-pointer flex-col items-center justify-center border border-dashed border-white/25 bg-black/20 px-4 text-center hover:border-[#c9a96e]"><Camera size={22} className="text-[#c9a96e]" /><span className="mt-2 text-sm font-semibold">Take or choose item photos</span><span className="mt-1 text-xs text-white/40">1–{MAX_ITEM_PHOTOS} photos · first photo is the Trading Floor cover</span><input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" capture="environment" multiple required={!item.photos.length} onChange={onPhotos} /></label>
        {!!item.photos.length && <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5">{item.photos.map((file, index) => <div key={`${file.name}-${index}`} className="relative aspect-square overflow-hidden border border-white/10"><FilePreview file={file} alt={`Item ${number} photo ${index + 1}`} className="h-full w-full object-cover" />{index === 0 && <span className="absolute bottom-1 left-1 bg-black/75 px-1.5 py-0.5 text-[9px] uppercase">Cover</span>}</div>)}</div>}
      </div>
    </section>
  );
}

function PhotoPicker({ label, hint, capture, files, onChange, onRemove }: { label: string; hint: string; capture: 'user' | 'environment'; files: File[]; onChange: (files: File[]) => void; onRemove: () => void }) {
  return <div className="mt-4"><label className="flex cursor-pointer items-center gap-3 border border-dashed border-white/20 px-4 py-3 hover:border-[#c9a96e]"><ImagePlus size={20} className="text-[#c9a96e]" /><span><span className="block text-sm font-semibold">{label}</span><span className="text-xs text-white/40">{hint}</span></span><input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" capture={capture} onChange={event => onChange([...(event.target.files || [])].slice(0, 1))} /></label>{files[0] && <div className="mt-3 flex items-center gap-3"><FilePreview file={files[0]} alt="Posting user preview" className="h-16 w-16 rounded-full object-cover" /><div className="min-w-0 flex-1"><p className="truncate text-xs text-white/70">{files[0].name}</p><button type="button" onClick={onRemove} className="mt-1 text-xs text-red-300">Remove photo</button></div></div>}</div>;
}

function FilePreview({ file, alt, className }: { file: File; alt: string; className: string }) {
  const url = useMemo(() => URL.createObjectURL(file), [file]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return <img src={url} alt={alt} className={className} />;
}

function Choice({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" onClick={onClick} aria-pressed={active} className={`h-11 border px-3 text-sm font-semibold ${active ? 'border-[#c9a96e] bg-[#c9a96e] text-[#09090d]' : 'border-white/15 bg-[#111118] text-white/65'}`}>{children}</button>;
}

function Field({ value, onChange, label, required = false, type = 'text' }: { value: string; onChange: (value: string) => void; label: string; required?: boolean; type?: string }) {
  return <label className="block text-xs text-white/60">{label}<input value={value} onChange={event => onChange(event.target.value)} type={type} required={required} min={type === 'number' ? '0.01' : undefined} step={type === 'number' ? 'any' : undefined} className="mt-2 h-11 w-full border border-white/15 bg-[#111118] px-3 text-sm text-white outline-none focus:border-[#c9a96e]" /></label>;
}
