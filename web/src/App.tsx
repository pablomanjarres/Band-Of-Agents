import { Route, Routes } from 'react-router-dom';
import { HistoryPage } from './pages/HistoryPage';
import { LibraryPage } from './pages/LibraryPage';
import { LiveBoardPage } from './pages/LiveBoardPage';
import { NewReviewPage } from './pages/NewReviewPage';
import { PlaceholderPage } from './pages/PlaceholderPage';
import { ReplayBoardPage } from './pages/ReplayBoardPage';
import { RulebooksPage } from './pages/RulebooksPage';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Sidebar } from './components/shell/Sidebar';
import { Topbar } from './components/shell/Topbar';

export default function App() {
  return (
    <div className="relative z-10 flex min-h-full">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 lg:px-8 lg:py-12">
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
    </div>
  );
}
