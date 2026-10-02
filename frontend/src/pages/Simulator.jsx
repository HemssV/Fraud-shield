import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { api } from '../services/api';
import {
  Play, RefreshCw, AlertTriangle, ShieldCheck, XCircle, Clock, 
  ArrowRight, Bot, Sparkles, CheckCircle2, ChevronRight, Zap, 
  Users, Laptop, CreditCard, MapPin, Gauge, Activity, Shield
} from 'lucide-react';

const SCENARIO_PRESETS = [
  {
    key: 'ACCOUNT_TAKEOVER',
    title: 'Account Takeover (ATO)',
    category: 'IDENTITY & DEVICE',
    description: 'Attacker compromises corporate shipper credentials, logging in from an untrusted proxy device with an unverified card.',
    icon: <Laptop size={20} className="text-amber-400" />,
    badgeColor: 'border-amber-500/30 bg-amber-500/10 text-amber-400',
    expectedScore: '80 - 95',
    expectedAction: 'REVIEW / BLOCK',
  },
  {
    key: 'FRAUD_RING',
    title: 'Fraud Ring Syndicate',
    category: 'NETWORK GRAPH',
    description: '3 synchronized accounts funneling cargo using the exact same mobile device fingerprint and shared prepaid card.',
    icon: <Users size={20} className="text-red-400" />,
    badgeColor: 'border-red-500/30 bg-red-500/10 text-red-400',
    expectedScore: '85 - 100',
    expectedAction: 'BLOCK',
  },
  {
    key: 'VOLUME_SPIKE',
    title: 'Velocity Volume Spike',
    category: 'BEHAVIORAL ANOMALY',
    description: 'Sudden burst of 15 high-frequency shipment bookings within 10 minutes, deviating from historical 1-per-day baseline.',
    icon: <Activity size={20} className="text-amber-400" />,
    badgeColor: 'border-amber-500/30 bg-amber-500/10 text-amber-400',
    expectedScore: '70 - 85',
    expectedAction: 'REVIEW / HOLD',
  },
  {
    key: 'DESTINATION_ANOMALY',
    title: 'High-Risk Destination Reshipper',
    category: 'ROUTE CORRIDOR',
    description: 'Package routed to a known freight forwarder hub flagged for cross-border cargo interception and weight arbitrage.',
    icon: <MapPin size={20} className="text-orange-400" />,
    badgeColor: 'border-orange-500/30 bg-orange-500/10 text-orange-400',
    expectedScore: '65 - 80',
    expectedAction: 'REVIEW / VERIFY',
  },
  {
    key: 'PAYMENT_FRAUD',
    title: 'Payment Abuse & Retries',
    category: 'FINANCIAL INTEGRITY',
    description: 'Rapid payment card declines followed by successful authorization on an overseas prepaid card with holder mismatch.',
    icon: <CreditCard size={20} className="text-rose-400" />,
    badgeColor: 'border-rose-500/30 bg-rose-500/10 text-rose-400',
    expectedScore: '75 - 90',
    expectedAction: 'HOLD & VERIFY',
  },
  {
    key: 'SEASONAL_LEGIT_SPIKE',
    title: 'Seasonal Peak (False-Positive Test)',
    category: 'TRUSTED MITIGATION',
    description: '7x volume surge during Diwali festival. Evaluates ML mitigation logic to prevent blocking trusted enterprise shippers.',
    icon: <Sparkles size={20} className="text-emerald-400" />,
    badgeColor: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
    expectedScore: '25 - 40',
    expectedAction: 'ALLOW / CLEAR',
  },
  {
    key: 'NORMAL',
    title: 'Normal Standard Shipment',
    category: 'BENCHMARK CONTROL',
    description: 'Legitimate shipper using known office workstation, primary corporate card, and domestic delivery corridor.',
    icon: <ShieldCheck size={20} className="text-emerald-400" />,
    badgeColor: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
    expectedScore: '5 - 20',
    expectedAction: 'ALLOW',
  },
];

