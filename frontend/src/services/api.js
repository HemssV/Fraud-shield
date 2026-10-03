import axios from 'axios';

// Backend B (Django) for Analytics, Cases, Graph, GenAI
const DJANGO_API_BASE = import.meta.env.VITE_DJANGO_API_URL || 'http://localhost:8000/api/v1';

// Backend A (Node.js) for Core Fraud Pipeline (Bookings, Rules, ML)
const NODE_API_BASE = import.meta.env.VITE_NODE_API_URL || 'http://localhost:3000/api';

const djangoClient = axios.create({
  baseURL: DJANGO_API_BASE,
  headers: { 'Content-Type': 'application/json' },
  timeout: 60000, // 60s timeout — cloud DB round-trips or ML inferences can take a while
});

const nodeClient = axios.create({
  baseURL: NODE_API_BASE,
  headers: { 'Content-Type': 'application/json' },
});

export const api = {
  // ─── CORE PIPELINE (NODE.JS) ────────────────────────────────────────────────
  screenShipment: async (bookingData) => {
    // POST /api/bookings triggers the entire pipeline
    const response = await nodeClient.post('/bookings', bookingData);
    return response.data;
  },

  // ─── DASHBOARD (DJANGO) ─────────────────────────────────────────────────────
  getDashboardSummary: async () => {
    const response = await djangoClient.get('/dashboard/summary/');
    return response.data;
  },
  getDashboardDaily: async () => {
    const response = await djangoClient.get('/dashboard/daily/');
    return response.data;
  },
  getRecentAlerts: async () => {
    const response = await djangoClient.get('/dashboard/recent-alerts/');
    return response.data;
  },
  getReviewQueue: async () => {
    const response = await djangoClient.get('/dashboard/review-queue/');
    return response.data;
  },
  getRiskDistribution: async (day) => {
    const response = await djangoClient.get('/dashboard/risk-distribution/', {
      params: day ? { day } : {}
    });
    return response.data;
  },

  // Combined dashboard endpoint — fetches summary + daily + alerts + risk_distribution
  // in a single HTTP request (eliminates 4 separate round-trips to cloud DB)
  getDashboardAll: async () => {
    const response = await djangoClient.get('/dashboard/all/');
    return response.data;
  },

  // ─── INVESTIGATIONS & CASES (DJANGO) ────────────────────────────────────────
  getInvestigations: async (params = {}) => {
    const response = await djangoClient.get('/cases/', { params });
    return response.data;
  },
  getInvestigationDetail: async (id) => {
    const response = await djangoClient.get(`/cases/${id}/`);
    return response.data;
  },
  submitAnalystDecision: async (id, data) => {
    const response = await djangoClient.post(`/cases/${id}/decision/`, data);
    return response.data;
  },
  assignCase: async (id, staffUserId) => {
    const response = await djangoClient.post(`/cases/${id}/assign/`, { staff_user_id: staffUserId });
    return response.data;
  },

  // ─── FRAUD GRAPH (DJANGO) ───────────────────────────────────────────────────
  getFraudGraph: async (accountId) => {
    const response = await djangoClient.get(`/fraud-graph/account/${accountId}/`);
    return response.data;
  },
  detectFraudRings: async (minSharedEntities = 1) => {
    const response = await djangoClient.post('/fraud-graph/detect-rings/', { min_shared_entities: minSharedEntities });
    return response.data;
  },

  // ─── GENAI EXPLANATION (DJANGO) ─────────────────────────────────────────────
  getFraudExplanation: async (assessmentId) => {
    const response = await djangoClient.post('/fraud/explain/', { assessment_id: assessmentId });
    return response.data;
  },

  // ─── SIMULATOR (DJANGO) ─────────────────────────────────────────────────────
  runScenario: async (scenario) => {
    const response = await djangoClient.post('/simulator/run/', { scenario });
    return response.data;
  }
};

