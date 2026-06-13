import { Routes, Route } from 'react-router-dom';
import Home from '@/pages/Home';
import AnalyticsPage from '@/pages/AnalyticsPage';
import ReviewPage from '@/pages/ReviewPage';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/analytics" element={<AnalyticsPage />} />
      <Route path="/review" element={<ReviewPage />} />
    </Routes>
  );
}
