import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Navbar from './components/Navbar';
import Dashboard from './pages/Dashboard';

import Screening from './pages/Screening';
import Investigation from './pages/Investigation';
import FraudGraph from './pages/FraudGraph';
import Simulator from './pages/Simulator';

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
            <Route path="/simulator" element={<Simulator />} />
          </Routes>
        </main>
      </div>
    </Router>
  );
}

export default App;
