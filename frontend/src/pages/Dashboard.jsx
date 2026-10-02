import React, { useEffect, useState } from 'react';
import { api } from '../services/api';
import { 
  Activity, ShieldAlert, FileClock, IndianRupee, AlertTriangle, XCircle, Clock, 
  Bot, CheckCircle2, UserCheck, ShieldCheck, ArrowRight, Zap, Target, Sparkles, Send, ChevronRight
} from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Cell } from 'recharts';
import { Link, useNavigate } from 'react-router-dom';

const RISK_COLORS = {
  CRITICAL: '#EF4444',
  HIGH: '#F97316',
  MEDIUM: '#F59E0B',
  LOW: '#22C55E'
};

const STAT_MOCKS = {
  shipments_screened: 1842,
  high_risk: 73,
  under_review: 52,
  estimated_loss_prevented: 185000
};

const TREND_MOCKS = [
  { name: 'Mon', screened: 400, flagged: 24 },
  { name: 'Tue', screened: 300, flagged: 13 },
  { name: 'Wed', screened: 550, flagged: 45 },
  { name: 'Thu', screened: 450, flagged: 28 },
  { name: 'Fri', screened: 600, flagged: 55 },
  { name: 'Sat', screened: 200, flagged: 12 },
  { name: 'Sun', screened: 250, flagged: 15 },
];

const ALERTS_MOCKS = [
  { shipment_id: 'SH10045', risk_level: 'HIGH', decision: 'HOLD', risk_score: 91, time: '10 min ago' },
  { shipment_id: 'SH10031', risk_level: 'CRITICAL', decision: 'BLOCK', risk_score: 98, time: '1 hr ago' },
  { shipment_id: 'SH10018', risk_level: 'MEDIUM', decision: 'REVIEW', risk_score: 72, time: '3 hrs ago' },
];

const DISTRIBUTION_MOCK = [
  { name: 'Critical', value: 12 },
  { name: 'High', value: 34 },
  { name: 'Medium', value: 56 },
  { name: 'Low', value: 400 },
];

