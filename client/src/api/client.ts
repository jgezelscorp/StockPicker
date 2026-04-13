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
};
