import { ExternalLink, MessageCircle, Send } from 'lucide-react';
import { Link } from 'react-router-dom';
import { LUXFI_URL } from './MarketHeader';
import { useLanguage } from '@/i18n/LanguageContext';

export const CONTACT_WHATSAPP_URL = 'https://api.whatsapp.com/send?phone=17869569201&text=Hello,%20I%20would%20like%20more%20information%20about%20your%20services.';

export const COMMUNITY_GROUPS = [
  { name: 'WatchFacts | B2B Watch Trading Chat', network: 'WhatsApp', href: 'https://chat.whatsapp.com/JEaK91DatRkLZFKMaJZYIH?mode=gi_t' },
  { name: 'WatchFacts | Community discussion/announcements', network: 'WhatsApp', href: 'https://chat.whatsapp.com/CHLWqKgzO2Y1sdarNTAcEO?mode=gi_t' },
  { name: 'WatchFacts | System Calls', network: 'WhatsApp', href: 'https://chat.whatsapp.com/EfL3QcrCVe1F7wKMGjS9WQ' },
  { name: 'WatchFacts | International Group', network: 'WhatsApp', href: 'https://chat.whatsapp.com/B8qiBT6JZYyGoNg3CAX5Kw?mode=gi_t' },
  { name: 'WatchFacts | Signed Estate and Branded Jewelry', network: 'WhatsApp', href: 'https://chat.whatsapp.com/DPhtxCrrxES5kyHeO7SmCb?mode=gi_t' },
  { name: 'WatchFacts (Rolex US Only Sales)', network: 'Telegram', href: 'https://t.me/watchfactsUS' },
] as const;

const MARKET_LINKS = [
  ['Trading Floor', '/trading'],
  ['Price Research', '/price-research'],
  ['Dealer Directory', '/dealers'],
  ['Post an Item', '/dealer/post'],
  ['Workspace', '/dealer/workspace'],
  ['Account', '/dealer/account/profile'],
] as const;

export function Footer() {
  const { t } = useLanguage();
  return (
    <footer className="border-t border-white/10 bg-[#08080c] px-5 py-12 text-white sm:px-8 lg:px-12">
      <div className="mx-auto max-w-7xl">
        <div className="grid gap-10 border-b border-white/10 pb-10 lg:grid-cols-[0.8fr_1.2fr]">
          <section aria-labelledby="footer-contact-heading">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#c9a96e]">{t('Contact')}</p>
            <h2 id="footer-contact-heading" className="mt-3 font-serif text-3xl">{t('Contact WatchFacts')}</h2>
            <p className="mt-3 max-w-md text-sm leading-6 text-white/52">{t('Questions, partnerships, listing support, or new opportunities.')}</p>
            <a href={CONTACT_WHATSAPP_URL} target="_blank" rel="noreferrer" className="mt-6 inline-flex min-h-11 items-center gap-2 bg-[#25D366] px-5 text-sm font-bold text-[#07130a]">
              <MessageCircle size={17} /> {t('Contact us on WhatsApp')}
            </a>
            <form className="mt-7 grid gap-3" aria-label="Contact form" onSubmit={event => event.preventDefault()}>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-xs text-white/55">{t('Name')}<input name="name" className="mt-2 h-11 w-full border border-white/15 bg-[#111118] px-3 text-sm text-white" /></label>
                <label className="text-xs text-white/55">{t('Email')}<input name="email" type="email" className="mt-2 h-11 w-full border border-white/15 bg-[#111118] px-3 text-sm text-white" /></label>
              </div>
              <label className="text-xs text-white/55">{t('How can we help?')}<textarea name="message" rows={4} className="mt-2 w-full border border-white/15 bg-[#111118] px-3 py-3 text-sm text-white" /></label>
              <button type="button" disabled className="flex min-h-11 items-center justify-center gap-2 border border-white/15 px-5 text-sm font-semibold text-white/38">
                <Send size={15} /> {t('Email destination pending')}
              </button>
              <p className="text-[11px] leading-5 text-white/35">{t('The form will be activated after the receiving email or support system is confirmed.')}</p>
            </form>
          </section>

          <section aria-labelledby="footer-groups-heading">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#c9a96e]">{t('Community')}</p>
            <h2 id="footer-groups-heading" className="mt-3 font-serif text-3xl">{t('Join Our Chats')}</h2>
            <p className="mt-3 text-sm leading-6 text-white/52">{t('Be part of our vibrant community by joining our WhatsApp and Telegram groups.')}</p>
            <div className="mt-6 grid gap-2 sm:grid-cols-2">
              {COMMUNITY_GROUPS.map(group => (
                <a key={group.href} href={group.href} target="_blank" rel="noreferrer" className="group flex min-h-20 items-center justify-between gap-4 border border-white/12 bg-[#111118] px-4 py-3 transition-colors hover:border-[#c9a96e]/60">
                  <span><span className="block text-[9px] font-bold uppercase tracking-[0.16em] text-[#c9a96e]">{group.network}</span><span className="mt-1 block text-sm leading-5 text-white/78">{group.name}</span></span>
                  <ExternalLink size={14} className="shrink-0 text-white/32 group-hover:text-[#c9a96e]" />
                </a>
              ))}
            </div>
          </section>
        </div>

        <div className="grid gap-8 py-9 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_auto]">
          <div>
            <img src="/images/curated-luxury-logo-dark.png" alt="Curated Luxury" className="h-14 w-auto max-w-[230px] object-contain object-left" />
            <p className="mt-3 max-w-sm text-xs leading-5 text-white/38">{t('Curated Luxury marketplace with WatchFacts market intelligence.')}</p>
          </div>
          <nav aria-label="Marketplace links" className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm text-white/55">
            {MARKET_LINKS.map(([label, to]) => <Link key={to} to={to} className="transition-colors hover:text-white">{t(label)}</Link>)}
            <a href={LUXFI_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 transition-colors hover:text-white">{t('HIRE FI')} <ExternalLink size={12} /></a>
          </nav>
          <div className="flex flex-col items-start gap-3 text-sm">
            <Link to="/cl-login" className="text-[#c9a96e] transition-colors hover:text-white">CL Login</Link>
            <Link to="/info/company" className="text-white/50 transition-colors hover:text-white">{t('Company')}</Link>
            <Link to="/info/community" className="text-white/50 transition-colors hover:text-white">{t('Community')}</Link>
          </div>
        </div>
        <div className="border-t border-white/10 pt-5 text-center text-[11px] text-white/30">© 2026 WatchFacts Inc. All Rights Reserved.</div>
      </div>
    </footer>
  );
}