function StatCard({ title, value, icon, trend }) {
  return (
    <div className="glass-panel p-5 flex flex-col justify-between hover:border-[rgba(253,224,71,0.4)] transition-colors">
      <div className="flex justify-between items-start">
        <h3 className="text-sm font-medium text-secondary">{title}</h3>
        <div className="p-2 rounded-lg bg-[rgba(234,179,8,0.1)] text-primary">
          {icon}
        </div>
      </div>
      <div className="mt-4 flex items-baseline gap-2">
        <span className="text-3xl font-bold text-primary tabular-nums tracking-tight">{value}</span>
        {trend && <span className="text-xs text-[#22C55E]">{trend}</span>}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [stats, setStats] = useState(STAT_MOCKS);
  const [trends, setTrends] = useState(TREND_MOCKS);
  const [alerts, setAlerts] = useState(ALERTS_MOCKS);
  const [selectedAlertId, setSelectedAlertId] = useState('SH10045');
  const [analystVerdict, setAnalystVerdict] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.getDashboardSummary().catch(() => STAT_MOCKS),
      api.getDashboardDaily().catch(() => TREND_MOCKS),
      api.getRecentAlerts().catch(() => ALERTS_MOCKS)
    ]).then(([summaryData, trendsData, alertsData]) => {
      setStats(summaryData.shipments_screened ? summaryData : STAT_MOCKS);
      setLoading(false);
    });
  }, []);

  const formatCurrency = (value) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumSignificantDigits: 3
    }).format(value);
  };

  const getRiskIcon = (level) => {
    switch(level) {
      case 'CRITICAL': return <XCircle size={16} />;
      case 'HIGH': return <AlertTriangle size={16} />;
      case 'MEDIUM': return <Clock size={16} />;
      default: return <ShieldAlert size={16} />;
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 relative">
      
      {/* Decorative background glow elements - Switched to Gold */}
      <div className="absolute top-0 left-1/4 w-[500px] h-[500px] bg-[#EAB308] rounded-full mix-blend-screen filter blur-[150px] opacity-15 pointer-events-none z-[-1]"></div>
      <div className="absolute bottom-0 right-1/4 w-[400px] h-[400px] bg-[#FDE047] rounded-full mix-blend-screen filter blur-[150px] opacity-10 pointer-events-none z-[-1]"></div>

      <div className="mb-8 flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-[rgba(234,179,8,0.1)] text-[#FDE047] border border-[rgba(234,179,8,0.25)] mb-2">
            <Sparkles size={13} />
            <span>FraudShield Core Engine Active (Phases 1-4 Operational)</span>
          </div>
          <h1 className="text-3xl font-bold text-primary tracking-tight">Fraud Intelligence Dashboard</h1>
          <p className="text-secondary mt-1">Real-time overview of screening activity, risk distributions, and case investigations.</p>
        </div>

        <div className="flex items-center gap-3">
          <Link
            to="/screening"
            className="px-4 py-2.5 rounded-lg text-xs font-semibold border border-[rgba(234,179,8,0.3)] bg-[rgba(234,179,8,0.1)] text-[#FDE047] hover:bg-[rgba(234,179,8,0.2)] transition-colors flex items-center gap-1.5"
          >
            <span>Phase 3: Screening</span>
            <ArrowRight size={14} />
          </Link>
          <Link
            to="/investigation"
            className="btn-primary py-2.5 px-4 rounded-lg text-xs font-bold uppercase tracking-wider flex items-center gap-1.5"
          >
            <span>Phase 4: Investigation</span>
            <Target size={14} />
          </Link>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <StatCard 
          title="Shipments Screened" 
          value={stats.shipments_screened.toLocaleString()} 
          icon={<Activity size={20} />} 
          trend="+12% today"
        />
        <StatCard 
          title="High Risk Alerts" 
          value={stats.high_risk} 
          icon={<AlertTriangle size={20} className="text-[#F97316]" />} 
        />
        <StatCard 
          title="Under Review" 
          value={stats.under_review} 
          icon={<FileClock size={20} className="text-[#F59E0B]" />} 
        />
        <StatCard 
          title="Loss Prevented" 
          value={formatCurrency(stats.estimated_loss_prevented)} 
          icon={<IndianRupee size={20} className="text-[#22C55E]" />} 
        />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        {/* Main Trend Chart */}
        <div className="glass-panel p-6 lg:col-span-2">
          <h3 className="text-lg font-semibold text-primary mb-6">Risk Trend Analysis</h3>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trends} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorFlagged" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={RISK_COLORS.HIGH} stopOpacity={0.8}/>
                    <stop offset="95%" stopColor={RISK_COLORS.HIGH} stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(234,179,8,0.1)" vertical={false} />
                <XAxis dataKey="name" stroke="#A1A1AA" tick={{fill: '#A1A1AA', fontSize: 12}} axisLine={false} tickLine={false} />
                <YAxis stroke="#A1A1AA" tick={{fill: '#A1A1AA', fontSize: 12}} axisLine={false} tickLine={false} />
                <Tooltip 
                  contentStyle={{ backgroundColor: 'rgba(10,10,10,0.95)', borderColor: 'rgba(234,179,8,0.2)', borderRadius: '8px' }}
                  itemStyle={{ color: '#FDE047' }}
                />
                <Area type="monotone" dataKey="screened" stroke="#EAB308" fill="none" strokeWidth={2} />
                <Area type="monotone" dataKey="flagged" stroke={RISK_COLORS.HIGH} fillOpacity={1} fill="url(#colorFlagged)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Risk Distribution */}
        <div className="glass-panel p-6">
          <h3 className="text-lg font-semibold text-primary mb-6">Risk Distribution</h3>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={DISTRIBUTION_MOCK} layout="vertical" margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(234,179,8,0.1)" horizontal={false} />
                <XAxis type="number" stroke="#A1A1AA" tick={{fill: '#A1A1AA', fontSize: 12}} axisLine={false} tickLine={false} />
                <YAxis dataKey="name" type="category" stroke="#A1A1AA" tick={{fill: '#A1A1AA', fontSize: 12}} axisLine={false} tickLine={false} />
                <Tooltip 
                  cursor={{fill: 'rgba(234,179,8,0.05)'}}
                  contentStyle={{ backgroundColor: 'rgba(10,10,10,0.95)', borderColor: 'rgba(234,179,8,0.2)', borderRadius: '8px' }}
                />
                <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={24}>
                  {DISTRIBUTION_MOCK.map((entry, index) => {
                    const colorMap = { 'Critical': RISK_COLORS.CRITICAL, 'High': RISK_COLORS.HIGH, 'Medium': RISK_COLORS.MEDIUM, 'Low': RISK_COLORS.LOW };
                    return <Cell key={`cell-${index}`} fill={colorMap[entry.name]} />;
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Alerts Table Row */}
      <div className="glass-panel p-6 mb-8">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h3 className="text-lg font-semibold text-primary">Recent Fraud Alerts</h3>
            <p className="text-xs text-secondary mt-0.5">Click any row below to preview its Phase 4 investigation dossier instantly.</p>
          </div>
          <Link to="/investigation" className="text-xs font-semibold text-[#EAB308] hover:text-[#FDE047] flex items-center gap-1 transition-colors">
            <span>Open All Queue Cases (Phase 4)</span>
            <ArrowRight size={14} />
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-[rgba(234,179,8,0.1)]">
                <th className="pb-3 text-sm font-medium text-secondary">Shipment ID</th>
                <th className="pb-3 text-sm font-medium text-secondary">Time</th>
                <th className="pb-3 text-sm font-medium text-secondary">Risk Score</th>
                <th className="pb-3 text-sm font-medium text-secondary">Level</th>
                <th className="pb-3 text-sm font-medium text-secondary">Action Taken</th>
                <th className="pb-3 text-sm font-medium text-secondary text-right">Phase 4 Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[rgba(234,179,8,0.05)]">
              {alerts.map((alert) => {
                const isSelected = selectedAlertId === alert.shipment_id;
                return (
                  <tr 
                    key={alert.shipment_id} 
                    onClick={() => setSelectedAlertId(alert.shipment_id)}
                    className={`cursor-pointer transition-colors ${
                      isSelected 
                        ? 'bg-[rgba(234,179,8,0.1)] border-l-2 border-[#EAB308]' 
                        : 'hover:bg-[rgba(255,255,255,0.02)]'
                    }`}
                  >
                    <td className="py-4 px-2 text-sm font-bold text-white tabular-nums flex items-center gap-2">
                      {isSelected && <span className="w-2 h-2 rounded-full bg-[#EAB308] animate-ping"></span>}
                      <span>{alert.shipment_id}</span>
                    </td>
                    <td className="py-4 text-sm text-secondary">{alert.time}</td>
                    <td className="py-4 text-sm font-bold tabular-nums">
                      <span className={alert.risk_score >= 90 ? 'text-[#EF4444]' : 'text-[#F97316]'}>
                        {alert.risk_score}
                      </span>
                    </td>
                    <td className="py-4">
                      <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium
                        ${alert.risk_level === 'CRITICAL' ? 'bg-[rgba(239,68,68,0.1)] text-[#EF4444] border border-[#EF4444]/30' : ''}
                        ${alert.risk_level === 'HIGH' ? 'bg-[rgba(249,115,22,0.1)] text-[#F97316] border border-[#F97316]/30' : ''}
                        ${alert.risk_level === 'MEDIUM' ? 'bg-[rgba(245,158,11,0.1)] text-[#F59E0B] border border-[#F59E0B]/30' : ''}
                      `}>
                        {getRiskIcon(alert.risk_level)}
                        {alert.risk_level}
                      </span>
                    </td>
                    <td className="py-4 text-sm text-secondary font-medium">{alert.decision}</td>
                    <td className="py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); setSelectedAlertId(alert.shipment_id); }}
                          className={`text-xs px-2.5 py-1 rounded font-semibold transition-all ${
                            isSelected 
                              ? 'bg-[#EAB308] text-black font-bold' 
                              : 'bg-white/5 text-zinc-300 hover:bg-white/10'
                          }`}
                        >
                          Quick View
                        </button>
                        <Link 
                          to={`/investigation/${alert.shipment_id}`} 
                          onClick={(e) => e.stopPropagation()}
                          className="text-xs font-semibold text-[#EAB308] hover:text-[#FDE047] uppercase tracking-wider flex items-center gap-0.5 transition-colors"
                        >
                          <span>Full Dossier</span>
                          <ChevronRight size={14} />
                        </Link>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* PHASE 4: LIVE INVESTIGATION DOSSIER & ANALYST CONSOLE SPOTLIGHT */}
      <div className="glass-panel p-6 border-2 border-[rgba(234,179,8,0.3)] bg-gradient-to-b from-[rgba(234,179,8,0.03)] to-transparent relative">
        <div className="flex flex-col md:flex-row md:items-center justify-between pb-4 border-b border-[rgba(234,179,8,0.15)] mb-6 gap-3">
          <div>
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-[#EAB308] text-black uppercase tracking-wider mb-1.5">
              <Target size={12} />
              <span>Phase 4 Feature Spotlight: Live Investigation Dossier</span>
            </div>
            <h2 className="text-xl font-bold text-white flex items-center gap-3">
              <span>Active Inspection: <span className="text-[#FDE047]">{selectedAlertId}</span></span>
              <span className="text-xs px-2.5 py-0.5 rounded-full border border-red-500/30 bg-red-500/10 text-red-400 font-semibold">
                HIGH PRIORITY CASE
              </span>
            </h2>
          </div>

          <div className="flex items-center gap-3">
            <Link
              to={`/investigation/${selectedAlertId}`}
              className="btn-primary px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 shadow-[0_0_12px_rgba(234,179,8,0.3)]"
            >
              <span>Open Dedicated Phase 4 Workspace</span>
              <ArrowRight size={14} />
            </Link>
          </div>
        </div>

        {/* Phase 4 3-Column Mini Dossier */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Col 1: Shipment & Telemetry Details */}
          <div className="space-y-4">
            <div className="p-4 rounded-xl bg-black/40 border border-white/5">
              <span className="text-xs text-secondary font-semibold uppercase block mb-2">Shipment Routing & SLA</span>
              <div className="text-sm font-bold text-white flex items-center gap-2 mb-3">
                <span>{selectedAlertId === 'SH10031' ? 'Delhi' : selectedAlertId === 'SH10018' ? 'Kolkata' : 'Mumbai'}</span>
                <ChevronRight size={16} className="text-[#EAB308]" />
                <span>{selectedAlertId === 'SH10031' ? 'Kabul (Flagged High Risk)' : selectedAlertId === 'SH10018' ? 'Patna' : 'Surat Hub'}</span>
              </div>
              
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="p-2 rounded bg-zinc-900/60 border border-white/5">
                  <span className="text-zinc-500 block text-[10px]">Package Weight</span>
                  <span className="text-white font-bold tabular-nums">
                    {selectedAlertId === 'SH10031' ? '200.0 kg' : selectedAlertId === 'SH10018' ? '12.0 kg' : '48.5 kg'}
                  </span>
                </div>
                <div className="p-2 rounded bg-zinc-900/60 border border-white/5">
                  <span className="text-zinc-500 block text-[10px]">Service Class</span>
                  <span className="text-white font-bold">EXPRESS AIR</span>
                </div>
                <div className="p-2 rounded bg-zinc-900/60 border border-white/5">
                  <span className="text-zinc-500 block text-[10px]">Shipper Account</span>
                  <span className="text-[#FDE047] font-semibold">S1001-CORP</span>
                </div>
                <div className="p-2 rounded bg-zinc-900/60 border border-white/5">
                  <span className="text-zinc-500 block text-[10px]">SLA Timer</span>
                  <span className="text-amber-400 font-bold tabular-nums">4h 18m left</span>
                </div>
              </div>
            </div>

            {/* Risk Breakdown Card */}
            <div className="p-4 rounded-xl bg-black/40 border border-white/5">
              <div className="flex justify-between items-center mb-3">
                <span className="text-xs text-secondary font-semibold uppercase">Risk Score Decomposition</span>
                <span className="text-sm font-extrabold text-[#EF4444] tabular-nums">
                  {selectedAlertId === 'SH10031' ? '98 / 100' : selectedAlertId === 'SH10018' ? '72 / 100' : '91 / 100'}
                </span>
              </div>
              <div className="space-y-2.5 text-xs">
                <div>
                  <div className="flex justify-between text-[11px] mb-1">
                    <span className="text-zinc-400">Deterministic Rules:</span>
                    <span className="text-white font-bold">95 pts</span>
                  </div>
                  <div className="w-full bg-zinc-800 rounded-full h-1.5">
                    <div className="bg-[#EAB308] h-1.5 rounded-full" style={{ width: '95%' }}></div>
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-[11px] mb-1">
                    <span className="text-zinc-400">ML Anomaly Model:</span>
                    <span className="text-sky-400 font-bold">88 pts</span>
                  </div>
                  <div className="w-full bg-zinc-800 rounded-full h-1.5">
                    <div className="bg-sky-400 h-1.5 rounded-full" style={{ width: '88%' }}></div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Col 2: Triggered Fraud Reasons List */}
          <div className="space-y-3">
            <span className="text-xs text-secondary font-semibold uppercase block">Top Triggered Fraud Reasons</span>
            
            <div className="p-3 rounded-lg bg-black/40 border border-red-500/20 text-xs space-y-1">
              <div className="flex justify-between font-mono font-bold text-white text-[11px]">
                <span className="flex items-center gap-1.5 text-red-400">
                  <AlertTriangle size={13} />
                  <span>WEIGHT_SPIKE_DEVIATION</span>
                </span>
                <span className="text-red-400 font-bold">+25 pts</span>
              </div>
              <p className="text-zinc-300 text-[11px] leading-relaxed">
                Shipment weight exceeds historical baseline for this enterprise profile by over 5.6x standard deviations.
              </p>
            </div>

            <div className="p-3 rounded-lg bg-black/40 border border-amber-500/20 text-xs space-y-1">
              <div className="flex justify-between font-mono font-bold text-white text-[11px]">
                <span className="flex items-center gap-1.5 text-amber-400">
                  <ShieldAlert size={13} />
                  <span>HIGH_FRAUD_DESTINATION_ROUTE</span>
                </span>
                <span className="text-amber-400 font-bold">+20 pts</span>
              </div>
              <p className="text-zinc-300 text-[11px] leading-relaxed">
                Destination postal corridor marked with elevated interception and delivery diversion reports.
              </p>
            </div>

            <div className="p-3 rounded-lg bg-black/40 border border-amber-500/20 text-xs space-y-1">
              <div className="flex justify-between font-mono font-bold text-white text-[11px]">
                <span className="flex items-center gap-1.5 text-amber-400">
                  <Bot size={13} />
                  <span>NEW_UNTRUSTED_DEVICE</span>
                </span>
                <span className="text-amber-400 font-bold">+15 pts</span>
              </div>
              <p className="text-zinc-300 text-[11px] leading-relaxed">
                Booking initiated from device terminal exhibiting Tor / commercial proxy network characteristics.
              </p>
            </div>
          </div>

          {/* Col 3: GenAI Explanation & Analyst Fast Actions */}
          <div className="space-y-4">
            {/* GenAI Copilot */}
            <div className="p-4 rounded-xl bg-gradient-to-br from-sky-950/30 to-black border border-sky-500/30">
              <div className="flex items-center gap-2 mb-2">
                <Sparkles size={16} className="text-sky-400" />
                <span className="text-xs font-bold text-white">Gemini Fraud Copilot Brief</span>
                <span className="text-[10px] text-sky-400 font-mono ml-auto">Gemini 1.5 Pro</span>
              </div>
              <p className="text-xs text-zinc-300 leading-relaxed italic">
                &ldquo;Shipment {selectedAlertId} exhibits composite fraud indicators: severe weight anomaly combined with an unverified terminal proxy. Cargo diversion risk is acute. Release should be withheld pending physical inspection.&rdquo;
              </p>
            </div>

            {/* Quick Analyst Actions */}
            <div className="p-4 rounded-xl bg-black/50 border border-[rgba(234,179,8,0.25)] space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-white flex items-center gap-1.5">
                  <ShieldCheck size={14} className="text-[#EAB308]" />
                  <span>Analyst Fast Decision</span>
                </span>
                {analystVerdict && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                    {analystVerdict}
                  </span>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setAnalystVerdict('ENFORCED_BLOCK')}
                  className="px-3 py-2 rounded-lg bg-red-600/20 hover:bg-red-600/30 text-red-300 border border-red-500/40 text-xs font-bold flex items-center justify-center gap-1 transition-colors cursor-pointer"
                >
                  <XCircle size={14} />
                  <span>Block Shipment</span>
                </button>
                <button
                  type="button"
                  onClick={() => setAnalystVerdict('HELD_FOR_REVIEW')}
                  className="px-3 py-2 rounded-lg bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-500/40 text-xs font-bold flex items-center justify-center gap-1 transition-colors cursor-pointer"
                >
                  <Clock size={14} />
                  <span>Hold & Challenge</span>
                </button>
                <button
                  type="button"
                  onClick={() => setAnalystVerdict('CLEARED_FALSE_POSITIVE')}
                  className="px-3 py-2 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 text-xs font-bold flex items-center justify-center gap-1 transition-colors cursor-pointer"
                >
                  <CheckCircle2 size={14} />
                  <span>Clear & Allow</span>
                </button>
                <Link
                  to={`/investigation/${selectedAlertId}`}
                  className="px-3 py-2 rounded-lg bg-[#EAB308] hover:bg-[#FDE047] text-black text-xs font-extrabold flex items-center justify-center gap-1 transition-colors"
                >
                  <span>Full Console</span>
                  <ArrowRight size={14} />
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
      
    </div>
  );
}
