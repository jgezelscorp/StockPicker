const API_BASE = '/api';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export const api = {
  // Dashboard
  getDashboard: () => request<any>('/dashboard'),

  // Stocks
  getStocks: (market?: string) =>
    request<any>(market ? `/stocks?market=${market}` : '/stocks'),
  addStock: (stock: { symbol: string; name: string; market: string; assetType?: string; sector?: string; currency?: string }) =>
    request<any>('/stocks', { method: 'POST', body: JSON.stringify(stock) }),

  // Trades
  getTrades: (page = 1, pageSize = 20) =>
    request<any>(`/trades?page=${page}&pageSize=${pageSize}`),

  // Portfolio
  getPositions: () => request<any>('/portfolio/positions'),
  getPortfolioHistory: (days = 30) =>
    request<any>(`/portfolio/history?days=${days}`),

  // Analysis
  getAnalyses: (stockId?: number) =>
    request<any>(stockId ? `/analysis?stockId=${stockId}` : '/analysis'),

  // Performance
  getPerformance: () => request<any>('/performance'),

  // Learning
  getLearning: () => request<any>('/learning'),

  // Health
  getHealth: () => request<any>('/health'),

  // Watchlist & Discovery
  getWatchlist: () => request<any>('/watchlist'),
  getSystemStatus: () => request<any>('/status'),
  discoverStocks: () =>
    request<any>('/discover', { method: 'POST' }),
  runAnalysis: () =>
    request<any>('/analyze/run', { method: 'POST' }),
  removeStock: (id: number) =>
    request<any>(`/stocks/${id}`, { method: 'DELETE' }),

  // Stock Detail
  getStockDetail: (symbolOrId: string | number) =>
    request<any>(`/stocks/${symbolOrId}/detail`),

  // Sell Position
  sellPosition: (symbol: string, quantity: number, price: number) =>
    request<any>('/portfolio/sell', {
      method: 'POST',
      body: JSON.stringify({ symbol, quantity, price }),
    }),

  // Refresh Prices
  refreshPrices: () =>
    request<any>('/portfolio/refresh-prices', { method: 'POST' }),

  // Cash Adjustment
  adjustCash: (amount: number, reason?: string) =>
    request<any>('/portfolio/adjust-cash', {
      method: 'POST',
      body: JSON.stringify({ amount, reason }),
    }),

  // Analysis Runs
  getAnalysisRuns: () => request<any>('/analysis-runs'),

  // News
  getBusinessNews: () => request<any>('/news/business'),
  getGeopoliticalNews: () => request<any>('/news/geopolitical'),

  // Activity Log
  getLogs:(params?: { limit?: number; offset?: number; category?: string; level?: string; since?: string; max_verbosity?: number }) => {
    const qs = new URLSearchParams();
    if (params?.limit) qs.set('limit', String(params.limit));
    if (params?.offset) qs.set('offset', String(params.offset));
    if (params?.category) qs.set('category', params.category);
    if (params?.level) qs.set('level', params.level);
    if (params?.since) qs.set('since', params.since);
    if (params?.max_verbosity) qs.set('max_verbosity', String(params.max_verbosity));
    return request<any>(`/logs?${qs.toString()}`);
  },
};
