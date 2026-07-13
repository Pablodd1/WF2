import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';

const Home = lazy(() => import('@/pages/Home'));
const OperationsDashboard = lazy(() => import('@/pages/OperationsDashboard'));
const LandingPage = lazy(() => import('@/pages/LandingPage'));
const TradingFloor = lazy(() => import('@/pages/TradingFloor'));
const AnalyticsPage = lazy(() => import('@/pages/AnalyticsPage'));
const SourceAnalytics = lazy(() => import('@/pages/SourceAnalytics'));
const AnalyticsDashboard = lazy(() => import('@/pages/AnalyticsDashboard'));
const ReviewPage = lazy(() => import('@/pages/ReviewPage'));
const ReviewQueue = lazy(() => import('@/pages/ReviewQueue'));
const CleanPage = lazy(() => import('@/pages/CleanPage'));
const ReprocessPage = lazy(() => import('@/pages/ReprocessPage'));
const DemoPage = lazy(() => import('@/pages/DemoPage'));
const DemoMode = lazy(() => import('@/pages/DemoMode'));
const AdminPage = lazy(() => import('@/pages/AdminPage'));
const PriceResearch = lazy(() => import('@/pages/PriceResearch'));
const DemandSignals = lazy(() => import('@/pages/DemandSignals'));
const InsightDetails = lazy(() => import('@/pages/InsightDetails'));

export default function App() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-white" />}>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/dashboard" element={<OperationsDashboard />} />
        <Route path="/dashboard/legacy" element={<Home />} />
        <Route path="/trading" element={<TradingFloor />} />
        <Route path="/analytics" element={<SourceAnalytics />} />
        <Route path="/analytics/legacy" element={<AnalyticsPage />} />
        <Route path="/analytics-dashboard" element={<AnalyticsDashboard />} />
        <Route path="/review" element={<ReviewPage />} />
        <Route path="/review-queue" element={<ReviewQueue />} />
        <Route path="/clean" element={<CleanPage />} />
        <Route path="/reprocess" element={<ReprocessPage />} />
        <Route path="/demo" element={<DemoPage />} />
        <Route path="/demo-mode" element={<DemoMode />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/price-research" element={<PriceResearch />} />
        <Route path="/demand" element={<DemandSignals />} />
        <Route path="/insight" element={<InsightDetails />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
