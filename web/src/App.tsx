import { Navigate, Route, Routes } from 'react-router-dom';
import { CampaignDetailPage } from './pages/CampaignDetailPage';
import { CampaignsPage } from './pages/CampaignsPage';
import { HistoryPage } from './pages/HistoryPage';
import { LibraryPage } from './pages/LibraryPage';
import { LiveBoardPage } from './pages/LiveBoardPage';
import { PlaceholderPage } from './pages/PlaceholderPage';
import { ReplayBoardPage } from './pages/ReplayBoardPage';
import { RulebooksPage } from './pages/RulebooksPage';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Sidebar } from './components/shell/Sidebar';
import { Topbar } from './components/shell/Topbar';

// Campaign-first navigation. The old single-asset "Compose" flow is gone: a review
// is always a campaign (a product with its advertisements and their materials), so
// the home route lands on Campaigns.
export default function App() {
  return (
    <div className="relative z-10 flex min-h-full">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main className="mx-auto w-full max-w-[100rem] flex-1 px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
          <ErrorBoundary>
            <Routes>
              <Route path="/" element={<Navigate to="/campaigns" replace />} />
              <Route path="/campaigns" element={<CampaignsPage />} />
              <Route path="/campaigns/:id" element={<CampaignDetailPage />} />
              <Route path="/reviews/:id" element={<LiveBoardPage />} />
              <Route path="/history" element={<HistoryPage />} />
              <Route path="/history/:id" element={<ReplayBoardPage />} />
              <Route path="/rulebooks" element={<RulebooksPage />} />
              <Route path="/library" element={<LibraryPage />} />
              <Route
                path="*"
                element={<PlaceholderPage title="Not found" description="That page does not exist." />}
              />
            </Routes>
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}
