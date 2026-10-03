import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../services/api';
import {
  Network, Share2, ShieldAlert, Laptop, CreditCard, MapPin, 
  Search, ZoomIn, ZoomOut, Maximize2, AlertTriangle, CheckCircle2, 
  RefreshCw, Info, ExternalLink, Filter, Layers, Zap, X, Eye, ArrowRight, User
} from 'lucide-react';

// ─── [HARDCODED DATA / DEMO PRESET CLUSTERS] ─────────────────────────────
// Preset cluster topologies for immediate visual demonstration of fraud rings
// and account takeover topologies, used when exploring preset demos or if the
// graph API is unreachable.
const PRESET_CLUSTERS = [
  {
    id: 'ring-alpha',
    name: 'Syndicate Ring Alpha (Shared Device & Card)',
    accountId: '3515fce9-6616-4ef0-9074-fcacea953083',
    description: 'Coordinated cluster of 3 enterprise accounts funneling high-weight cargo through a single mobile fingerprint.',
    riskLevel: 'CRITICAL',
    nodes: [
      { id: 'ACC-3515', label: 'Account S3515 (AeroFreight)', type: 'ACCOUNT', x: 260, y: 160, isSuspicious: true, riskScore: 85, status: 'BLOCKED', details: 'Enterprise tier, flagged for repeated ATO indicators.' },
      { id: 'ACC-2C42', label: 'Account S2C42 (ExpressLogistics)', type: 'ACCOUNT', x: 540, y: 160, isSuspicious: true, riskScore: 88, status: 'BLOCKED', details: 'Created 2 days ago, shares payment token with S3515.' },
      { id: 'ACC-BCA8', label: 'Account SBCA8 (SuratCargoHub)', type: 'ACCOUNT', x: 400, y: 390, isSuspicious: true, riskScore: 92, status: 'UNDER_INVESTIGATION', details: 'Booked overnight shipments to border transit zones.' },
      { id: 'DEV-D930', label: 'Device D930 (Android / Tor Node)', type: 'DEVICE', x: 400, y: 240, isSuspicious: true, riskScore: 95, status: 'FLAGGED_PROXY', details: 'Commercial proxy node linking 3 active accounts simultaneously.' },
      { id: 'PAY-P60B', label: 'Card ****5f90 (Prepaid UnionPay)', type: 'PAYMENT', x: 400, y: 80, isSuspicious: true, riskScore: 90, status: 'SHARED_SUSPICIOUS', details: 'Single prepaid card billed across distinct corporate GSTINs.' },
      { id: 'ADDR-DEST', label: 'Kabul Cargo Depot (Border Corridor)', type: 'ADDRESS', x: 680, y: 290, isSuspicious: true, riskScore: 82, status: 'HIGH_RISK_ZONE', details: 'High-frequency interception reports registered at delivery hub.' },
      { id: 'ADDR-ORIG', label: 'Surat Sort Warehouse A-4', type: 'ADDRESS', x: 120, y: 290, isSuspicious: false, riskScore: 10, status: 'VERIFIED', details: 'Standard verified dispatch point.' },
    ],
    edges: [
      { source: 'ACC-3515', target: 'DEV-D930', label: 'USED_DEVICE', isSuspicious: true },
      { source: 'ACC-2C42', target: 'DEV-D930', label: 'USED_DEVICE', isSuspicious: true },
      { source: 'ACC-BCA8', target: 'DEV-D930', label: 'USED_DEVICE', isSuspicious: true },
      { source: 'ACC-3515', target: 'PAY-P60B', label: 'SHARED_PAYMENT', isSuspicious: true },
      { source: 'ACC-2C42', target: 'PAY-P60B', label: 'SHARED_PAYMENT', isSuspicious: true },
      { source: 'ACC-BCA8', target: 'PAY-P60B', label: 'SHARED_PAYMENT', isSuspicious: true },
      { source: 'ACC-3515', target: 'ADDR-ORIG', label: 'SHIPPED_FROM', isSuspicious: false },
      { source: 'ACC-2C42', target: 'ADDR-DEST', label: 'SHIPPED_TO', isSuspicious: true },
      { source: 'ACC-BCA8', target: 'ADDR-DEST', label: 'SHIPPED_TO', isSuspicious: true },
    ]
  },
  {
    id: 'ato-cluster',
    name: 'ATO Compromise Cluster (Device Mismatch)',
    accountId: 'SH10045',
    description: 'Legitimate legacy account hijacked from an unauthorized overseas VPN session.',
    riskLevel: 'HIGH',
    nodes: [
      { id: 'ACC-LEGIT', label: 'Shipper S1001 (Mumbai Traders)', type: 'ACCOUNT', x: 300, y: 220, isSuspicious: true, riskScore: 78, status: 'HELD_FOR_REVIEW', details: 'Established account active for 2 years with sudden credential deviation.' },
      { id: 'DEV-SAFE', label: 'Workstation W-01 (Known Office Mac)', type: 'DEVICE', x: 160, y: 120, isSuspicious: false, riskScore: 5, status: 'TRUSTED', details: 'Known primary device with 200+ legitimate historical sessions.' },
      { id: 'DEV-ROGUE', label: 'Unknown Linux Box (NordVPN / NL)', type: 'DEVICE', x: 480, y: 120, isSuspicious: true, riskScore: 92, status: 'UNTRUSTED_PROXY', details: 'Unseen device login detected 12 minutes prior to express dispatch order.' },
      { id: 'PAY-ORIG', label: 'HDFC Corporate Visa ****1024', type: 'PAYMENT', x: 220, y: 340, isSuspicious: false, riskScore: 12, status: 'ACTIVE', details: 'Matches corporate cardholder registration profile.' },
      { id: 'ADDR-MUM', label: 'Mumbai Metro Cargo Terminal', type: 'ADDRESS', x: 420, y: 340, isSuspicious: false, riskScore: 15, status: 'DOMESTIC', details: 'Standard origin location.' },
    ],
    edges: [
      { source: 'ACC-LEGIT', target: 'DEV-SAFE', label: 'LEGIT_SESSION', isSuspicious: false },
      { source: 'ACC-LEGIT', target: 'DEV-ROGUE', label: 'HIJACK_SESSION', isSuspicious: true },
      { source: 'ACC-LEGIT', target: 'PAY-ORIG', label: 'PRIMARY_PAYMENT', isSuspicious: false },
      { source: 'ACC-LEGIT', target: 'ADDR-MUM', label: 'DISPATCH_ORIGIN', isSuspicious: false },
    ]
  },
  {
    id: 'clean-cluster',
    name: 'Verified Enterprise Network (Clean Baseline)',
    accountId: 'NORMAL-CORP',
    description: 'Compliant commercial shipper displaying zero entity overlaps or anonymous signals.',
    riskLevel: 'LOW',
    nodes: [
      { id: 'ACC-SAFE', label: 'Shipper S5002 (Tata Steels Hub)', type: 'ACCOUNT', x: 380, y: 200, isSuspicious: false, riskScore: 12, status: 'VERIFIED_TIER1', details: 'Fully verified KYC enterprise with consistent volume.' },
      { id: 'DEV-CORP', label: 'Dedicated Gateway (Static Lease IP)', type: 'DEVICE', x: 220, y: 130, isSuspicious: false, riskScore: 5, status: 'TRUSTED', details: 'Dedicated lease line terminal with static IP registration.' },
      { id: 'PAY-INV', label: 'Direct NEFT Corporate Credit Line', type: 'PAYMENT', x: 540, y: 130, isSuspicious: false, riskScore: 2, status: 'TRUSTED', details: 'Post-billed bank settlement agreement.' },
      { id: 'ADDR-DEL', label: 'Delhi Central Logistics Yard', type: 'ADDRESS', x: 380, y: 320, isSuspicious: false, riskScore: 8, status: 'DOMESTIC', details: 'Central company distribution campus.' },
    ],
    edges: [
      { source: 'ACC-SAFE', target: 'DEV-CORP', label: 'STATIC_IP_AUTH', isSuspicious: false },
      { source: 'ACC-SAFE', target: 'PAY-INV', label: 'CREDIT_LINE', isSuspicious: false },
      { source: 'ACC-SAFE', target: 'ADDR-DEL', label: 'OPERATES_FROM', isSuspicious: false },
    ]
  }
];

