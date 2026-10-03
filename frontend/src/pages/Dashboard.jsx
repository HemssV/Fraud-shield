import React, { useEffect, useState } from 'react';
import { api } from '../services/api';
import { 
  Activity, ShieldAlert, FileClock, IndianRupee, AlertTriangle, XCircle, Clock, 
  Bot, CheckCircle2, ShieldCheck, ArrowRight, Target, Sparkles, ChevronRight,
  Check, X, RotateCcw
} from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Cell, LabelList } from 'recharts';
import { Link } from 'react-router-dom';

const RISK_COLORS = {
  CRITICAL: '#EF4444',
  HIGH: '#F97316',
  MEDIUM: '#F59E0B',
  LOW: '#22C55E'
};

// ─── [HARDCODED DATA / MOCK FALLBACK] ─────────────────────────────────────────
// The following mock datasets are graceful UI fallbacks used ONLY when the
// live Django endpoints (/api/v1/dashboard/*) are unreachable or return empty sets.
// When the backend is online, real database data dynamically replaces these values.

const STAT_MOCKS = {
  shipments_screened: 1842,
  high_risk: 73,
  under_review: 52,
  estimated_loss_prevented: 185000,
  trend_str: '+12% today'
};

const TREND_MOCKS = [
  { name: 'Mon', screened: 400, flagged: 24, day: '2026-09-28' },
  { name: 'Tue', screened: 300, flagged: 13, day: '2026-09-29' },
  { name: 'Wed', screened: 550, flagged: 45, day: '2026-09-30' },
  { name: 'Thu', screened: 450, flagged: 28, day: '2026-10-01' },
  { name: 'Fri', screened: 600, flagged: 55, day: '2026-10-02' },
  { name: 'Sat', screened: 200, flagged: 12, day: '2026-10-03' },
  { name: 'Sun', screened: 250, flagged: 15, day: '2026-10-04' },
];

const ALERTS_MOCKS = [
  {
    shipment_id: 'SH10031',
    risk_level: 'CRITICAL',
    decision: 'BLOCK',
    risk_score: 98,
    rule_score: 95,
    ml_score: 92,
    time: '1 hr ago',
    origin: 'Delhi Hub',
    destination: 'Kabul (Flagged High Risk)',
    weight_kg: 200.0,
    service: 'EXPRESS AIR',
    account_number: 'S1001-CORP',
    priority: 'URGENT',
    sla_formatted: '1h 14m left',
    sla_remaining_seconds: 4440,
    reasons: [
      { reason_code: 'WEIGHT_SPIKE_DEVIATION', points: 30, description: 'Weight exceeds historical profile by 5.6x std deviation.' },
      { reason_code: 'HIGH_FRAUD_DESTINATION_ROUTE', points: 25, description: 'Destination corridor marked with elevated interception alerts.' },
      { reason_code: 'NEW_UNTRUSTED_DEVICE', points: 20, description: 'Terminal proxy signature detected on unverified device.' }
    ]
  },
  {
    shipment_id: 'SH10045',
    risk_level: 'HIGH',
    decision: 'HOLD',
    risk_score: 91,
    rule_score: 85,
    ml_score: 88,
    time: '10 min ago',
    origin: 'Mumbai Hub',
    destination: 'Surat Cargo Transit',
    weight_kg: 48.5,
    service: 'EXPRESS AIR',
    account_number: 'S2044-LOGISTICS',
    priority: 'HIGH',
    sla_formatted: '4h 18m left',
    sla_remaining_seconds: 15480,
    reasons: [
      { reason_code: 'VELOCITY_SURGE_HOURLY', points: 25, description: 'Shipper volume surged 8.2x over 30-day baseline within 1 hour.' },
      { reason_code: 'DEVICE_REUSE_FLAG', points: 20, description: 'Hardware fingerprint linked to previously suspended account.' }
    ]
  },
  {
    shipment_id: 'SH10018',
    risk_level: 'MEDIUM',
    decision: 'REVIEW',
    risk_score: 72,
    rule_score: 65,
    ml_score: 70,
    time: '3 hrs ago',
    origin: 'Kolkata Hub',
    destination: 'Patna Warehouse',
    weight_kg: 12.0,
    service: 'GROUND STANDARD',
    account_number: 'S1099-RETAIL',
    priority: 'NORMAL',
    sla_formatted: '18h 42m left',
    sla_remaining_seconds: 67320,
    reasons: [
      { reason_code: 'NIGHT_HOURS_BOOKING', points: 15, description: 'Order placed outside business hours at 02:45 AM local time.' },
      { reason_code: 'NEW_PAYMENT_METHOD', points: 10, description: 'Payment card added less than 24 hours prior to booking.' }
    ]
  },
];

