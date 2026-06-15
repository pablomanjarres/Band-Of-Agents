import { NavLink } from 'react-router-dom';

const MOBILE_NAV = [
  { to: '/', label: 'Compose', end: true },
  { to: '/history', label: 'Reviews', end: false },
  { to: '/rulebooks', label: 'Rulebooks', end: false },
  { to: '/library', label: 'Library', end: false },
];

export function Topbar() {
  return (
    <header className="glass sticky top-0 z-30 flex flex-col">
      <div className="flex h-14 items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        {/* Mobile brand (sidebar is hidden < lg). */}
        <div className="flex items-center gap-2.5 lg:hidden">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-accent-strong to-indigo-700">
            <span className="font-display text-base italic leading-none text-white">L</span>
          </span>
          <span className="font-display text-lg text-fg">Lumavida</span>
        </div>

        {/* Desktop eyebrow: orients the operator without competing with the page H1. */}
        <p className="eyebrow hidden lg:block">Marketing compliance · multi-agent review</p>

        <div className="flex items-center gap-2">
          <span className="hidden items-center gap-1.5 rounded-full border border-border bg-surface/60 px-2.5 py-1 text-[11px] text-muted sm:inline-flex">
            <span className="h-1.5 w-1.5 rounded-full bg-human" />
            band.ai connected
          </span>
        </div>
      </div>

      {/* Horizontal nav, mobile only. */}
      <nav className="flex items-center gap-1 overflow-x-auto border-t border-border px-3 py-2 lg:hidden">
        {MOBILE_NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              [
                'whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                isActive ? 'bg-surface-2 text-fg' : 'text-muted hover:text-fg',
              ].join(' ')
            }
          >
            {item.label}
          </NavLink>
        ))}
      </nav>
    </header>
  );
}
