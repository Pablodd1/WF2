import { Routes, Route, Navigate } from 'react-router-dom';
import Home from '@/pages/Home';
import AnalyticsPage from '@/pages/AnalyticsPage';
import ReviewPage from '@/pages/ReviewPage';
import CleanPage from '@/pages/CleanPage';
import ReprocessPage from '@/pages/ReprocessPage';
import DemoPage from '@/pages/DemoPage';
import AdminPage from '@/pages/AdminPage';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/analytics" element={<AnalyticsPage />} />
      <Route path="/review" element={<ReviewPage />} />
      <Route path="/clean" element={<CleanPage />} />
      <Route path="/reprocess" element={<ReprocessPage />} />
      <Route path="/demo" element={<DemoPage />} />
      <Route path="/admin" element={<AdminPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
