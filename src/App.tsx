import { Routes, Route, Navigate } from 'react-router-dom';
import Home from '@/pages/Home';
import AnalyticsPage from '@/pages/AnalyticsPage';
import ReviewPage from '@/pages/ReviewPage';
import CleanPage from '@/pages/CleanPage';
import ReprocessPage from '@/pages/ReprocessPage';
import DemoPage from '@/pages/DemoPage';

export default function App() {
  return (
    <Routes>
      <Route path="/dashboard" element={<Home />} />
      <Route path="/dashboard/analytics" element={<AnalyticsPage />} />
      <Route path="/dashboard/review" element={<ReviewPage />} />
      <Route path="/dashboard/clean" element={<CleanPage />} />
      <Route path="/dashboard/reprocess" element={<ReprocessPage />} />
      <Route path="/dashboard/demo" element={<DemoPage />} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
