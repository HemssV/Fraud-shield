import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import { 
  ShieldCheck, ShieldAlert, AlertTriangle, XCircle, CheckCircle2, 
  ArrowRight, RefreshCw, Cpu, Database, Fingerprint, Network, 
  Zap, Clock, Package, MapPin, CreditCard, Laptop, Sparkles, Send, RotateCcw
} from 'lucide-react';

// ─── [HARDCODED DATA / DEMO PRESETS] ─────────────────────────────────────────
// Preset booking payloads provided for rapid testing and hackathon demo evaluation.
// Users can click these or type custom inputs into the screening form.
const PRESETS = [
  {
    name: 'Normal Standard Shipment',
    desc: 'Verified shipper, usual route & weight',
    badge: 'Low Risk',
    badgeColor: 'border-emerald-500/40 text-emerald-400 bg-emerald-500/10',
    data: {
      shipper_id: 'S1001',
      origin: 'Chennai',
      destination: 'Delhi',
      weight: 12.5,
      service_type: 'GROUND',
      payment_id: 'P19',
      device_id: 'D88',
      package_count: 1,
    }
  },
  {
    name: 'Suspended Account Anomaly',
    desc: 'Shipper under investigation, heavy package',
    badge: 'High Risk',
    badgeColor: 'border-amber-500/40 text-amber-400 bg-amber-500/10',
    data: {
      shipper_id: 'S4004',
      origin: 'Kolkata',
      destination: 'Delhi',
      weight: 48.0,
      service_type: 'EXPRESS',
      payment_id: 'P17',
      device_id: 'D77',
      package_count: 6,
    }
  },
  {
    name: 'High-Weight Suspicious Route',
    desc: 'Extreme weight spike (200kg) to high-risk destination',
    badge: 'Critical Risk',
    badgeColor: 'border-red-500/40 text-red-400 bg-red-500/10',
    data: {
      shipper_id: 'S2002',
      origin: 'Chennai',
      destination: 'Kabul',
      weight: 200.0,
      service_type: 'EXPRESS',
      payment_id: 'P15',
      device_id: 'D99',
      package_count: 12,
    }
  }
];

const PIPELINE_STEPS = [
  { id: 1, name: 'Payload Ingestion & Validation', icon: <Database size={16} />, desc: 'Checking schema, normalizing address entities' },
  { id: 2, name: 'Feature & Baseline Extraction', icon: <Zap size={16} />, desc: 'Computing velocity, z-scores & profile deviations' },
  { id: 3, name: 'Deterministic Rule Engine', icon: <ShieldCheck size={16} />, desc: 'Evaluating 20+ historical risk and velocity rules' },
  { id: 4, name: 'Machine Learning Model Scoring', icon: <Cpu size={16} />, desc: 'Executing XGBoost anomaly & probability model' },
  { id: 5, name: 'Risk Fusion & Decision Synthesis', icon: <Sparkles size={16} />, desc: 'Synthesizing composite risk score & SLA threshold' }
];

