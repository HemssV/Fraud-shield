import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Shield, Activity, Search, Target, Network, Zap, Menu, X } from 'lucide-react';

export default function Navbar() {
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  
  const navItems = [
    { name: 'Dashboard', path: '/', icon: <Activity size={18} /> },
    { name: 'Screening', path: '/screening', icon: <Search size={18} /> },
    { name: 'Investigation', path: '/investigation', icon: <Target size={18} /> },
    { name: 'Fraud Graph', path: '/graph', icon: <Network size={18} /> },
    { name: 'Simulator', path: '/simulator', icon: <Zap size={18} /> },
  ];

  return (
    <nav className="border-b border-[rgba(234,179,8,0.15)] bg-[rgba(10,10,10,0.85)] backdrop-blur-md sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center">
            <Link to="/" className="flex items-center gap-2">
              <Shield className="text-[#EAB308]" size={24} />
              <span className="text-[#FDE047] font-bold text-xl tracking-tight">FraudShield</span>
            </Link>
            
            <div className="hidden lg:block ml-8">
              <div className="flex items-baseline space-x-2 xl:space-x-3">
                {navItems.map((item) => {
                  const isActive = location.pathname === item.path || (item.path !== '/' && location.pathname.startsWith(item.path));
                  return (
                    <Link
                      key={item.name}
                      to={item.path}
                      className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all ${
                        isActive
                          ? 'bg-[rgba(234,179,8,0.18)] text-[#FDE047] border border-[rgba(234,179,8,0.3)] shadow-[0_0_10px_rgba(234,179,8,0.2)]'
                          : 'text-[#A1A1AA] hover:bg-[rgba(234,179,8,0.08)] hover:text-[#FDE047] border border-transparent'
                      }`}
                    >
                      {item.icon}
                      <span>{item.name}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">

            {/* Mobile Hamburger Button */}
            <div className="lg:hidden">
              <button
                type="button"
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-white/5 border border-white/10"
              >
                {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Mobile Menu Dropdown */}
      {mobileMenuOpen && (
        <div className="lg:hidden px-4 pt-2 pb-4 space-y-1 bg-[rgba(10,10,10,0.98)] border-b border-[rgba(234,179,8,0.2)] animate-fadeIn">
          {navItems.map((item) => {
            const isActive = location.pathname === item.path || (item.path !== '/' && location.pathname.startsWith(item.path));
            return (
              <Link
                key={item.name}
                to={item.path}
                onClick={() => setMobileMenuOpen(false)}
                className={`flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-semibold transition-colors ${
                  isActive
                    ? 'bg-[rgba(234,179,8,0.18)] text-[#FDE047] border border-[rgba(234,179,8,0.3)]'
                    : 'text-zinc-400 hover:bg-white/5 hover:text-white'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  {item.icon}
                  <span>{item.name}</span>
                </div>
                <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded ${
                  isActive ? 'bg-[#EAB308] text-black' : 'bg-zinc-800 text-zinc-400'
                }`}>
                  {item.phase}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </nav>
  );
}