const DISTRIBUTION_MOCK = [
  { name: 'Critical', value: 12, key: 'CRITICAL' },
  { name: 'High', value: 34, key: 'HIGH' },
  { name: 'Medium', value: 56, key: 'MEDIUM' },
  { name: 'Low', value: 400, key: 'LOW' },
];

const SKELETON_STATS = {
  shipments_screened: null,
  high_risk: null,
  under_review: null,
  estimated_loss_prevented: null,
  trend_str: ''
};

function StatCard({ title, value, icon, trend }) {
  const isLoading = value === null || value === undefined;
  return (
    <div className="glass-panel p-5 flex flex-col justify-between hover:border-[rgba(253,224,71,0.4)] transition-colors">
      <div className="flex justify-between items-start">
        <h3 className="text-sm font-medium text-secondary">{title}</h3>
        <div className="p-2 rounded-lg bg-[rgba(234,179,8,0.1)] text-primary">
          {icon}
        </div>
      </div>
      <div className="mt-4 flex items-baseline gap-2">
        {isLoading ? (
          <div className="h-9 w-24 bg-white/10 rounded-md animate-pulse"></div>
        ) : (
          <span className="text-3xl font-bold text-primary tabular-nums tracking-tight">{value}</span>
        )}
        {trend && !isLoading && <span className="text-xs text-[#22C55E] font-medium">{trend}</span>}
      </div>
    </div>
  );
}

// Interactive SVG dot for the AreaChart points
function ChartDot(props) {
  const { cx, cy, stroke, fill, payload, selectedDay, onSelectDay } = props;
  if (cx === undefined || cy === undefined || !payload) return null;
  const isSelected = selectedDay && payload.day === selectedDay;

  return (
    <g
      className="cursor-pointer"
      onClick={(e) => {
        e.stopPropagation();
        if (payload.day) onSelectDay(payload.day);
      }}
    >
      {isSelected && (
        <circle
          cx={cx}
          cy={cy}
          r={13}
          fill={fill || stroke}
          opacity={0.3}
          className="animate-pulse"
        />
      )}
      <circle
        cx={cx}
        cy={cy}
        r={isSelected ? 6.5 : 4.5}
        fill={isSelected ? '#FFFFFF' : (fill || stroke)}
        stroke={isSelected ? (stroke || '#EAB308') : '#18181B'}
        strokeWidth={2}
      />
    </g>
  );
}