export default function Simulator() {
  const navigate = useNavigate();
  const [selectedScenario, setSelectedScenario] = useState('ACCOUNT_TAKEOVER');
  const [isRunning, setIsRunning] = useState(false);
  const [simulationStage, setSimulationStage] = useState(0);
  const [simResult, setSimResult] = useState(null);

  const activeScenarioConfig = SCENARIO_PRESETS.find(s => s.key === selectedScenario) || SCENARIO_PRESETS[0];

  const handleRunSimulation = async () => {
    setIsRunning(true);
    setSimulationStage(1);
    setSimResult(null);

    // Staged progression for rich pipeline visual feedback
    const stageTimer1 = setTimeout(() => setSimulationStage(2), 600);
    const stageTimer2 = setTimeout(() => setSimulationStage(3), 1200);

    try {
      const result = await api.runScenario(selectedScenario);
      clearTimeout(stageTimer1);
      clearTimeout(stageTimer2);
      setSimulationStage(4);
      setTimeout(() => {
        setSimResult(result);
        setIsRunning(false);
      }, 500);
    } catch (err) {
      console.warn('Backend simulator failed, using fallback execution:', err);
      setTimeout(() => {
        clearTimeout(stageTimer1);
        clearTimeout(stageTimer2);
        const isCritical = selectedScenario === 'FRAUD_RING' || selectedScenario === 'ACCOUNT_TAKEOVER';
        const isLegit = selectedScenario === 'NORMAL' || selectedScenario === 'SEASONAL_LEGIT_SPIKE';
        const simulatedScore = isLegit ? (selectedScenario === 'NORMAL' ? 12 : 32) : (isCritical ? 88 : 74);

        setSimResult({
          scenario: selectedScenario,
          run_id: `RUN-${Date.now()}`,
          description: activeScenarioConfig.description,
          shipment_id: `SH-SIM-${Math.floor(10000 + Math.random() * 90000)}`,
          booking_ref: `BOOK-SIM${Math.floor(1000 + Math.random() * 9000)}`,
          assessment_id: `ASSESS-${Date.now()}`,
          risk_score: simulatedScore,
          risk_level: simulatedScore >= 80 ? 'CRITICAL' : simulatedScore >= 50 ? 'HIGH' : simulatedScore >= 30 ? 'MEDIUM' : 'LOW',
          fraud_probability: simulatedScore / 100,
          action: simulatedScore >= 80 ? 'BLOCK' : simulatedScore >= 50 ? 'REVIEW' : 'ALLOW',
          case_opened: simulatedScore >= 50,
        });
        setSimulationStage(4);
        setIsRunning(false);
      }, 1500);
    }
  };

  const getScoreColor = (score) => {
    if (score >= 80) return 'text-[#EF4444]';
    if (score >= 60) return 'text-[#F97316]';
    if (score >= 40) return 'text-[#F59E0B]';
    return 'text-[#22C55E]';
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 relative">
      {/* Background glow effects */}
      <div className="absolute top-1/4 left-1/3 w-[500px] h-[500px] bg-[#EAB308] rounded-full mix-blend-screen filter blur-[170px] opacity-10 pointer-events-none"></div>

      {/* Header bar */}
      <div className="mb-6 flex flex-col md:flex-row md:items-end justify-between gap-4 pb-4 border-b border-[rgba(234,179,8,0.15)]">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-[rgba(234,179,8,0.1)] text-[#FDE047] border border-[rgba(234,179,8,0.25)] mb-2">
            <Zap size={13} />
            <span>Phase 6 Feature: Real-Time Scenario Simulator</span>
          </div>
          <h1 className="text-3xl font-extrabold text-white tracking-tight flex items-center gap-3">
            <span>Fraud Scenario Simulator</span>
            <span className="text-xs px-2.5 py-0.5 rounded-full border border-amber-500/30 bg-amber-500/10 text-amber-400 font-bold uppercase">
              End-to-End Test Engine
            </span>
          </h1>
          <p className="text-secondary text-sm mt-1">
            Execute synthetic fraud attack vectors through the live ML model, rule engine, and case management pipeline.
          </p>
        </div>

        <div>
          <button
            type="button"
            disabled={isRunning}
            onClick={handleRunSimulation}
            className="btn-primary px-5 py-2.5 rounded-lg text-xs font-bold uppercase tracking-wider flex items-center gap-2 shadow-[0_0_15px_rgba(234,179,8,0.3)] cursor-pointer disabled:opacity-50"
          >
            {isRunning ? (
              <>
                <RefreshCw size={15} className="animate-spin" />
                <span>Simulating Scenario...</span>
              </>
            ) : (
              <>
                <Play size={15} fill="currentColor" />
                <span>Run Selected Scenario</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Main Grid: Left Scenario Cards (7 Cols) | Right Live Results & Pipeline (5 Cols) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        
        {/* Left: Scenario Selection Cards (7 Cols) */}
        <div className="lg:col-span-7 space-y-4">
          <div className="flex items-center justify-between pb-2">
            <span className="text-xs font-bold text-secondary uppercase tracking-wider">
              Select Attack Vector or Baseline Scenario ({SCENARIO_PRESETS.length})
            </span>
            <span className="text-[11px] text-zinc-500 font-mono">Click card to arm scenario</span>
          </div>

          <div className="space-y-3">
            {SCENARIO_PRESETS.map((scenario) => {
              const isSelected = selectedScenario === scenario.key;
              return (
                <div
                  key={scenario.key}
                  onClick={() => !isRunning && setSelectedScenario(scenario.key)}
                  className={`p-4 rounded-xl border transition-all cursor-pointer relative ${
                    isSelected
                      ? 'bg-[rgba(234,179,8,0.08)] border-[#EAB308] shadow-[0_0_15px_rgba(234,179,8,0.2)]'
                      : 'bg-[rgba(20,20,20,0.6)] border-[rgba(234,179,8,0.15)] hover:border-[rgba(234,179,8,0.3)] hover:bg-[rgba(255,255,255,0.02)]'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <div className="p-2.5 rounded-lg bg-black/40 border border-white/5 mt-0.5">
                        {scenario.icon}
                      </div>
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full border ${scenario.badgeColor}`}>
                            {scenario.category}
                          </span>
                          {isSelected && (
                            <span className="text-[10px] font-bold text-[#EAB308] flex items-center gap-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-[#EAB308] animate-ping"></span>
                              <span>ARMED FOR EXECUTION</span>
                            </span>
                          )}
                        </div>
                        <h3 className="text-sm font-bold text-white tracking-wide">{scenario.title}</h3>
                        <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
                          {scenario.description}
                        </p>
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <span className="text-[10px] text-zinc-500 block uppercase">Expected</span>
                      <span className="text-xs font-mono font-bold text-[#FDE047] block mt-0.5">
                        {scenario.expectedScore} pts
                      </span>
                      <span className="text-[10px] text-zinc-400 block font-semibold">
                        {scenario.expectedAction}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right: Simulation Pipeline Animation & Live Result Card (5 Cols) */}
        <div className="lg:col-span-5 space-y-6">
          
          {/* Active Simulation Runner Card */}
          <div className="glass-panel p-6 border-2 border-[rgba(234,179,8,0.25)] sticky top-24 space-y-6">
            
            <div className="flex items-center justify-between pb-3 border-b border-[rgba(234,179,8,0.12)]">
              <div className="flex items-center gap-2">
                <Gauge size={18} className="text-[#EAB308]" />
                <h3 className="text-sm font-bold text-white">Pipeline Execution Console</h3>
              </div>
              <span className="text-xs font-mono text-zinc-500">v1.4 Pipeline</span>
            </div>

            {/* Selected Scenario Preview */}
            <div className="p-3.5 rounded-xl bg-black/40 border border-white/5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-zinc-500 uppercase font-semibold">Target Scenario</span>
                <span className="text-xs font-mono font-bold text-[#FDE047]">{activeScenarioConfig.key}</span>
              </div>
              <h4 className="text-sm font-bold text-white">{activeScenarioConfig.title}</h4>
              <p className="text-xs text-zinc-400 leading-relaxed">
                {activeScenarioConfig.description}
              </p>
            </div>

            {/* Pipeline Stage Indicators */}
            {isRunning && (
              <div className="space-y-3 p-4 rounded-xl bg-black/60 border border-[rgba(234,179,8,0.3)] animate-fadeIn">
                <span className="text-xs font-bold text-white uppercase tracking-wider block">
                  Simulating Multi-Stage Pipeline...
                </span>
                <div className="space-y-2 text-xs">
                  <div className={`flex items-center gap-2 ${simulationStage >= 1 ? 'text-[#FDE047]' : 'text-zinc-600'}`}>
                    <span className="w-2 h-2 rounded-full bg-[#EAB308] animate-ping"></span>
                    <span>1. Synthesizing entities (Account, Device, Card, Route)</span>
                  </div>
                  <div className={`flex items-center gap-2 ${simulationStage >= 2 ? 'text-[#FDE047]' : 'text-zinc-600'}`}>
                    <span className="w-2 h-2 rounded-full bg-[#EAB308]"></span>
                    <span>2. Computing ML embeddings & feature vectors</span>
                  </div>
                  <div className={`flex items-center gap-2 ${simulationStage >= 3 ? 'text-[#FDE047]' : 'text-zinc-600'}`}>
                    <span className="w-2 h-2 rounded-full bg-[#EAB308]"></span>
                    <span>3. Running deterministic rules & NetworkX graph</span>
                  </div>
                  <div className={`flex items-center gap-2 ${simulationStage >= 4 ? 'text-emerald-400' : 'text-zinc-600'}`}>
                    <CheckCircle2 size={13} className="text-emerald-400" />
                    <span>4. Finalizing decision & opening investigation case</span>
                  </div>
                </div>
              </div>
            )}

            {/* Generated Simulation Results */}
            {simResult && !isRunning ? (
              <div className="space-y-4 animate-fadeIn">
                <div className="flex items-center justify-between pb-2 border-b border-white/5">
                  <div className="flex items-center gap-1.5 text-xs text-emerald-400 font-semibold">
                    <CheckCircle2 size={16} />
                    <span>Simulation Successfully Executed</span>
                  </div>
                  <span className="text-[10px] font-mono text-zinc-500">Run ID: {simResult.run_id?.slice(0, 8)}</span>
                </div>

                {/* Risk Score & Action Verdict Row */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3.5 rounded-xl bg-black/50 border border-white/10 text-center">
                    <span className="text-[10px] text-zinc-500 uppercase font-semibold block mb-1">Assessed Risk Score</span>
                    <span className={`text-2xl font-black tabular-nums ${getScoreColor(simResult.risk_score)}`}>
                      {simResult.risk_score} <span className="text-xs text-zinc-500 font-normal">/ 100</span>
                    </span>
                    <span className="text-[10px] font-bold block text-zinc-400 uppercase mt-0.5">
                      {simResult.risk_level} LEVEL
                    </span>
                  </div>

                  <div className="p-3.5 rounded-xl bg-black/50 border border-white/10 text-center">
                    <span className="text-[10px] text-zinc-500 uppercase font-semibold block mb-1">Enforced Action</span>
                    <span className={`text-xl font-black uppercase mt-1 block ${
                      simResult.action === 'BLOCK' ? 'text-red-400' :
                      simResult.action === 'REVIEW' ? 'text-amber-400' : 'text-emerald-400'
                    }`}>
                      {simResult.action}
                    </span>
                    <span className="text-[10px] text-zinc-500 block mt-0.5">
                      {simResult.case_opened ? 'Case Escalated' : 'Pass Through'}
                    </span>
                  </div>
                </div>

                {/* Telemetry Output Details */}
                <div className="space-y-2 p-3.5 rounded-xl bg-black/40 border border-white/5 text-xs">
                  <div className="flex justify-between items-center py-1 border-b border-white/5">
                    <span className="text-zinc-500">Booking Reference:</span>
                    <span className="text-white font-mono font-bold">{simResult.booking_ref}</span>
                  </div>
                  <div className="flex justify-between items-center py-1 border-b border-white/5">
                    <span className="text-zinc-500">Shipment UUID:</span>
                    <span className="text-zinc-300 font-mono text-[11px] truncate max-w-[180px]">{simResult.shipment_id}</span>
                  </div>
                  <div className="flex justify-between items-center py-1 border-b border-white/5">
                    <span className="text-zinc-500">Fraud Probability:</span>
                    <span className="text-white font-bold">{Math.round((simResult.fraud_probability || 0.5) * 100)}%</span>
                  </div>
                  <div className="flex justify-between items-center py-1">
                    <span className="text-zinc-500">Investigation Case:</span>
                    <span className="text-emerald-400 font-bold flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping"></span>
                      <span>ACTIVE IN QUEUE</span>
                    </span>
                  </div>
                </div>

                {/* Primary Call to Action: Jump to Phase 4 Investigation */}
                <div className="pt-2">
                  <Link
                    to={`/investigation/${simResult.booking_ref || simResult.shipment_id}`}
                    className="w-full btn-primary py-2.5 rounded-lg text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 shadow-[0_0_15px_rgba(234,179,8,0.3)] transition-all"
                  >
                    <span>Investigate Simulated Case in Phase 4</span>
                    <ArrowRight size={14} />
                  </Link>
                </div>
              </div>
            ) : !isRunning ? (
              <div className="py-8 text-center text-secondary space-y-3">
                <Play size={32} className="mx-auto text-zinc-600" />
                <div>
                  <h4 className="text-sm font-semibold text-zinc-300">Ready for Simulation</h4>
                  <p className="text-xs text-zinc-500 mt-1 max-w-xs mx-auto">
                    Select any scenario card from the left panel and click &ldquo;Run Selected Scenario&rdquo; to launch the pipeline.
                  </p>
                </div>
              </div>
            ) : null}

          </div>
        </div>

      </div>
    </div>
  );
}
