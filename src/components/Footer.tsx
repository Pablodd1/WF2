import { Link } from 'react-router-dom';

export function Footer() {
  return (
    <footer className="h-10 bg-bg-card border-t border-border-default flex items-center justify-between px-5 text-[11px] text-muted">
      <span>CURATED LUXURY OPERATIONS</span>
      <div className="flex items-center gap-4">
        <span>Source-aware market workflow</span>
        <Link to="/cl-login" className="uppercase tracking-[0.12em] text-muted transition-colors hover:text-gold-primary">
          CL Login
        </Link>
      </div>
    </footer>
  );
}
