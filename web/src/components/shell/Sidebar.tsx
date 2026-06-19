import { NavLink } from 'react-router-dom';
import type { ReactNode } from 'react';

interface NavItem {
  to: string;
  label: string;
  end: boolean;
  icon: ReactNode;
  hint: string;
}

// Hand-drawn 1.5px line icons keep the sidebar quiet and on-brand (no icon dep).
const icon = (path: ReactNode) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.6}
    strokeLinecap="round"
    strokeLinejoin="round"
    className="h-[18px] w-[18px]"
    aria-hidden
  >
    {path}
  </svg>
);

const NAV: { group: string; items: NavItem[] }[] = [
  {
    group: 'Workspace',
    items: [
      {
        to: '/how-it-works',
        label: 'How it works',
        end: true,
        hint: 'Start here',
        icon: icon(
          <>
            <circle cx="6" cy="6" r="2" />
            <circle cx="18" cy="18" r="2" />
            <path d="M8 6h6a2 2 0 0 1 2 2v8" />
          </>,
        ),
      },
      {
        to: '/campaigns',
        label: 'Campaigns',
        end: false,
        hint: 'Ads & materials',
        icon: icon(
          <>
            <rect x="3" y="3" width="7" height="7" rx="1.5" />
            <rect x="14" y="3" width="7" height="7" rx="1.5" />
            <rect x="3" y="14" width="7" height="7" rx="1.5" />
            <rect x="14" y="14" width="7" height="7" rx="1.5" />
          </>,
        ),
      },
      {
        to: '/history',
        label: 'Reviews',
        end: false,
        hint: 'Live + past boards',
        icon: icon(
          <>
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path d="M3 9h18M8 4v16" />
          </>,
        ),
      },
    ],
  },
  {
    group: 'Governance',
    items: [
      {
        to: '/rulebooks',
        label: 'Rulebooks',
        end: false,
        hint: 'Region rules',
        icon: icon(
          <>
            <path d="M4 5a2 2 0 0 1 2-2h12v18H6a2 2 0 0 1-2-2z" />
            <path d="M9 7h6M9 11h6" />
          </>,
        ),
      },
      {
        to: '/library',
        label: 'Library',
        end: false,
        hint: 'Saved campaigns',
        icon: icon(
          <>
            <path d="M4 6h7v14H4zM13 4h3v16h-3zM18 6l3 .5-2.4 13.5-3-.5z" />
          </>,
        ),
      },
    ],
  },
];

export function Sidebar() {
  return (
    <aside className="hidden w-[248px] shrink-0 flex-col border-r border-border bg-bg-soft/60 lg:flex">
      <BrandMark />

      <nav className="flex flex-1 flex-col gap-7 px-4 py-6">
        {NAV.map((section) => (
          <div key={section.group}>
            <p className="eyebrow mb-3 px-2">{section.group}</p>
            <div className="flex flex-col gap-1">
              {section.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    [
                      'group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-all duration-200',
                      isActive
                        ? 'bg-surface-2 text-fg shadow-[inset_0_1px_0_rgb(255_255_255/0.05)]'
                        : 'text-muted hover:bg-surface/70 hover:text-fg',
                    ].join(' ')
                  }
                >
                  {({ isActive }) => (
                    <>
                      <span
                        aria-hidden
                        className={[
                          'absolute left-0 top-1/2 h-5 w-[2px] -translate-y-1/2 rounded-full bg-accent transition-all duration-200',
                          isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-40',
                        ].join(' ')}
                      />
                      <span
                        className={
                          isActive ? 'text-accent' : 'text-faint transition-colors group-hover:text-muted'
                        }
                      >
                        {item.icon}
                      </span>
                      <span className="flex-1 font-medium">{item.label}</span>
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-border px-5 py-4">
        <div className="flex items-center gap-2 text-[11px] text-faint">
          <span className="h-1.5 w-1.5 animate-pulse-soft rounded-full bg-human" />
          <span className="font-mono">band.ai · agents online</span>
        </div>
      </div>
    </aside>
  );
}

function BrandMark() {
  return (
    <NavLink to="/" className="flex items-center gap-3 px-5 pb-5 pt-6">
      <span className="relative flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-accent-strong to-indigo-700 shadow-[inset_0_1px_0_rgb(255_255_255/0.25),0_8px_20px_-8px_rgb(99_102_241/0.7)]">
        <span className="font-display text-lg italic leading-none text-white">B</span>
      </span>
      <div className="leading-tight">
        <p className="font-display text-xl leading-none text-fg">Band Review Board</p>
        <p className="eyebrow mt-1">Compliance Console</p>
      </div>
    </NavLink>
  );
}
