import { NavLink, Route, Routes } from 'react-router-dom';
import { HistoryPage } from './pages/HistoryPage';
import { LibraryPage } from './pages/LibraryPage';
import { LiveBoardPage } from './pages/LiveBoardPage';
import { NewReviewPage } from './pages/NewReviewPage';
import { PlaceholderPage } from './pages/PlaceholderPage';
import { ReplayBoardPage } from './pages/ReplayBoardPage';
import { RulebooksPage } from './pages/RulebooksPage';
import { ErrorBoundary } from './components/ErrorBoundary';

const NAV_ITEMS = [
  { to: '/', label: 'New Review', end: true },
  { to: '/history', label: 'History', end: false },
  { to: '/rulebooks', label: 'Rulebooks', end: false },
  { to: '/library', label: 'Library', end: false },
];

function Nav() {
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-sm font-bold text-white">
            L
          </span>
          <span className="text-sm font-semibold text-slate-800">Lumavida Review Console</span>
        </div>
        <nav className="flex items-center gap-1">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                  isActive
                    ? 'bg-indigo-50 text-indigo-700'
                    : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </div>
    </header>
  );
}

export default function App() {
  return (
    <div className="min-h-full">
      <Nav />
      <main className="mx-auto max-w-5xl px-6 py-8">
        <ErrorBoundary>
        <Routes>
          <Route path="/" element={<NewReviewPage />} />
          <Route path="/reviews/:id" element={<LiveBoardPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/history/:id" element={<ReplayBoardPage />} />
          <Route path="/rulebooks" element={<RulebooksPage />} />
          <Route path="/library" element={<LibraryPage />} />
          <Route
            path="*"
            element={
              <PlaceholderPage title="Not found" description="That page does not exist." />
            }
          />
        </Routes>
        </ErrorBoundary>
      </main>
    </div>
  );
}
