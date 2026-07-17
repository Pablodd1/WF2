import { Link, useLocation } from 'react-router-dom';

const LINKS = [
  { to: '/', label: 'Home' },
  { to: '/trading', label: 'Trading Floor' },
  { to: '/price-research', label: 'Price Research' },
  { to: '/dealer-login', label: 'Dealer Login' },
];

export function MarketNav() {
  const location = useLocation();

  return (
    <nav className="border-b border-white/10 bg-[#09090d] text-white" aria-label="Marketplace navigation">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-5 px-4 py-3">
        <Link to="/" className="flex min-w-0 items-center gap-3 text-white">
          <span className="grid h-9 w-9 shrink-0 place-items-center border border-[#c9a96e]/60 font-serif text-sm text-[#d4b87a]">CL</span>
          <span className="hidden truncate font-serif text-lg sm:block">Curated Luxury</span>
        </Link>
        <div className="flex max-w-full items-center gap-4 overflow-x-auto text-sm sm:gap-6">
          {LINKS.map(link => {
            const active = link.to === '/' ? location.pathname === '/' : location.pathname.startsWith(link.to);
            return (
              <Link
                key={link.to}
                to={link.to}
                aria-current={active ? 'page' : undefined}
                className="shrink-0 border-b-2 py-2 transition-colors"
                style={{ borderColor: active ? '#c9a96e' : 'transparent', color: active ? '#d4b87a' : '#a8a8b3' }}
              >
                {link.label}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