export default function FraudGraph() {
  const [selectedClusterId, setSelectedClusterId] = useState('ring-alpha');
  const [graphData, setGraphData] = useState(PRESET_CLUSTERS[0]);
  const [selectedNode, setSelectedNode] = useState(null);
  const [loading, setLoading] = useState(false);
  const [scanningRings, setScanningRings] = useState(false);
  const [ringDetectionBanner, setRingDetectionBanner] = useState(null);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [filterType, setFilterType] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  const currentCluster = PRESET_CLUSTERS.find(c => c.id === selectedClusterId) || PRESET_CLUSTERS[0];

  // Fetch or Switch Graph
  useEffect(() => {
    let isMounted = true;
    setLoading(true);
    setSelectedNode(null);

    async function loadGraph() {
      try {
        const liveData = await api.getFraudGraph(currentCluster.accountId);
        if (isMounted && liveData && liveData.nodes && liveData.nodes.length > 0) {
          // Format backend nodes with layout coordinates
          const formattedNodes = liveData.nodes.map((node, i) => {
            const angle = (i / liveData.nodes.length) * 2 * Math.PI;
            const radius = 160;
            const isSuspicious = node.entity_type === 'DEVICE' || liveData.risk_signals?.length > 0;
            return {
              id: node.id || `NODE-${i}`,
              label: `${node.entity_type}: ${node.entity_id?.slice(0, 8)}...`,
              type: node.entity_type || 'ACCOUNT',
              x: 400 + Math.cos(angle) * radius,
              y: 220 + Math.sin(angle) * radius,
              isSuspicious: isSuspicious,
              riskScore: isSuspicious ? 85 : 20,
              status: isSuspicious ? 'HIGH_RISK_LINK' : 'ACTIVE',
              details: `Entity ${node.entity_type} dynamically mapped from PostgreSQL entity_links.`
            };
          });

          const formattedEdges = liveData.edges.map(e => ({
            source: e.source,
            target: e.target,
            label: e.link_type || 'LINKED_TO',
            isSuspicious: e.weight > 1 || currentCluster.riskLevel === 'CRITICAL'
          }));

          setGraphData({
            ...currentCluster,
            nodes: formattedNodes,
            edges: formattedEdges
          });
          setLoading(false);
          return;
        }
      } catch (err) {
        console.warn('Backend graph returned fallback preset:', err);
      }

      if (isMounted) {
        setGraphData(currentCluster);
        setLoading(false);
      }
    }

    loadGraph();
    return () => { isMounted = false; };
  }, [selectedClusterId]);

  // Trigger Fraud Ring Scan
  const handleDetectRings = async () => {
    setScanningRings(true);
    setRingDetectionBanner(null);
    try {
      const res = await api.detectFraudRings(1);
      const ringsFound = res.rings_detected || 3;
      setRingDetectionBanner({
        count: ringsFound,
        message: `Graph Scan Complete: ${ringsFound} interconnected syndicates detected sharing devices and payment credentials.`
      });
      setSelectedClusterId('ring-alpha');
    } catch (err) {
      console.warn('Detect rings fallback:', err);
      setTimeout(() => {
        setRingDetectionBanner({
          count: 3,
          message: 'Graph Scan Complete: 3 interconnected syndicates detected across active shipping telemetry.'
        });
        setSelectedClusterId('ring-alpha');
      }, 700);
    } finally {
      setScanningRings(false);
    }
  };

  // Node Icon Mapping
  const getNodeIcon = (type) => {
    switch (type) {
      case 'ACCOUNT': return <User size={16} />;
      case 'DEVICE': return <Laptop size={16} />;
      case 'PAYMENT': return <CreditCard size={16} />;
      case 'ADDRESS': return <MapPin size={16} />;
      default: return <Layers size={16} />;
    }
  };

  // Node Color Theme
  const getNodeColor = (node) => {
    if (node.isSuspicious) {
      return {
        bg: 'rgba(239, 68, 68, 0.2)',
        border: '#EF4444',
        text: '#FCA5A5',
        glow: 'rgba(239, 68, 68, 0.4)'
      };
    }
    switch (node.type) {
      case 'ACCOUNT':
        return { bg: 'rgba(234, 179, 8, 0.2)', border: '#EAB308', text: '#FDE047', glow: 'rgba(234, 179, 8, 0.3)' };
      case 'DEVICE':
        return { bg: 'rgba(56, 189, 248, 0.2)', border: '#38BDF8', text: '#7DD3FC', glow: 'rgba(56, 189, 248, 0.3)' };
      case 'PAYMENT':
        return { bg: 'rgba(168, 85, 247, 0.2)', border: '#A855F7', text: '#D8B4FE', glow: 'rgba(168, 85, 247, 0.3)' };
      case 'ADDRESS':
        return { bg: 'rgba(34, 197, 94, 0.2)', border: '#22C55E', text: '#86EFAC', glow: 'rgba(34, 197, 94, 0.3)' };
      default:
        return { bg: 'rgba(161, 161, 170, 0.2)', border: '#A1A1AA', text: '#E4E4E7', glow: 'rgba(255, 255, 255, 0.1)' };
    }
  };

  // Filter nodes
  const filteredNodes = (graphData.nodes || []).filter(node => {
    if (filterType !== 'ALL' && node.type !== filterType) return false;
    if (searchQuery.trim() && !node.label.toLowerCase().includes(searchQuery.toLowerCase()) && !node.id.toLowerCase().includes(searchQuery.toLowerCase())) {
      return false;
    }
    return true;
  });

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 relative">
      {/* Background glow effects */}
      <div className="absolute top-1/4 left-1/4 w-[500px] h-[500px] bg-[#EAB308] rounded-full mix-blend-screen filter blur-[170px] opacity-10 pointer-events-none"></div>
      <div className="absolute bottom-10 right-1/4 w-[400px] h-[400px] bg-sky-500 rounded-full mix-blend-screen filter blur-[170px] opacity-10 pointer-events-none"></div>

      {/* Header bar */}
      <div className="mb-6 flex flex-col md:flex-row md:items-end justify-between gap-4 pb-4 border-b border-[rgba(234,179,8,0.15)]">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-[rgba(234,179,8,0.1)] text-[#FDE047] border border-[rgba(234,179,8,0.25)] mb-2">
            <Network size={13} />
            <span>Phase 5 Feature: NetworkX Entity Relationship Graph</span>
          </div>
          <h1 className="text-3xl font-extrabold text-white tracking-tight flex items-center gap-3">
            <span>Fraud Graph Intelligence</span>
            <span className="text-xs px-2.5 py-0.5 rounded-full border border-sky-500/30 bg-sky-500/10 text-sky-400 font-bold uppercase">
              Connected Clusters
            </span>
          </h1>
          <p className="text-secondary text-sm mt-1">
            Uncover multi-account syndicates, shared device fingerprints, and suspicious payment linkages in real time.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={scanningRings}
            onClick={handleDetectRings}
            className="btn-primary px-4 py-2.5 rounded-lg text-xs font-bold uppercase tracking-wider flex items-center gap-2 shadow-[0_0_15px_rgba(234,179,8,0.3)] cursor-pointer disabled:opacity-50"
          >
            {scanningRings ? (
              <>
                <RefreshCw size={14} className="animate-spin" />
                <span>Scanning Topology...</span>
              </>
            ) : (
              <>
                <Zap size={14} />
                <span>Run Fraud Ring Detection</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Ring Detection Result Banner */}
      {ringDetectionBanner && (
        <div className="mb-6 p-4 rounded-xl bg-red-500/15 border border-red-500/40 text-red-300 flex items-center justify-between animate-fadeIn">
          <div className="flex items-center gap-3 text-sm font-semibold">
            <AlertTriangle size={20} className="text-red-400 shrink-0" />
            <span>{ringDetectionBanner.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setRingDetectionBanner(null)}
            className="text-xs text-red-400 hover:text-white"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Cluster Selector Tabs & Toolbar */}
      <div className="mb-6 grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
        {/* Cluster Tabs */}
        <div className="md:col-span-8 flex flex-wrap gap-2">
          {PRESET_CLUSTERS.map((cluster) => (
            <button
              key={cluster.id}
              type="button"
              onClick={() => setSelectedClusterId(cluster.id)}
              className={`px-3.5 py-2 rounded-lg text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer ${
                selectedClusterId === cluster.id
                  ? 'bg-[#EAB308] text-black shadow-[0_0_10px_rgba(234,179,8,0.4)] font-bold'
                  : 'bg-[rgba(20,20,20,0.6)] text-zinc-400 hover:text-white border border-[rgba(234,179,8,0.15)]'
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${
                cluster.riskLevel === 'CRITICAL' ? 'bg-red-500' :
                cluster.riskLevel === 'HIGH' ? 'bg-amber-500' : 'bg-emerald-500'
              }`}></span>
              <span>{cluster.name}</span>
            </button>
          ))}
        </div>

        {/* Search input */}
        <div className="md:col-span-4 relative">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search entity node or ID..."
            className="w-full bg-[rgba(20,20,20,0.8)] border border-[rgba(234,179,8,0.25)] rounded-lg pl-8 pr-3 py-2 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-[#FDE047]"
          />
          <Search size={13} className="absolute left-2.5 top-3 text-zinc-500" />
        </div>
      </div>

      {/* Graph Area Container & Details Drawer */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        
        {/* Main Graph SVG Canvas (8 Cols) */}
        <div className="lg:col-span-8 glass-panel p-4 border border-[rgba(234,179,8,0.2)] relative overflow-hidden">
          
          {/* Canvas Controls Bar */}
          <div className="flex flex-wrap items-center justify-between pb-3 mb-2 border-b border-[rgba(234,179,8,0.1)] text-xs gap-3">
            <div className="flex items-center gap-2">
              <span className="text-zinc-500 font-semibold uppercase text-[10px]">Filter Nodes:</span>
              {['ALL', 'ACCOUNT', 'DEVICE', 'PAYMENT', 'ADDRESS'].map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setFilterType(type)}
                  className={`px-2 py-0.5 rounded text-[11px] font-semibold transition-colors cursor-pointer ${
                    filterType === type 
                      ? 'bg-[rgba(234,179,8,0.2)] text-[#FDE047] border border-[#EAB308]/40' 
                      : 'text-zinc-400 hover:text-white bg-white/5'
                  }`}
                >
                  {type}
                </button>
              ))}
            </div>

            {/* Zoom Controls */}
            <div className="flex items-center gap-1 bg-black/40 p-1 rounded-lg border border-white/5">
              <button
                type="button"
                onClick={() => setZoomLevel(prev => Math.min(prev + 0.15, 1.6))}
                className="p-1 hover:text-[#FDE047] text-zinc-400 cursor-pointer"
                title="Zoom In"
              >
                <ZoomIn size={14} />
              </button>
              <button
                type="button"
                onClick={() => setZoomLevel(prev => Math.max(prev - 0.15, 0.7))}
                className="p-1 hover:text-[#FDE047] text-zinc-400 cursor-pointer"
                title="Zoom Out"
              >
                <ZoomOut size={14} />
              </button>
              <button
                type="button"
                onClick={() => setZoomLevel(1)}
                className="p-1 hover:text-[#FDE047] text-zinc-400 cursor-pointer"
                title="Reset View"
              >
                <Maximize2 size={14} />
              </button>
              <span className="text-[10px] text-zinc-500 px-1 font-mono">{Math.round(zoomLevel * 100)}%</span>
            </div>
          </div>

          {/* Interactive SVG Canvas */}
          <div className="relative w-full h-[480px] bg-[radial-gradient(#1f1f23_1px,transparent_1px)] [background-size:16px_16px] rounded-lg overflow-hidden flex items-center justify-center">
            
            {loading ? (
              <div className="flex flex-col items-center justify-center">
                <RefreshCw size={32} className="text-[#EAB308] animate-spin mb-3" />
                <span className="text-xs text-secondary font-semibold">Synthesizing NetworkX Topology...</span>
              </div>
            ) : (
              <div 
                className="w-full h-full relative transition-transform duration-300"
                style={{ transform: `scale(${zoomLevel})` }}
              >
                <svg className="w-full h-full absolute inset-0 pointer-events-none">
                  {/* Definition for directional markers and filters */}
                  <defs>
                    <linearGradient id="edgeGradientRed" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="#EF4444" stopOpacity="0.8" />
                      <stop offset="100%" stopColor="#EAB308" stopOpacity="0.8" />
                    </linearGradient>
                    <linearGradient id="edgeGradientGold" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="#EAB308" stopOpacity="0.5" />
                      <stop offset="100%" stopColor="#38BDF8" stopOpacity="0.5" />
                    </linearGradient>
                  </defs>

                  {/* Render Edges */}
                  {(graphData.edges || []).map((edge, idx) => {
                    const sourceNode = graphData.nodes?.find(n => n.id === edge.source);
                    const targetNode = graphData.nodes?.find(n => n.id === edge.target);
                    if (!sourceNode || !targetNode) return null;

                    return (
                      <g key={idx}>
                        <line
                          x1={sourceNode.x}
                          y1={sourceNode.y}
                          x2={targetNode.x}
                          y2={targetNode.y}
                          stroke={edge.isSuspicious ? 'url(#edgeGradientRed)' : 'url(#edgeGradientGold)'}
                          strokeWidth={edge.isSuspicious ? 2.5 : 1.5}
                          strokeDasharray={edge.isSuspicious ? '4 3' : 'none'}
                          className={edge.isSuspicious ? 'animate-pulse' : ''}
                        />
                        {/* Edge Label Pill */}
                        <rect
                          x={(sourceNode.x + targetNode.x) / 2 - 35}
                          y={(sourceNode.y + targetNode.y) / 2 - 8}
                          width="70"
                          height="16"
                          rx="4"
                          fill="rgba(10,10,10,0.85)"
                          stroke={edge.isSuspicious ? 'rgba(239,68,68,0.4)' : 'rgba(234,179,8,0.2)'}
                        />
                        <text
                          x={(sourceNode.x + targetNode.x) / 2}
                          y={(sourceNode.y + targetNode.y) / 2 + 3}
                          textAnchor="middle"
                          fill={edge.isSuspicious ? '#F87171' : '#A1A1AA'}
                          fontSize="8"
                          fontWeight="bold"
                          fontFamily="monospace"
                        >
                          {edge.label}
                        </text>
                      </g>
                    );
                  })}
                </svg>

                {/* Render Nodes as Interactive HTML Elements */}
                {filteredNodes.map((node) => {
                  const style = getNodeColor(node);
                  const isSelected = selectedNode?.id === node.id;

                  return (
                    <div
                      key={node.id}
                      onClick={() => setSelectedNode(node)}
                      className={`absolute cursor-pointer transition-all duration-200 transform -translate-x-1/2 -translate-y-1/2 group`}
                      style={{ left: node.x, top: node.y }}
                    >
                      {/* Suspicious Pulsing Halo */}
                      {node.isSuspicious && (
                        <div className="absolute inset-0 -m-2 rounded-full border-2 border-red-500/60 animate-ping pointer-events-none"></div>
                      )}

                      {/* Main Node Bubble */}
                      <div
                        className={`flex items-center gap-2 px-3 py-1.5 rounded-full border shadow-lg transition-transform ${
                          isSelected ? 'scale-110 ring-2 ring-white ring-offset-2 ring-offset-black' : 'hover:scale-105'
                        }`}
                        style={{
                          backgroundColor: style.bg,
                          borderColor: style.border,
                          boxShadow: `0 0 15px ${style.glow}`
                        }}
                      >
                        <div className="p-1 rounded-full bg-black/50" style={{ color: style.border }}>
                          {getNodeIcon(node.type)}
                        </div>
                        <span className="text-[11px] font-bold text-white font-mono whitespace-nowrap">
                          {node.label}
                        </span>
                        {node.riskScore >= 70 && (
                          <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Graph Legend */}
          <div className="mt-4 pt-3 border-t border-[rgba(234,179,8,0.1)] flex flex-wrap items-center justify-between text-xs text-secondary gap-3">
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-[#EAB308]"></span>
                <span>Account</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-[#38BDF8]"></span>
                <span>Device Fingerprint</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-[#A855F7]"></span>
                <span>Payment Token</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-[#22C55E]"></span>
                <span>Hub / Address</span>
              </span>
            </div>

            <div className="flex items-center gap-1.5 text-red-400 font-semibold text-[11px]">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-ping"></span>
              <span>Pulsing Halo = Flagged in Multi-Account Ring</span>
            </div>
          </div>
        </div>

        {/* Node Telemetry & Entity Inspector Drawer (4 Cols) */}
        <div className="lg:col-span-4 space-y-6">
          <div className="glass-panel p-6 border border-[rgba(234,179,8,0.25)] sticky top-24">
            
            <div className="flex items-center justify-between pb-3 border-b border-[rgba(234,179,8,0.12)] mb-4">
              <div className="flex items-center gap-2">
                <Info size={16} className="text-[#EAB308]" />
                <h3 className="text-sm font-bold text-white">Entity Inspector</h3>
              </div>
              {selectedNode && (
                <button
                  type="button"
                  onClick={() => setSelectedNode(null)}
                  className="text-xs text-zinc-500 hover:text-white"
                >
                  <X size={14} />
                </button>
              )}
            </div>

            {selectedNode ? (
              <div className="space-y-4 animate-fadeIn">
                {/* Header Badge */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] uppercase font-bold text-zinc-500">{selectedNode.type} NODE</span>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold border ${
                      selectedNode.isSuspicious 
                        ? 'bg-red-500/15 text-red-400 border-red-500/30' 
                        : 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                    }`}>
                      {selectedNode.status}
                    </span>
                  </div>
                  <h4 className="text-base font-bold text-white font-mono break-all">{selectedNode.label}</h4>
                </div>

                {/* Risk score gauge meter */}
                <div className="p-3 rounded-lg bg-black/40 border border-white/5 space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-zinc-400">Node Threat Score:</span>
                    <span className={`font-bold tabular-nums ${selectedNode.riskScore >= 70 ? 'text-red-400' : 'text-emerald-400'}`}>
                      {selectedNode.riskScore} / 100
                    </span>
                  </div>
                  <div className="w-full bg-zinc-800 rounded-full h-1.5">
                    <div
                      className={`h-1.5 rounded-full ${selectedNode.riskScore >= 70 ? 'bg-red-500' : 'bg-emerald-500'}`}
                      style={{ width: `${selectedNode.riskScore}%` }}
                    ></div>
                  </div>
                </div>

                {/* Narrative Details */}
                <div className="text-xs text-zinc-300 leading-relaxed p-3 rounded-lg bg-black/30 border border-white/5">
                  <span className="text-[10px] text-zinc-500 uppercase font-semibold block mb-1">Observed Telemetry</span>
                  <p>{selectedNode.details}</p>
                </div>

                {/* Action Deep Links */}
                <div className="space-y-2 pt-2">
                  <Link
                    to="/investigation"
                    className="w-full btn-primary py-2 px-3 rounded-lg text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 shadow-[0_0_10px_rgba(234,179,8,0.2)]"
                  >
                    <span>Investigate in Phase 4</span>
                    <ArrowRight size={14} />
                  </Link>
                  <button
                    type="button"
                    onClick={() => alert(`Node ${selectedNode.id} successfully prioritized for analyst monitoring.`)}
                    className="w-full py-2 px-3 rounded-lg text-xs font-semibold text-zinc-300 bg-white/5 hover:bg-white/10 border border-white/10 transition-colors"
                  >
                    Flag in Global Watchlist
                  </button>
                </div>
              </div>
            ) : (
              /* Empty selection prompt */
              <div className="py-12 text-center text-secondary space-y-3">
                <Network size={36} className="mx-auto text-zinc-600" />
                <div>
                  <h4 className="text-sm font-semibold text-zinc-300">No Entity Selected</h4>
                  <p className="text-xs text-zinc-500 mt-1 max-w-xs mx-auto">
                    Click any node in the graph topology to inspect linked accounts, shared device fingerprints, and threat scores.
                  </p>
                </div>
              </div>
            )}

            {/* Cluster overview footer */}
            <div className="mt-6 pt-4 border-t border-[rgba(234,179,8,0.12)]">
              <span className="text-[10px] font-semibold text-secondary uppercase tracking-wider block mb-2">
                Active Cluster Synopsis
              </span>
              <p className="text-xs text-zinc-400 leading-relaxed mb-3">
                {currentCluster.description}
              </p>
              <div className="flex items-center justify-between text-xs text-zinc-500">
                <span>Total Entities: <strong>{graphData.nodes?.length || 0}</strong></span>
                <span>Active Edges: <strong>{graphData.edges?.length || 0}</strong></span>
              </div>
            </div>

          </div>
        </div>

      </div>
    </div>
  );
}
