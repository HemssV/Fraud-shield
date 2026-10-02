import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Shield, Activity, Search, Target, Network } from 'lucide-react';

export default function Navbar() {
  const location = useLocation();
  
  const navItems = [
    { name: 'Dashboard', path: '/', icon: <Activity size={18} /> },
    { name: 'Screening', path: '/screening', icon: <Search size={18} /> },
    { name: 'Investigation', path: '/investigation', icon: <Target size={18} /> },
    { name: 'Fraud Graph', path: '/graph', icon: <Network size={18} /> },
  ];

  return (
    <nav className="border-b border-[rgba(234,179,8,0.15)] bg-[rgba(10,10,10,0.8)] backdrop-blur-md sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center">
            <Link to="/" className="flex items-center gap-2">
              <Shield className="text-[#EAB308]" size={24} />
              <span className="text-[#FDE047] font-bold text-xl tracking-tight">FraudShield</span>
            </Link>
            
            <div className="hidden md:block ml-10">
              <div className="flex items-baseline space-x-4">
                {navItems.map((item) => (
                  <Link
                    key={item.name}
                    to={item.path}
                    className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                      location.pathname === item.path
                        ? 'bg-[rgba(234,179,8,0.15)] text-[#FDE047]'
                        : 'text-[#A1A1AA] hover:bg-[rgba(234,179,8,0.08)] hover:text-[#FDE047]'
                    }`}
                  >
                    {item.icon}
                    {item.name}
                  </Link>
                ))}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-[#22C55E] animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.6)]"></div>
            <span className="text-sm font-medium text-[#A1A1AA]">System Active</span>
          </div>
        </div>
      </div>
    </nav>
  );
}
