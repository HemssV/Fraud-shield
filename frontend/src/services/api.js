import axios from 'axios';

// Backend B (Django) for Analytics, Cases, Graph, GenAI
const DJANGO_API_BASE = import.meta.env.VITE_DJANGO_API_URL || 'http://localhost:8000/api/v1';

// Backend A (Node.js) for Core Fraud Pipeline (Bookings, Rules, ML)
const NODE_API_BASE = import.meta.env.VITE_NODE_API_URL || 'http://localhost:3000/api';

const djangoClient = axios.create({
  baseURL: DJANGO_API_BASE,
  headers: { 'Content-Type': 'application/json' },
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

  // ─── INVESTIGATIONS & CASES (DJANGO) ────────────────────────────────────────
  getInvestigations: async () => {
    const response = await djangoClient.get('/cases/');
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

  // ─── FRAUD GRAPH (DJANGO) ───────────────────────────────────────────────────
  getFraudGraph: async (shipperId) => {
    const response = await djangoClient.get(`/fraud-graph/account/${shipperId}/`);
    return response.data;
  },

  // ─── GENAI EXPLANATION (DJANGO) ─────────────────────────────────────────────
  getFraudExplanation: async (shipmentId) => {
    const response = await djangoClient.post('/fraud/explain/', { shipment_id: shipmentId });
    return response.data;
  },

  // ─── SIMULATOR (DJANGO) ─────────────────────────────────────────────────────
  runScenario: async (scenario) => {
    const response = await djangoClient.post('/simulator/run/', { scenario });
    return response.data;
  }
};