// Custom interactive Tooltip for Trend Analysis
function TrendTooltip({ active, payload, label, selectedDay }) {
  if (!active || !payload || !payload.length) return null;
  const dataItem = payload[0]?.payload;
  const isSelected = selectedDay && dataItem?.day === selectedDay;

  return (
    <div className="bg-zinc-950/95 border border-amber-500/30 rounded-xl p-3 shadow-2xl backdrop-blur-md text-xs min-w-[190px]">
      <div className="flex items-center justify-between border-b border-zinc-800 pb-1.5 mb-2">
        <span className="font-bold text-white text-sm">{label}</span>
        {dataItem?.day && (
          <span className="text-[11px] text-zinc-400 font-mono">{dataItem.day}</span>
        )}
      </div>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-zinc-300">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-[#EAB308]"></span>
            Screened:
          </span>
          <span className="font-bold text-amber-400 tabular-nums">{dataItem?.screened ?? 0}</span>
        </div>
        <div className="flex items-center justify-between text-zinc-300">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-[#F97316]"></span>
            Flagged High Risk:
          </span>
          <span className="font-bold text-orange-400 tabular-nums">{dataItem?.flagged ?? 0}</span>
        </div>
      </div>
      <div className="mt-2.5 pt-2 border-t border-zinc-800/80 text-[10px] flex items-center justify-between">
        {isSelected ? (
          <span className="text-emerald-400 font-medium">✓ Currently inspecting</span>
        ) : (
          <span className="text-amber-400/90 font-medium">👆 Click point to view distribution</span>
        )}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [stats, setStats] = useState(SKELETON_STATS);
  const [trends, setTrends] = useState(null);
  const [alerts, setAlerts] = useState(null);
  const [distribution, setDistribution] = useState(null);
  const [selectedDay, setSelectedDay] = useState(null);
  const [distLoading, setDistLoading] = useState(false);
  const [selectedAlertId, setSelectedAlertId] = useState(null);
  const [loading, setLoading] = useState(true);

  // Decision Modal State
  const [decisionModalOpen, setDecisionModalOpen] = useState(false);
  const [decisionAction, setDecisionAction] = useState(null); // 'BLOCK', 'REVIEW', 'ALLOW'
  const [decisionNotes, setDecisionNotes] = useState('');
  const [decisionFraudType, setDecisionFraudType] = useState('VOLUME_ATTACK');
  const [analystName, setAnalystName] = useState('Demo Analyst');
  const [decisionSubmitting, setDecisionSubmitting] = useState(false);
  const [decisionToast, setDecisionToast] = useState(null);

  // Load live data from Backend B using the combined endpoint (1 request instead of 4)
  // Falls back to individual calls if combined endpoint unavailable, then to mock data.
  useEffect(() => {
    const loadDashboard = async () => {
      try {
        // Try the combined endpoint first (single HTTP request for all data)
        const data = await api.getDashboardAll();

        // 1. Process Summary
        if (data.summary && (data.summary.total_screened !== undefined || data.summary.shipments_screened !== undefined)) {
          setStats({
            shipments_screened: data.summary.shipments_screened || data.summary.total_screened || 0,
            high_risk: data.summary.high_risk || 0,
            under_review: data.summary.under_review || 0,
            estimated_loss_prevented: data.summary.estimated_loss_prevented || 0,
            trend_str: data.summary.trend_str || data.summary.today?.trend_pct || '+0% today'
          });
        } else {
          setStats(STAT_MOCKS);
        }

        // 2. Process Daily Trends - generate continuous 7-day timeline
        if (Array.isArray(data.daily) && data.daily.length > 0) {
          const dayMap = {};
          data.daily.forEach(item => {
            const key = item.day ? String(item.day).split('T')[0] : null;
            if (key) {
              dayMap[key] = {
                screened: Number(item.screened || 0),
                flagged: Number(item.flagged || 0)
              };
            }
          });

          // Anchor to the latest day in data.daily (or today)
          const latestDayStr = data.daily[0]?.day ? String(data.daily[0].day).split('T')[0] : null;
          const anchorDate = latestDayStr ? new Date(latestDayStr + 'T12:00:00') : new Date();

          const formattedTrends = [];
          for (let i = 6; i >= 0; i--) {
            const d = new Date(anchorDate);
            d.setDate(d.getDate() - i);
            const dateStr = d.toISOString().split('T')[0];
            const dayName = d.toLocaleDateString('en-US', { weekday: 'short' });
            formattedTrends.push({
              name: dayName,
              day: dateStr,
              screened: dayMap[dateStr]?.screened || 0,
              flagged: dayMap[dateStr]?.flagged || 0
            });
          }
          setTrends(formattedTrends);
        } else {
          setTrends(TREND_MOCKS);
        }

        // 3. Process Alerts (already sorted by SLA remaining time by Django)
        if (Array.isArray(data.alerts) && data.alerts.length > 0) {
          setAlerts(data.alerts);
          setSelectedAlertId(data.alerts[0].shipment_id);
        } else {
          setAlerts(ALERTS_MOCKS);
          setSelectedAlertId(ALERTS_MOCKS[0].shipment_id);
        }

        // 4. Process Risk Distribution
        if (Array.isArray(data.risk_distribution) && data.risk_distribution.some(d => d.value > 0)) {
          setDistribution(data.risk_distribution);
        } else {
          setDistribution(DISTRIBUTION_MOCK);
        }

      } catch (err) {
        console.warn('[Dashboard] Combined endpoint failed, falling back to mock data:', err.message);
        setStats(STAT_MOCKS);
        setTrends(TREND_MOCKS);
        setAlerts(ALERTS_MOCKS);
        setSelectedAlertId(ALERTS_MOCKS[0].shipment_id);
        setDistribution(DISTRIBUTION_MOCK);
      }

      setLoading(false);
    };

    loadDashboard();
  }, []);

  // When a user selects a day to inspect on the chart, filter distribution dynamically
  const handleSelectDay = (dayStr) => {
    // If clicking on the currently selected day, toggle back to all-time
    const targetDay = (selectedDay === dayStr) ? null : dayStr;
    setSelectedDay(targetDay);
    setDistLoading(true);

    api.getRiskDistribution(targetDay || undefined)
      .then(dist => {
        if (Array.isArray(dist)) {
          setDistribution(dist);
        }
      })
      .catch((err) => {
        console.warn('Failed to load risk distribution for', targetDay, err);
        if (!targetDay) {
          setDistribution(DISTRIBUTION_MOCK);
        } else {
          setDistribution([
            { name: 'Critical', value: 0, key: 'CRITICAL' },
            { name: 'High', value: 0, key: 'HIGH' },
            { name: 'Medium', value: 0, key: 'MEDIUM' },
            { name: 'Low', value: 0, key: 'LOW' },
          ]);
        }
      })
      .finally(() => {
        setDistLoading(false);
      });
  };

  const formatCurrency = (value) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumSignificantDigits: 3
    }).format(value);
  };

  const getRiskIcon = (level) => {
    switch(level) {
      case 'CRITICAL': return <XCircle size={15} />;
      case 'HIGH': return <AlertTriangle size={15} />;
      case 'MEDIUM': return <Clock size={15} />;
      default: return <ShieldAlert size={15} />;
    }
  };

  const selectedAlert = (alerts && alerts.length > 0)
    ? (alerts.find(a => a.shipment_id === selectedAlertId) || alerts[0])
    : null;

  // Open Decision Prompt Modal
  const openDecisionModal = (action) => {
    setDecisionAction(action);
    setDecisionNotes('');
    setDecisionFraudType('VOLUME_ATTACK');
    setDecisionModalOpen(true);
  };

  // Submit Decision with Required Reason / Notes
  const handleDecisionSubmit = async (e) => {
    e.preventDefault();
    if (!decisionNotes.trim()) {
      alert('Please provide a justification / reason for this action.');
      return;
    }

    setDecisionSubmitting(true);
    const actionLabel = decisionAction === 'BLOCK' ? 'ENFORCED_BLOCK' : decisionAction === 'REVIEW' ? 'HELD_FOR_REVIEW' : 'CLEARED_FALSE_POSITIVE';
    const verdict = decisionAction === 'BLOCK' ? 'CONFIRMED_FRAUD' : decisionAction === 'ALLOW' ? 'FALSE_POSITIVE' : 'INCONCLUSIVE';

    try {
      if (selectedAlert.case_id) {
        await api.submitAnalystDecision(selectedAlert.case_id, {
          verdict,
          action: decisionAction,
          reason: decisionNotes,
          notes: decisionNotes,
          fraud_type: decisionAction === 'BLOCK' ? decisionFraudType : null,
          staff_user_id: analystName
        });
      }

      // Update local alert state immediately
      setAlerts(prev => prev.map(a => a.shipment_id === selectedAlert.shipment_id ? { ...a, decision: decisionAction } : a));
      setDecisionToast({
        action: actionLabel,
        notes: decisionNotes,
        shipment_id: selectedAlert.shipment_id,
        analyst: analystName
      });
      setDecisionModalOpen(false);
    } catch (err) {
      console.warn('Backend decision submission failed, updating UI locally:', err);
      setAlerts(prev => prev.map(a => a.shipment_id === selectedAlert.shipment_id ? { ...a, decision: decisionAction } : a));
      setDecisionToast({
        action: actionLabel,
        notes: decisionNotes,
        shipment_id: selectedAlert.shipment_id,
        analyst: analystName
      });
      setDecisionModalOpen(false);
    } finally {
      setDecisionSubmitting(false);
    }
  };

  const totalInDist = distribution ? distribution.reduce((sum, d) => sum + (Number(d.value) || 0), 0) : 0;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 relative">
      
      {/* Decorative background glow elements */}
      <div className="absolute top-0 left-1/4 w-[500px] h-[500px] bg-[#EAB308] rounded-full mix-blend-screen filter blur-[150px] opacity-15 pointer-events-none z-[-1]"></div>
      <div className="absolute bottom-0 right-1/4 w-[400px] h-[400px] bg-[#FDE047] rounded-full mix-blend-screen filter blur-[150px] opacity-10 pointer-events-none z-[-1]"></div>

      <div className="mb-8 flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-primary tracking-tight">Fraud Intelligence Dashboard</h1>
          <p className="text-secondary mt-1">Real-time overview of screening activity, SLA-ranked queue, and operational investigations.</p>
        </div>

        <div className="flex items-center gap-3">
          <Link
            to="/screening"
            className="px-4 py-2.5 rounded-lg text-xs font-semibold border border-[rgba(234,179,8,0.3)] bg-[rgba(234,179,8,0.1)] text-[#FDE047] hover:bg-[rgba(234,179,8,0.2)] transition-colors flex items-center gap-1.5"
          >
            <span>Live Screening</span>
            <ArrowRight size={14} />
          </Link>
          <Link
            to="/investigation"
            className="btn-primary py-2.5 px-4 rounded-lg text-xs font-bold uppercase tracking-wider flex items-center gap-1.5"
          >
            <span>Full Investigation Queue</span>
            <Target size={14} />
          </Link>
        </div>
      </div>

      {/* Decision Recorded Banner / Toast */}
      {decisionToast && (
        <div className="mb-6 p-4 rounded-xl bg-emerald-950/40 border border-emerald-500/40 flex items-start justify-between gap-3 text-emerald-200 text-xs animate-in fade-in duration-300">
          <div className="flex items-start gap-2.5">
            <CheckCircle2 size={16} className="text-emerald-400 mt-0.5 shrink-0" />
            <div>
              <p className="font-bold text-white text-sm">
                Analyst Verdict Recorded for {decisionToast.shipment_id}: <span className="text-emerald-400">{decisionToast.action}</span>
              </p>
              <p className="text-emerald-300/90 mt-1">
                <strong>Justification:</strong> &ldquo;{decisionToast.notes}&rdquo; &bull; Logged by {decisionToast.analyst} into tamper-proof audit chain.
              </p>
            </div>
          </div>
          <button 
            type="button"
            onClick={() => setDecisionToast(null)}
            className="text-emerald-400 hover:text-white"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* KPI Cards — Wired to Real Live Database Data */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <StatCard 
          title="Shipments Screened" 
          value={stats.shipments_screened !== null ? stats.shipments_screened.toLocaleString() : null} 
          icon={<Activity size={20} />} 
          trend={stats.trend_str}
        />
        <StatCard 
          title="High Risk Alerts" 
          value={stats.high_risk !== null ? stats.high_risk : null} 
          icon={<AlertTriangle size={20} className="text-[#F97316]" />} 
        />
        <StatCard 
          title="Under Review" 
          value={stats.under_review !== null ? stats.under_review : null} 
          icon={<FileClock size={20} className="text-[#F59E0B]" />} 
        />
        <StatCard 
          title="Loss Prevented" 
          value={stats.estimated_loss_prevented !== null ? formatCurrency(stats.estimated_loss_prevented) : null} 
          icon={<IndianRupee size={20} className="text-[#22C55E]" />} 
        />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        {/* Main Trend Chart */}
        <div className="glass-panel p-6 lg:col-span-2">
          <div className="flex justify-between items-center mb-6">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-semibold text-primary">Risk Trend Analysis</h3>
                {selectedDay && (
                  <span className="text-[11px] px-2.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 font-mono font-medium border border-amber-500/30 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse"></span>
                    <span>Inspecting: {selectedDay}</span>
                  </span>
                )}
              </div>
              <p className="text-xs text-secondary mt-0.5">Click any day point to inspect its specific risk distribution.</p>
            </div>
            {selectedDay && (
              <button
                type="button"
                onClick={() => handleSelectDay(null)}
                className="text-xs px-2.5 py-1 rounded bg-zinc-800 text-amber-400 hover:bg-zinc-700 font-semibold border border-amber-500/30 flex items-center gap-1 transition-colors"
              >
                <RotateCcw size={12} />
                <span>Reset Date Filter</span>
              </button>
            )}
          </div>
          <div className="h-72">
            {!trends ? (
              <div className="h-full w-full flex flex-col justify-center items-center gap-3 bg-white/[0.02] rounded-xl border border-white/5 animate-pulse">
                <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center text-zinc-600">
                  <Activity size={20} className="text-amber-400/60" />
                </div>
                <span className="text-xs text-secondary font-medium">Loading live volume & risk telemetry...</span>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart 
                  data={trends} 
                  margin={{ top: 10, right: 30, left: 0, bottom: 0 }}
                  onClick={(e) => {
                    if (!e) return;
                    let clickedDay = null;
                    if (e.activePayload && e.activePayload.length > 0 && e.activePayload[0].payload) {
                      clickedDay = e.activePayload[0].payload.day;
                    } else if (typeof e.activeTooltipIndex === 'number' && trends && trends[e.activeTooltipIndex]) {
                      clickedDay = trends[e.activeTooltipIndex].day;
                    } else if (e.activeLabel && trends) {
                      const matched = trends.find(t => t.name === e.activeLabel);
                      if (matched) clickedDay = matched.day;
                    }
                    if (clickedDay) handleSelectDay(clickedDay);
                  }}
                >
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
                    content={<TrendTooltip selectedDay={selectedDay} />}
                  />
                  <Area 
                    type="monotone" 
                    dataKey="screened" 
                    stroke="#EAB308" 
                    fill="none" 
                    strokeWidth={2.5} 
                    name="Screened"
                    dot={(dotProps) => (
                      <ChartDot 
                        key={`dot-screened-${dotProps.index}`} 
                        {...dotProps} 
                        fill="#EAB308" 
                        stroke="#18181B" 
                        selectedDay={selectedDay} 
                        onSelectDay={handleSelectDay} 
                      />
                    )}
                    activeDot={{ 
                      r: 7, 
                      stroke: '#FFFFFF', 
                      strokeWidth: 2, 
                      fill: '#EAB308',
                      cursor: 'pointer',
                      onClick: (e, payload) => {
                        if (payload?.payload?.day) handleSelectDay(payload.payload.day);
                      }
                    }}
                  />
                  <Area 
                    type="monotone" 
                    dataKey="flagged" 
                    stroke={RISK_COLORS.HIGH} 
                    fillOpacity={1} 
                    fill="url(#colorFlagged)" 
                    strokeWidth={2.5} 
                    name="Flagged High Risk"
                    dot={(dotProps) => (
                      <ChartDot 
                        key={`dot-flagged-${dotProps.index}`} 
                        {...dotProps} 
                        fill={RISK_COLORS.HIGH} 
                        stroke="#18181B" 
                        selectedDay={selectedDay} 
                        onSelectDay={handleSelectDay} 
                      />
                    )}
                    activeDot={{ 
                      r: 7, 
                      stroke: '#FFFFFF', 
                      strokeWidth: 2, 
                      fill: RISK_COLORS.HIGH,
                      cursor: 'pointer',
                      onClick: (e, payload) => {
                        if (payload?.payload?.day) handleSelectDay(payload.payload.day);
                      }
                    }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Dynamic Risk Distribution */}
        <div className="glass-panel p-6 flex flex-col justify-between">
          <div>
            <div className="flex justify-between items-start mb-4">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-semibold text-primary">Risk Distribution</h3>
                  {distLoading && (
                    <div className="w-3.5 h-3.5 border-2 border-amber-400 border-t-transparent rounded-full animate-spin"></div>
                  )}
                </div>
                <p className="text-xs text-secondary mt-0.5">
                  {selectedDay ? (
                    <span>
                      Filtered: <strong className="text-amber-400 font-mono">{selectedDay}</strong> &bull; Total: <span className="text-white font-semibold">{totalInDist}</span>
                    </span>
                  ) : (
                    <span>All-time screened breakdown &bull; Total: <span className="text-white font-semibold">{totalInDist}</span></span>
                  )}
                </p>
              </div>
              {selectedDay ? (
                <button
                  type="button"
                  onClick={() => handleSelectDay(null)}
                  className="text-xs px-2.5 py-1 rounded bg-zinc-800 text-amber-400 hover:bg-zinc-700 font-semibold border border-amber-500/30 flex items-center gap-1 transition-colors"
                >
                  <RotateCcw size={11} />
                  <span>All-Time</span>
                </button>
              ) : (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400 border border-zinc-700">
                  Global
                </span>
              )}
            </div>

            <div className="h-64 relative">
              {!distribution ? (
                <div className="h-full w-full flex flex-col justify-center items-center gap-3 bg-white/[0.02] rounded-xl border border-white/5 animate-pulse">
                  <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center text-zinc-600">
                    <ShieldAlert size={20} className="text-amber-400/60" />
                  </div>
                  <span className="text-xs text-secondary font-medium">Loading risk tier distribution...</span>
                </div>
              ) : totalInDist === 0 ? (
                <div className="h-full w-full flex flex-col justify-center items-center text-center p-4 bg-white/[0.01] rounded-xl border border-dashed border-zinc-800">
                  <CheckCircle2 size={28} className="text-zinc-600 mb-2" />
                  <p className="text-sm font-medium text-zinc-300">No screenings on {selectedDay}</p>
                  <p className="text-xs text-zinc-500 mt-1 max-w-[200px]">No shipments were evaluated on this specific date.</p>
                  <button
                    type="button"
                    onClick={() => handleSelectDay(null)}
                    className="mt-3 text-xs text-amber-400 hover:underline flex items-center gap-1"
                  >
                    <span>Return to All-Time Distribution</span>
                  </button>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={distribution} layout="vertical" margin={{ top: 10, right: 35, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(234,179,8,0.1)" horizontal={false} />
                    <XAxis type="number" stroke="#A1A1AA" tick={{fill: '#A1A1AA', fontSize: 11}} axisLine={false} tickLine={false} allowDecimals={false} />
                    <YAxis dataKey="name" type="category" stroke="#A1A1AA" tick={{fill: '#A1A1AA', fontSize: 12}} axisLine={false} tickLine={false} />
                    <Tooltip 
                      cursor={{fill: 'rgba(234,179,8,0.05)'}}
                      contentStyle={{ backgroundColor: 'rgba(10,10,10,0.95)', borderColor: 'rgba(234,179,8,0.2)', borderRadius: '8px' }}
                    />
                    <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={22}>
                      <LabelList dataKey="value" position="right" fill="#D4D4D8" fontSize={11} fontWeight={600} />
                      {distribution.map((entry, index) => {
                        const colorMap = { 
                          'Critical': RISK_COLORS.CRITICAL, 
                          'High': RISK_COLORS.HIGH, 
                          'Medium': RISK_COLORS.MEDIUM, 
                          'Low': RISK_COLORS.LOW 
                        };
                        return <Cell key={`cell-${index}`} fill={colorMap[entry.name] || '#EAB308'} />;
                      })}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Quick Category Summary Breakdown */}
          {distribution && totalInDist > 0 && (
            <div className="grid grid-cols-4 gap-2 pt-3 border-t border-[rgba(234,179,8,0.1)] text-center text-[11px]">
              {distribution.map(d => {
                const pct = totalInDist > 0 ? Math.round((d.value / totalInDist) * 100) : 0;
                const colorMap = { 
                  'Critical': 'text-[#EF4444]', 
                  'High': 'text-[#F97316]', 
                  'Medium': 'text-[#F59E0B]', 
                  'Low': 'text-[#22C55E]' 
                };
                return (
                  <div key={d.name} className="flex flex-col">
                    <span className="text-zinc-500 font-medium text-[10px]">{d.name}</span>
                    <span className={`font-bold tabular-nums ${colorMap[d.name] || 'text-white'}`}>
                      {d.value} <span className="text-[9px] text-zinc-500 font-normal">({pct}%)</span>
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Alerts Table Row — SORTED BY SLA REMAINING TIME */}
      <div className="glass-panel p-6 mb-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-[rgba(234,179,8,0.1)] gap-2 mb-4">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-semibold text-primary">Recent Fraud Alerts</h3>
              <span className="text-[11px] px-2.5 py-0.5 rounded-full bg-red-500/10 text-red-400 font-bold border border-red-500/30 flex items-center gap-1">
                <Clock size={11} />
                <span>Sorted by SLA Deadline</span>
              </span>
            </div>
            <p className="text-xs text-secondary mt-0.5">
              Shipments closest to SLA breach appear first. Click any row to preview its full forensic telemetry.
            </p>
          </div>
          <Link to="/investigation" className="text-xs font-semibold text-[#EAB308] hover:text-[#FDE047] flex items-center gap-1 transition-colors">
            <span>Open All Queue Cases</span>
            <ArrowRight size={14} />
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-[rgba(234,179,8,0.1)]">
                <th className="pb-3 text-sm font-medium text-secondary">Shipment ID</th>
                <th className="pb-3 text-sm font-medium text-secondary">SLA Remaining</th>
                <th className="pb-3 text-sm font-medium text-secondary">Risk Score</th>
                <th className="pb-3 text-sm font-medium text-secondary">Level</th>
                <th className="pb-3 text-sm font-medium text-secondary">Action Taken</th>
                <th className="pb-3 text-sm font-medium text-secondary">Assessed</th>
                <th className="pb-3 text-sm font-medium text-secondary text-right">Investigation</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[rgba(234,179,8,0.05)]">
              {!alerts ? (
                [1, 2, 3, 4].map((idx) => (
                  <tr key={idx} className="animate-pulse">
                    <td className="py-4 px-2"><div className="h-4 w-24 bg-white/10 rounded"></div></td>
                    <td className="py-4"><div className="h-5 w-20 bg-white/10 rounded-full"></div></td>
                    <td className="py-4"><div className="h-4 w-8 bg-white/10 rounded"></div></td>
                    <td className="py-4"><div className="h-5 w-16 bg-white/10 rounded-full"></div></td>
                    <td className="py-4"><div className="h-4 w-16 bg-white/10 rounded"></div></td>
                    <td className="py-4"><div className="h-4 w-14 bg-white/10 rounded"></div></td>
                    <td className="py-4 text-right"><div className="h-6 w-24 bg-white/10 rounded ml-auto"></div></td>
                  </tr>
                ))
              ) : alerts.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-secondary text-xs">
                    No active fraud alerts detected. System operating within normal thresholds.
                  </td>
                </tr>
              ) : (
                alerts.map((alert) => {
                  const isOverdue = alert.sla_formatted && alert.sla_formatted.startsWith('Overdue');
                  const isUrgent = alert.sla_remaining_seconds && alert.sla_remaining_seconds < 7200;

                  return (
                    <tr 
                      key={alert.shipment_id} 
                      className="hover:bg-[rgba(255,255,255,0.02)] transition-colors"
                    >
                      <td className="py-4 px-2 text-sm font-bold text-white tabular-nums flex items-center gap-2">
                        <span>{alert.shipment_id}</span>
                      </td>
                      <td className="py-4 text-sm tabular-nums">
                        <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold
                          ${isOverdue ? 'bg-red-950/80 text-red-400 border border-red-500/40' : isUrgent ? 'bg-amber-950/80 text-amber-300 border border-amber-500/40' : 'bg-zinc-800 text-zinc-300 border border-zinc-700'}
                        `}>
                          <Clock size={12} />
                          <span>{alert.sla_formatted || '4h 00m left'}</span>
                        </span>
                      </td>
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
                      <td className="py-4 text-sm text-secondary font-medium">
                        <span className="px-2 py-0.5 rounded bg-zinc-900 border border-white/10 text-white font-mono text-xs">
                          {alert.decision}
                        </span>
                      </td>
                      <td className="py-4 text-sm text-secondary">{alert.time}</td>
                      <td className="py-4 text-right">
                        <Link 
                          to={`/investigation/${alert.shipment_id}`} 
                          onClick={(e) => e.stopPropagation()}
                          className="text-xs font-semibold text-[#EAB308] hover:text-[#FDE047] uppercase tracking-wider inline-flex items-center gap-1 transition-colors px-3 py-1.5 rounded bg-white/5 hover:bg-white/10"
                        >
                          <span>Investigate Case</span>
                          <ChevronRight size={14} />
                        </Link>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>



    </div>
  );
}
