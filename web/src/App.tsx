import { Outlet, Route, Routes } from 'react-router-dom';
import { ArtifactViewerPage } from './pages/ArtifactViewerPage';
import { CampaignDetailPage } from './pages/CampaignDetailPage';
import { CampaignsPage } from './pages/CampaignsPage';
import { HistoryPage } from './pages/HistoryPage';
import { HowItWorksPage } from './pages/HowItWorksPage';
import { LandingPage } from './pages/LandingPage';
import { LibraryPage } from './pages/LibraryPage';
import { LiveBoardPage } from './pages/LiveBoardPage';
import { PlaceholderPage } from './pages/PlaceholderPage';
import { ReplayBoardPage } from './pages/ReplayBoardPage';
import { RulebooksPage } from './pages/RulebooksPage';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Sidebar } from './components/shell/Sidebar';
import { Topbar } from './components/shell/Topbar';

// The home route ("/") is a full-bleed landing that stands on its own (no shell)
// and lands the visitor in /campaigns. Every other route is an app view wrapped
// in the campaign-first shell: a sidebar + glass topbar. The how-it-works
// explainer moved off "/" to its own route, linked from the landing and sidebar.
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route element={<AppShell />}>
        <Route path="/how-it-works" element={<HowItWorksPage />} />
        <Route path="/campaigns" element={<CampaignsPage />} />
        <Route path="/campaigns/:id" element={<CampaignDetailPage />} />
        <Route path="/a/:id" element={<ArtifactViewerPage />} />
        <Route path="/reviews/:id" element={<LiveBoardPage />} />
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/history/:id" element={<ReplayBoardPage />} />
        <Route path="/rulebooks" element={<RulebooksPage />} />
        <Route path="/library" element={<LibraryPage />} />
        <Route
          path="*"
          element={<PlaceholderPage title="Not found" description="That page does not exist." />}
        />
      </Route>
    </Routes>
  );
}

function AppShell() {
  return (
    <div className="relative z-10 flex min-h-full">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main className="mx-auto w-full max-w-[100rem] flex-1 px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
          <ErrorBoundary>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}
