import { Languages } from 'lucide-react';
import { APP_LANGUAGES, useLanguage } from '@/i18n/LanguageContext';

export function LanguageToggle({ compact = false }: { compact?: boolean }) {
  const { language, setLanguage, t } = useLanguage();
  return (
    <label className="flex h-11 shrink-0 items-center gap-2 border border-white/15 bg-white/[0.03] px-3 text-[10px] font-semibold text-white/78">
      <Languages size={14} aria-hidden="true" className="text-[#d4b87a]" />
      {!compact && <span className="sr-only sm:not-sr-only">{t('Language')}</span>}
      <select
        aria-label={t('Language')}
        value={language}
        onChange={event => setLanguage(event.target.value as typeof language)}
        className="min-w-0 bg-transparent text-[11px] font-semibold text-white outline-none"
      >
        {APP_LANGUAGES.map(option => <option key={option.code} value={option.code} className="bg-[#111118] text-white">{compact ? option.shortLabel : option.label}</option>)}
      </select>
    </label>
  );
}
