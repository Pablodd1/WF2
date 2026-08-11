import { useLanguage } from '@/i18n/LanguageContext';

export function MarketActivityTicker() {
  const { t } = useLanguage();

  return (
    <div className="overflow-hidden bg-[#211b15] py-2 text-[#d8b36b]" aria-label={t('Live market activity')}>
      <div className="mx-auto flex max-w-7xl justify-center gap-10 overflow-hidden whitespace-nowrap px-4 font-mono text-[10px] uppercase tracking-[0.08em] sm:justify-between">
        <span>Patek 5712/1A matched</span>
        <span className="hidden md:inline">AP Royal Oak — verified dealer</span>
        <span className="hidden lg:inline">Rolex 126610LN price confirmed</span>
        <span className="hidden xl:inline">WTB posted · Miami network</span>
      </div>
    </div>
  );
}
