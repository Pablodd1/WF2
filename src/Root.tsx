import { BrowserRouter, Routes, Route } from 'react-router-dom';
import App from './App';
import DashboardRouter from './DashboardRouter';

export default function Root() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/*" element={<App />} />
        <Route path="/dashboard/*" element={<DashboardRouter />} />
      </Routes>
    </BrowserRouter>
  );
}