export default function Screening() {
  const navigate = useNavigate();

  // Form state
  const [formData, setFormData] = useState({
    shipper_id: 'S1001',
    origin: 'Chennai',
    destination: 'Delhi',
    weight: '25.0',
    service_type: 'EXPRESS',
    payment_id: 'P19',
    device_id: 'D88',
    package_count: '2',
  });

  // Pipeline execution state
  const [isScreening, setIsScreening] = useState(false);
  const [activePipelineStep, setActivePipelineStep] = useState(0);
  const [assessmentResult, setAssessmentResult] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);
  /** @type {'live' | 'simulated' | null} */
  const [resultSource, setResultSource] = useState(null);
  const pipelineTimerRef = useRef(null);

  useEffect(() => {
    return () => {
      if (pipelineTimerRef.current) clearInterval(pipelineTimerRef.current);
    };
  }, []);

  const startPipelineAnimation = () => {
    if (pipelineTimerRef.current) clearInterval(pipelineTimerRef.current);
    setActivePipelineStep(1);
    pipelineTimerRef.current = setInterval(() => {
      setActivePipelineStep((prev) => (prev >= 4 ? 4 : prev + 1));
    }, 450);
  };

  const stopPipelineAnimation = () => {
    if (pipelineTimerRef.current) {
      clearInterval(pipelineTimerRef.current);
      pipelineTimerRef.current = null;
    }
    setActivePipelineStep(5);
  };

  const clearResult = () => {
    setAssessmentResult(null);
    setResultSource(null);
    setErrorMsg(null);
    setActivePipelineStep(0);
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const loadPreset = (preset) => {
    setFormData({
      shipper_id: preset.data.shipper_id,
      origin: preset.data.origin,
      destination: preset.data.destination,
      weight: String(preset.data.weight),
      service_type: preset.data.service_type,
      payment_id: preset.data.payment_id,
      device_id: preset.data.device_id,
      package_count: String(preset.data.package_count),
    });
    clearResult();
  };

  const buildSimulatedResult = (payload) => {
    const simulatedWeight = parseFloat(formData.weight) || 10;
    const isHigh = simulatedWeight > 100 || formData.shipper_id === 'S4004' || formData.destination.toLowerCase() === 'kabul';
    const isMed = simulatedWeight > 40;

    const score = isHigh ? 88 : (isMed ? 58 : 24);
    const level = isHigh ? 'CRITICAL' : (isMed ? 'HIGH' : 'LOW');
    const action = isHigh ? 'BLOCK' : (isMed ? 'REVIEW' : 'ALLOW');

    return {
      booking: {
        shipment_id: `SH${Math.random().toString(36).substring(2, 8).toUpperCase()}`,
        ...payload,
        status: isHigh ? 'BLOCKED' : (isMed ? 'HELD' : 'ALLOWED'),
        created_at: new Date().toISOString(),
      },
      fraud_assessment: {
        risk: {
          risk_score: score,
          risk_level: level,
          fraud_probability: score / 100,
        },
        decision: {
          action,
          reason: isHigh
            ? 'Severe risk detected: High-risk route & profile anomaly'
            : (isMed ? 'Elevated weight anomaly requires analyst review' : 'Routine shipment passed all baseline checks'),
        },
        signals: {
          behavioral: isHigh ? 45 : (isMed ? 25 : 5),
          identity: isHigh ? 35 : (isMed ? 20 : 8),
          payment: isHigh ? 28 : (isMed ? 15 : 6),
          device: isHigh ? 30 : (isMed ? 12 : 4),
          address: isHigh ? 40 : (isMed ? 18 : 2),
          velocity: isHigh ? 22 : 0,
        },
        top_reasons: isHigh ? [
          `Shipment weight of ${simulatedWeight}kg significantly deviates from baseline`,
          'Destination is classified as an elevated-risk routing tier',
          'Device fingerprint has shared linkages to previously flagged entities',
        ] : (isMed ? [
          'Weight ratio exceeds 2.5x the account historical average',
          'Payment method registered recently without settled history',
        ] : [
          'Shipper account in good standing with established velocity',
          'Device fingerprint matches primary recognized terminal',
        ]),
        component_scores: {
          rule_score: isHigh ? 85 : (isMed ? 62 : 20),
          ml_score: isHigh ? 89 : (isMed ? 54 : 26),
          device_risk_score: isHigh ? 75 : 30,
          address_confidence: isHigh ? 0.45 : 0.92,
        },
        model: { model_version: 'offline-simulation', rules_version: 'n/a' },
        pipeline: { total_latency_ms: 185 },
      },
    };
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsScreening(true);
    setErrorMsg(null);
    setAssessmentResult(null);
    setResultSource(null);
    startPipelineAnimation();

    const payload = {
      shipper_id: formData.shipper_id.trim(),
      origin: formData.origin.trim(),
      destination: formData.destination.trim(),
      weight: parseFloat(formData.weight) || 1.0,
      service_type: formData.service_type,
      payment_id: formData.payment_id.trim(),
      device_id: formData.device_id.trim(),
      package_count: parseInt(formData.package_count, 10) || 1,
      booking_timestamp: new Date().toISOString(),
      simulate: true
    };

    try {
      const data = await api.screenShipment(payload);
      stopPipelineAnimation();
      setAssessmentResult(data);
      setResultSource('live');
      setIsScreening(false);
    } catch (err) {
      const status = err.response?.status;
      const apiMessage =
        err.response?.data?.error?.message ||
        err.response?.data?.message ||
        err.message;

      // Validation / client errors: show message — do not mask with demo data
      if (status && status >= 400 && status < 500) {
        stopPipelineAnimation();
        setActivePipelineStep(0);
        setErrorMsg(apiMessage || 'Request rejected by the screening API. Check your inputs.');
        setIsScreening(false);
        console.error('Screening validation failed:', apiMessage);
        return;
      }

      console.warn('Backend unreachable — using offline simulation:', err);
      setErrorMsg('Node screening API unavailable — showing offline demo scores only.');

      setTimeout(() => {
        stopPipelineAnimation();
        setAssessmentResult(buildSimulatedResult(payload));
        setResultSource('simulated');
        setIsScreening(false);
      }, 800);
    }
  };

  const getDecisionBadge = (action) => {
    switch (action) {
      case 'ALLOW':
      case 'ALLOW_MONITOR':
        return {
          label: action === 'ALLOW_MONITOR' ? 'ALLOW & MONITOR' : 'ALLOW SHIPMENT',
          icon: <CheckCircle2 className="text-[#22C55E]" size={28} />,
          badgeClass: 'bg-[rgba(34,197,94,0.15)] text-[#22C55E] border-[#22C55E]/40',
          titleColor: 'text-[#22C55E]',
          bgGradient: 'from-emerald-950/30 to-black'
        };
      case 'VERIFY':
        return {
          label: 'CHALLENGE VERIFICATION',
          icon: <ShieldAlert className="text-[#38BDF8]" size={28} />,
          badgeClass: 'bg-[rgba(56,189,248,0.15)] text-[#38BDF8] border-[#38BDF8]/40',
          titleColor: 'text-[#38BDF8]',
          bgGradient: 'from-sky-950/30 to-black'
        };
      case 'REVIEW':
        return {
          label: 'HOLD FOR REVIEW',
          icon: <AlertTriangle className="text-[#F59E0B]" size={28} />,
          badgeClass: 'bg-[rgba(245,158,11,0.15)] text-[#F59E0B] border-[#F59E0B]/40',
          titleColor: 'text-[#F59E0B]',
          bgGradient: 'from-amber-950/30 to-black'
        };
      case 'BLOCK':
      default:
        return {
          label: 'BLOCK SHIPMENT',
          icon: <XCircle className="text-[#EF4444]" size={28} />,
          badgeClass: 'bg-[rgba(239,68,68,0.15)] text-[#EF4444] border-[#EF4444]/40',
          titleColor: 'text-[#EF4444]',
          bgGradient: 'from-rose-950/30 to-black'
        };
    }
  };

  const getScoreColor = (score) => {
    if (score >= 80) return 'text-[#EF4444] stroke-[#EF4444]';
    if (score >= 60) return 'text-[#F97316] stroke-[#F97316]';
    if (score >= 40) return 'text-[#F59E0B] stroke-[#F59E0B]';
    return 'text-[#22C55E] stroke-[#22C55E]';
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 relative">
      {/* Background ambient gold & blue glows */}
      <div className="absolute top-10 left-10 w-96 h-96 bg-[#EAB308] rounded-full mix-blend-screen filter blur-[140px] opacity-10 pointer-events-none"></div>
      <div className="absolute top-40 right-10 w-96 h-96 bg-[#38BDF8] rounded-full mix-blend-screen filter blur-[150px] opacity-10 pointer-events-none"></div>

      {/* Header */}
      <div className="mb-8">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-[rgba(234,179,8,0.1)] text-[#FDE047] border border-[rgba(234,179,8,0.25)] mb-2">
              <Sparkles size={13} />
              <span>Real-Time Fraud Screening Pipeline</span>
            </div>
            <h1 className="text-3xl font-extrabold text-white tracking-tight">Shipment Screening Engine</h1>
            <p className="text-secondary text-sm mt-1">
              Submit booking requests to evaluate fraud risk across 5 deterministic, ML, and entity resolution pipeline stages.
            </p>
          </div>

          {/* Quick Scenario Preset Pills */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs uppercase font-semibold text-secondary mr-1">Demo Scenarios:</span>
            {PRESETS.map((preset, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => loadPreset(preset)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all duration-200 hover:scale-[1.02] flex items-center gap-1.5 cursor-pointer ${preset.badgeColor}`}
                title={preset.desc}
              >
                <span>{preset.name}</span>
                <span className="text-[10px] opacity-75 font-semibold">({preset.badge})</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        
        {/* Left Column: Booking Form */}
        <div className="lg:col-span-6 space-y-6">
          <div className="glass-panel p-6 sm:p-7 border border-[rgba(234,179,8,0.2)]">
            <div className="flex items-center justify-between pb-4 mb-6 border-b border-[rgba(234,179,8,0.12)]">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-[rgba(234,179,8,0.12)] text-[#FDE047]">
                  <Package size={20} />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-white">Booking Details</h2>
                  <p className="text-xs text-secondary">Enter shipment & shipper parameters</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => loadPreset(PRESETS[0])}
                className="text-xs text-secondary hover:text-[#FDE047] flex items-center gap-1 transition-colors cursor-pointer"
              >
                <RefreshCw size={13} />
                Reset Form
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Shipper ID */}
                <div>
                  <label className="block text-xs font-medium text-secondary mb-1.5 flex items-center gap-1.5">
                    <Fingerprint size={13} className="text-[#EAB308]" />
                    Shipper ID
                  </label>
                  <input
                    type="text"
                    name="shipper_id"
                    value={formData.shipper_id}
                    onChange={handleInputChange}
                    placeholder="e.g. S1001"
                    required
                    className="w-full bg-[rgba(20,20,20,0.8)] border border-[rgba(234,179,8,0.25)] rounded-lg px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-[#FDE047] transition-colors"
                  />
                </div>

                {/* Service Type */}
                <div>
                  <label className="block text-xs font-medium text-secondary mb-1.5 flex items-center gap-1.5">
                    <Zap size={13} className="text-[#EAB308]" />
                    Service Level
                  </label>
                  <select
                    name="service_type"
                    value={formData.service_type}
                    onChange={handleInputChange}
                    className="w-full bg-[rgba(20,20,20,0.8)] border border-[rgba(234,179,8,0.25)] rounded-lg px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-[#FDE047] transition-colors"
                  >
                    <option value="GROUND">GROUND (Surface)</option>
                    <option value="EXPRESS">EXPRESS (Priority Air)</option>
                    <option value="EXPRESS_SAVER">EXPRESS SAVER</option>
                    <option value="FREIGHT">FREIGHT (Bulk)</option>
                    <option value="INTERNATIONAL">INTERNATIONAL</option>
                  </select>
                </div>
              </div>

              {/* Origin & Destination */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-secondary mb-1.5 flex items-center gap-1.5">
                    <MapPin size={13} className="text-[#EAB308]" />
                    Origin City
                  </label>
                  <input
                    type="text"
                    name="origin"
                    value={formData.origin}
                    onChange={handleInputChange}
                    placeholder="e.g. Chennai"
                    required
                    className="w-full bg-[rgba(20,20,20,0.8)] border border-[rgba(234,179,8,0.25)] rounded-lg px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-[#FDE047] transition-colors"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-secondary mb-1.5 flex items-center gap-1.5">
                    <MapPin size={13} className="text-[#EAB308]" />
                    Destination City
                  </label>
                  <input
                    type="text"
                    name="destination"
                    value={formData.destination}
                    onChange={handleInputChange}
                    placeholder="e.g. Delhi or Kabul"
                    required
                    className="w-full bg-[rgba(20,20,20,0.8)] border border-[rgba(234,179,8,0.25)] rounded-lg px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-[#FDE047] transition-colors"
                  />
                </div>
              </div>

              {/* Weight & Package Count */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-secondary mb-1.5 flex items-center gap-1.5">
                    <Package size={13} className="text-[#EAB308]" />
                    Weight (kg)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    name="weight"
                    value={formData.weight}
                    onChange={handleInputChange}
                    placeholder="25.0"
                    required
                    className="w-full bg-[rgba(20,20,20,0.8)] border border-[rgba(234,179,8,0.25)] rounded-lg px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-[#FDE047] transition-colors"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-secondary mb-1.5 flex items-center gap-1.5">
                    <Clock size={13} className="text-[#EAB308]" />
                    Package Count
                  </label>
                  <input
                    type="number"
                    min="1"
                    name="package_count"
                    value={formData.package_count}
                    onChange={handleInputChange}
                    placeholder="1"
                    required
                    className="w-full bg-[rgba(20,20,20,0.8)] border border-[rgba(234,179,8,0.25)] rounded-lg px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-[#FDE047] transition-colors"
                  />
                </div>
              </div>

              {/* Payment ID & Device ID */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-secondary mb-1.5 flex items-center gap-1.5">
                    <CreditCard size={13} className="text-[#EAB308]" />
                    Payment Reference / ID
                  </label>
                  <input
                    type="text"
                    name="payment_id"
                    value={formData.payment_id}
                    onChange={handleInputChange}
                    placeholder="e.g. P19, P17"
                    required
                    className="w-full bg-[rgba(20,20,20,0.8)] border border-[rgba(234,179,8,0.25)] rounded-lg px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-[#FDE047] transition-colors"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-secondary mb-1.5 flex items-center gap-1.5">
                    <Laptop size={13} className="text-[#EAB308]" />
                    Device Fingerprint ID
                  </label>
                  <input
                    type="text"
                    name="device_id"
                    value={formData.device_id}
                    onChange={handleInputChange}
                    placeholder="e.g. D88, D77"
                    required
                    className="w-full bg-[rgba(20,20,20,0.8)] border border-[rgba(234,179,8,0.25)] rounded-lg px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-[#FDE047] transition-colors"
                  />
                </div>
              </div>

              {errorMsg && (
                <div className="p-3.5 rounded-lg bg-rose-950/40 border border-rose-500/30 text-xs text-rose-200">
                  {errorMsg}
                </div>
              )}

              {/* Action Buttons */}
              <div className="pt-4 flex items-center gap-3">
                <button
                  type="submit"
                  disabled={isScreening}
                  className="flex-1 btn-primary py-3 rounded-xl flex items-center justify-center gap-2 font-semibold text-sm transition-all duration-200 shadow-[0_0_20px_rgba(234,179,8,0.3)] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  {isScreening ? (
                    <>
                      <RefreshCw className="animate-spin" size={18} />
                      <span>Screening Across Fraud Engine...</span>
                    </>
                  ) : (
                    <>
                      <Send size={18} />
                      <span>Execute Real-Time Fraud Assessment</span>
                    </>
                  )}
                </button>

                {assessmentResult && (
                  <button
                    type="button"
                    onClick={clearResult}
                    className="btn-secondary py-3 px-4 rounded-xl flex items-center justify-center gap-1.5 text-xs font-semibold text-zinc-300 hover:text-white cursor-pointer"
                    title="Clear current result and screen another"
                  >
                    <RotateCcw size={16} />
                    <span className="hidden sm:inline">Reset</span>
                  </button>
                )}
              </div>
            </form>
          </div>

          {/* Pipeline Stages Tracker Card */}
          <div className="glass-panel p-5 border border-[rgba(234,179,8,0.15)]">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <Cpu size={16} className="text-[#EAB308]" />
                Automated Screening Pipeline Stages
              </h3>
              <span className="text-[11px] font-mono text-secondary">
                {isScreening ? `Stage ${activePipelineStep} of 5 Active` : (assessmentResult ? '5 of 5 Completed' : 'Awaiting Request')}
              </span>
            </div>

            <div className="space-y-3">
              {PIPELINE_STEPS.map((step) => {
                const isPassed = activePipelineStep > step.id || (assessmentResult && !isScreening);
                const isCurrent = isScreening && activePipelineStep === step.id;

                return (
                  <div 
                    key={step.id}
                    className={`flex items-start gap-3 p-2.5 rounded-lg border transition-all duration-200 ${
                      isCurrent 
                        ? 'bg-[rgba(234,179,8,0.12)] border-[rgba(234,179,8,0.4)] shadow-[0_0_12px_rgba(234,179,8,0.2)]'
                        : (isPassed 
                            ? 'bg-[rgba(34,197,94,0.05)] border-[rgba(34,197,94,0.25)]' 
                            : 'bg-[rgba(255,255,255,0.01)] border-transparent text-secondary')
                    }`}
                  >
                    <div className={`mt-0.5 p-1 rounded-md ${
                      isCurrent 
                        ? 'text-[#FDE047] animate-pulse' 
                        : (isPassed ? 'text-[#22C55E]' : 'text-zinc-600')
                    }`}>
                      {isPassed ? <CheckCircle2 size={16} /> : step.icon}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className={`text-xs font-semibold ${isCurrent ? 'text-[#FDE047]' : (isPassed ? 'text-zinc-200' : 'text-zinc-500')}`}>
                          {step.name}
                        </span>
                        {isCurrent && (
                          <span className="text-[10px] uppercase font-bold text-[#EAB308] tracking-widest animate-pulse">Running</span>
                        )}
                        {isPassed && !isCurrent && (
                          <span className="text-[10px] text-[#22C55E] font-medium">Passed</span>
                        )}
                      </div>
                      <p className="text-[11px] text-zinc-500 mt-0.5 truncate">{step.desc}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right Column: Assessment Result & Decision Display */}
        <div className="lg:col-span-6 space-y-6">
          {assessmentResult ? (
            <>
              {/* Decision Hero Card */}
              {(() => {
                const decision = assessmentResult.fraud_assessment?.decision || { action: 'REVIEW', reason: 'Under review' };
                const risk = assessmentResult.fraud_assessment?.risk || { risk_score: 50, risk_level: 'MEDIUM' };
                const meta = getDecisionBadge(decision.action);

                return (
                  <div className={`glass-panel p-6 sm:p-7 border bg-gradient-to-br ${meta.bgGradient} relative overflow-hidden transition-all duration-300`}>
                    {/* Top Status & Booking Reference */}
                    <div className="flex items-center justify-between pb-4 border-b border-[rgba(255,255,255,0.08)]">
                      <div>
                        <span className="text-xs text-secondary font-mono">SHIPMENT TRACKING ID</span>
                        <div className="text-xl font-black text-white tracking-wider tabular-nums">
                          {assessmentResult.booking?.shipment_id || 'SH-PENDING'}
                        </div>
                        {resultSource === 'live' && assessmentResult.fraud_assessment?.model?.model_version && (
                          <div className="mt-1.5 inline-flex items-center gap-1.5 text-[10px] font-medium text-emerald-400/90">
                            <Cpu size={11} />
                            <span>
                              Live pipeline · ML {assessmentResult.fraud_assessment.model.model_version}
                              {assessmentResult.fraud_assessment.pipeline?.ml_scoring_ms != null
                                ? ` · ${assessmentResult.fraud_assessment.pipeline.ml_scoring_ms}ms`
                                : ''}
                            </span>
                          </div>
                        )}
                        {resultSource === 'simulated' && (
                          <div className="mt-1.5 text-[10px] font-medium text-amber-400/90">
                            Offline demo mode — start Node (:3000) and ML (:8001) for real scores
                          </div>
                        )}
                      </div>

                      <div className={`px-4 py-1.5 rounded-full border text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 ${meta.badgeClass}`}>
                        {meta.icon}
                        <span>{meta.label}</span>
                      </div>
                    </div>

                    {/* Score & Risk Level Breakdown */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 my-6 items-center">
                      {/* Gauge / Metric Box */}
                      <div className="flex items-center gap-4 bg-[rgba(0,0,0,0.4)] p-4 rounded-xl border border-[rgba(255,255,255,0.05)]">
                        <div className="relative w-20 h-20 flex items-center justify-center">
                          <svg className="w-full h-full transform -rotate-90" viewBox="0 0 36 36">
                            <path
                              className="text-zinc-800"
                              strokeWidth="3.5"
                              stroke="currentColor"
                              fill="none"
                              d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                            />
                            <path
                              className={getScoreColor(risk.risk_score)}
                              strokeDasharray={`${risk.risk_score}, 100`}
                              strokeWidth="3.5"
                              strokeLinecap="round"
                              stroke="currentColor"
                              fill="none"
                              d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                            />
                          </svg>
                          <div className="absolute flex flex-col items-center justify-center">
                            <span className="text-2xl font-black text-white tabular-nums tracking-tight">
                              {Math.round(risk.risk_score)}
                            </span>
                            <span className="text-[9px] uppercase tracking-wider text-secondary">/ 100</span>
                          </div>
                        </div>

                        <div>
                          <div className="text-xs uppercase font-medium text-secondary">Composite Risk</div>
                          <div className={`text-base font-bold ${getScoreColor(risk.risk_score)}`}>
                            {risk.risk_level} RISK
                          </div>
                          <div className="text-xs text-zinc-400 mt-1">
                            Fraud Prob: <span className="font-semibold text-white">{Math.round((risk.fraud_probability || (risk.risk_score / 100)) * 100)}%</span>
                          </div>
                        </div>
                      </div>

                      {/* Component Sub-scores */}
                      <div className="space-y-2 bg-[rgba(0,0,0,0.4)] p-4 rounded-xl border border-[rgba(255,255,255,0.05)]">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-secondary">Rule Engine:</span>
                          <span className="font-bold text-white tabular-nums">
                            {assessmentResult.fraud_assessment?.component_scores?.rule_score ?? 'N/A'} pts
                          </span>
                        </div>
                        <div className="w-full bg-zinc-800 rounded-full h-1.5">
                          <div 
                            className="bg-[#EAB308] h-1.5 rounded-full" 
                            style={{ width: `${Math.min(assessmentResult.fraud_assessment?.component_scores?.rule_score || 0, 100)}%` }}
                          ></div>
                        </div>

                        <div className="flex items-center justify-between text-xs pt-1">
                          <span className="text-secondary">ML Model Probability:</span>
                          <span className="font-bold text-white tabular-nums">
                            {assessmentResult.fraud_assessment?.component_scores?.ml_score ?? 'N/A'}%
                          </span>
                        </div>
                        <div className="w-full bg-zinc-800 rounded-full h-1.5">
                          <div 
                            className="bg-[#38BDF8] h-1.5 rounded-full" 
                            style={{ width: `${Math.min(assessmentResult.fraud_assessment?.component_scores?.ml_score || 0, 100)}%` }}
                          ></div>
                        </div>
                      </div>
                    </div>

                    {/* Decision Policy Note */}
                    <div className="p-3.5 rounded-lg bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] text-xs text-zinc-300">
                      <span className="font-semibold text-white">Policy Decision: </span>
                      {decision.reason || 'Decision reached according to business risk thresholds.'}
                    </div>

                    {/* Action button to Investigation view & Re-screen */}
                    <div className="mt-5 pt-4 border-t border-[rgba(255,255,255,0.08)] flex flex-wrap items-center justify-between gap-3">
                      <button
                        type="button"
                        onClick={clearResult}
                        className="btn-secondary py-2 px-3.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 text-zinc-300 hover:text-white cursor-pointer"
                      >
                        <RotateCcw size={14} />
                        <span>Screen Another Shipment</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => navigate(`/investigation/${assessmentResult.booking?.shipment_id}`)}
                        className="btn-primary py-2 px-4 rounded-lg text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 cursor-pointer"
                      >
                        <span>Investigate Case in Depth</span>
                        <ArrowRight size={14} />
                      </button>
                    </div>
                  </div>
                );
              })()}

              {/* Reasons & Signals Breakdown Card */}
              {(() => {
                const isClean = assessmentResult.fraud_assessment?.decision?.action === 'ALLOW' || 
                                assessmentResult.fraud_assessment?.decision?.action === 'ALLOW_MONITOR' ||
                                assessmentResult.fraud_assessment?.risk?.risk_level === 'LOW';

                return (
                  <div className={`glass-panel p-6 border ${isClean ? 'border-emerald-500/20' : 'border-[rgba(234,179,8,0.18)]'}`}>
                    <h3 className="text-base font-semibold text-white mb-4 flex items-center gap-2">
                      {isClean ? (
                        <>
                          <CheckCircle2 size={18} className="text-[#22C55E]" />
                          <span>Verified Trust Signals & Clean Baseline Validation</span>
                        </>
                      ) : (
                        <>
                          <AlertTriangle size={18} className="text-[#EAB308]" />
                          <span>Key Fraud Drivers & Triggered Reasons</span>
                        </>
                      )}
                    </h3>

                    {assessmentResult.fraud_assessment?.top_reasons?.length > 0 ? (
                      <ul className="space-y-2.5">
                        {assessmentResult.fraud_assessment.top_reasons.map((reason, idx) => (
                          <li 
                            key={idx}
                            className={`flex items-start gap-3 p-3 rounded-lg border text-xs text-zinc-200 ${
                              isClean 
                                ? 'bg-[rgba(34,197,94,0.04)] border-[rgba(34,197,94,0.15)]' 
                                : 'bg-[rgba(20,20,20,0.6)] border-[rgba(234,179,8,0.1)]'
                            }`}
                          >
                            <span className={`w-5 h-5 rounded-full font-bold flex items-center justify-center text-[10px] shrink-0 mt-0.5 ${
                              isClean 
                                ? 'bg-[rgba(34,197,94,0.15)] text-[#22C55E]' 
                                : 'bg-[rgba(234,179,8,0.15)] text-[#FDE047]'
                            }`}>
                              {idx + 1}
                            </span>
                            <span className="leading-relaxed">{reason}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <div className="text-xs text-zinc-500 py-4 text-center">
                        {isClean 
                          ? 'Shipper account and route parameters conform strictly to legitimate verified profiles.'
                          : 'No high-risk flags triggered. All signals within normal operating variance.'}
                      </div>
                    )}

                    {/* Signals radar overview */}
                    {assessmentResult.fraud_assessment?.signals && (
                      <div className={`mt-6 pt-5 border-t ${isClean ? 'border-emerald-500/15' : 'border-[rgba(234,179,8,0.1)]'}`}>
                        <span className="text-xs font-semibold text-secondary uppercase tracking-wider block mb-3">
                          Signal Anomaly Breakdown
                        </span>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                          {Object.entries(assessmentResult.fraud_assessment.signals).map(([key, val]) => (
                            <div key={key} className="p-2.5 rounded-lg bg-[rgba(10,10,10,0.5)] border border-[rgba(255,255,255,0.05)]">
                              <div className="text-[11px] text-secondary capitalize">{key}</div>
                              <div className={`text-sm font-bold tabular-nums mt-0.5 ${val > 20 ? 'text-[#F97316]' : (isClean ? 'text-[#22C55E]' : 'text-zinc-200')}`}>
                                {val} pts
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}
            </>
          ) : (
            /* Live Screening Console Ready Card */
            <div className="glass-panel p-8 sm:p-10 border border-[rgba(234,179,8,0.2)] text-center flex flex-col items-center justify-center min-h-[440px] relative overflow-hidden">
              <div className="absolute top-0 right-0 w-64 h-64 bg-amber-500/5 rounded-full blur-3xl pointer-events-none"></div>

              <div className="w-16 h-16 rounded-2xl bg-[rgba(234,179,8,0.08)] border border-[rgba(234,179,8,0.2)] flex items-center justify-center text-[#EAB308] mb-4 shadow-[0_0_25px_rgba(234,179,8,0.15)]">
                <ShieldCheck size={32} />
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">Ready to Screen</h3>
              <p className="text-sm text-secondary max-w-md leading-relaxed">
                Submit booking details on the left to run the full rules + XGBoost pipeline against Node (
                <span className="font-mono text-zinc-400">:3000</span>
                ) and the ML microservice (
                <span className="font-mono text-zinc-400">:8001</span>
                ). Use demo scenarios for known high- and low-risk profiles.
              </p>
              {isScreening && (
                <p className="mt-6 text-xs text-[#FDE047] flex items-center gap-2 animate-pulse">
                  <RefreshCw size={14} className="animate-spin" />
                  Running pipeline stages…
                </p>
              )}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
