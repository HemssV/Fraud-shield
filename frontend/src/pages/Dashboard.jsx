import React, { useEffect, useState } from 'react';
import { api } from '../services/api';
import { Activity, ShieldAlert, FileClock, IndianRupee, AlertTriangle, XCircle, Clock } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Cell } from 'recharts';
import { Link } from 'react-router-dom';

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
  const [stats, setStats] = useState(STAT_MOCKS);
  const [trends, setTrends] = useState(TREND_MOCKS);
  const [alerts, setAlerts] = useState(ALERTS_MOCKS);
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

      <div className="mb-8 flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold text-primary tracking-tight">Fraud Intelligence Dashboard</h1>
          <p className="text-secondary mt-1">Real-time overview of screening activity and threats.</p>
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
      <div className="glass-panel p-6">
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-lg font-semibold text-primary">Recent Fraud Alerts</h3>
          <Link to="/investigation" className="text-sm text-[#EAB308] hover:text-[#FDE047] transition-colors">View All Queue</Link>
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
                <th className="pb-3 text-sm font-medium text-secondary"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[rgba(234,179,8,0.05)]">
              {alerts.map((alert) => (
                <tr key={alert.shipment_id} className="hover:bg-[rgba(255,255,255,0.02)] transition-colors">
                  <td className="py-4 text-sm font-medium text-primary tabular-nums">{alert.shipment_id}</td>
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
                    <Link to={`/investigation/${alert.shipment_id}`} className="text-xs font-medium text-[#EAB308] hover:text-[#FDE047] uppercase tracking-wider transition-colors">
                      Investigate &rarr;
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      
    </div>
  );
}
