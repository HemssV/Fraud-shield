import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Navbar from './components/Navbar';
import Dashboard from './pages/Dashboard';

// Placeholder components for other phases
const Screening = () => <div className="p-8 text-center text-secondary">Screening Page (Phase 3)</div>;
const Investigation = () => <div className="p-8 text-center text-secondary">Investigation Page (Phase 4)</div>;
const FraudGraph = () => <div className="p-8 text-center text-secondary">Fraud Graph Page (Phase 5)</div>;

function App() {
  return (
    <Router>
      <div className="min-h-screen bg-[var(--color-brand-bg)] flex flex-col font-sans">
        <Navbar />
        <main className="flex-1 overflow-x-hidden">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/screening" element={<Screening />} />
            <Route path="/investigation" element={<Investigation />} />
            <Route path="/investigation/:id" element={<Investigation />} />
            <Route path="/graph" element={<FraudGraph />} />
          </Routes>
        </main>
      </div>
    </Router>
  );
}

export default App;
