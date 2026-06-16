import { Routes, Route, Link } from 'react-router-dom';
import Home from '@/pages/Home';
import AnalyticsPage from '@/pages/AnalyticsPage';
import ReviewPage from '@/pages/ReviewPage';
import CleanPage from '@/pages/CleanPage';
import ReprocessPage from '@/pages/ReprocessPage';
import DemoPage from '@/pages/DemoPage';

export default function DashboardRouter() {
  return (
    <div>
      <div style={{ position: 'fixed', top: 8, left: 12, zIndex: 100 }}>
        <Link to="/" style={{ color: '#7a7f94', fontSize: 12, textDecoration: 'none', background: '#1a1d28', padding: '4px 12px', borderRadius: 6, border: '1px solid #2a2d3a' }}>&larr; Extractor</Link>
      </div>
      <Routes>
        <Route path="/dashboard" element={<Home />} />
        <Route path="/dashboard/analytics" element={<AnalyticsPage />} />
        <Route path="/dashboard/review" element={<ReviewPage />} />
        <Route path="/dashboard/clean" element={<CleanPage />} />
        <Route path="/dashboard/reprocess" element={<ReprocessPage />} />
        <Route path="/dashboard/demo" element={<DemoPage />} />
      </Routes>
    </div>
  );
}
