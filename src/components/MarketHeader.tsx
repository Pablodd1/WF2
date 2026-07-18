import { ExternalLink } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';

const LUXFI_URL = 'https://luxfi.ai/#add-fi';

const HEADER_LINKS = [
  { label: 'HIRE FI', href: LUXFI_URL, external: true },
  { label: 'DISCOVER', to: '/trading' },
  { label: 'PRICE RESEARCH', to: '/price-research' },
];

type MarketHeaderProps = {
  compact?: boolean;
  className?: string;
  showLogo?: boolean;
};

export function MarketHeader({ compact = false, className = '', showLogo = true }: MarketHeaderProps) {
  const location = useLocation();

  return (
    <header className={`relative z-40 border-b border-white/10 bg-[#070708]/95 text-white backdrop-blur-md ${className}`}>
      <div className={`mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 ${compact ? 'py-2.5' : 'py-3.5'} sm:px-6 lg:px-8`}>
        {showLogo ? (
          <Link to="/" aria-label="Curated Luxury home" className="flex min-w-0 items-center gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center border border-[#c9a96e]/65 font-serif text-sm text-[#d4b87a] shadow-[0_0_24px_rgba(201,169,110,.18)] sm:h-11 sm:w-11">CL</span>
            <span className="hidden truncate font-serif text-lg text-white sm:block">Curated Luxury</span>
          </Link>
        ) : (
          <span className="sr-only">Curated Luxury</span>
        )}

        <nav className="flex min-w-0 flex-1 items-center justify-end gap-1 overflow-x-auto" aria-label="Primary navigation">
          {HEADER_LINKS.map(link => {
            const active = link.to ? location.pathname.startsWith(link.to) : false;
            const className = [
              'flex h-10 shrink-0 items-center justify-center gap-1.5 border px-3 text-[11px] font-semibold transition-colors sm:px-4',
              active
                ? 'border-[#d4b87a] bg-[#d4b87a] text-black'
                : 'border-white/15 bg-white/[0.03] text-white/78 hover:border-[#d4b87a]/70 hover:text-white',
            ].join(' ');

            if (link.external) {
              return (
                <a key={link.label} href={link.href} target="_blank" rel="noreferrer" className={className}>
                  {link.label}
                  <ExternalLink size={12} aria-hidden="true" />
                </a>
              );
            }

            return (
              <Link key={link.label} to={link.to || '/'} aria-current={active ? 'page' : undefined} className={className}>
                {link.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}

export { LUXFI_URL };
