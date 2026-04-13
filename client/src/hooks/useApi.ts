import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';

const REFRESH_INTERVAL = 30_000;

export function useDashboard() {
  return useQuery({
    queryKey: ['dashboard'],
    queryFn: api.getDashboard,
    refetchInterval: REFRESH_INTERVAL,
  });
}

export function usePortfolio() {
  return useQuery({
    queryKey: ['positions'],
    queryFn: api.getPositions,
    refetchInterval: REFRESH_INTERVAL,
  });
}

export function usePortfolioHistory(days = 30) {
  return useQuery({
    queryKey: ['portfolio-history', days],
    queryFn: () => api.getPortfolioHistory(days),
    refetchInterval: REFRESH_INTERVAL,
  });
}

export interface TradeFilters {
  page?: number;
  pageSize?: number;
  symbol?: string;
  action?: 'buy' | 'sell' | '';
  dateFrom?: string;
  dateTo?: string;
}

export function useTrades(filters: TradeFilters = {}) {
  const { page = 1, pageSize = 50 } = filters;
  return useQuery({
    queryKey: ['trades', page, pageSize, filters.symbol, filters.action, filters.dateFrom, filters.dateTo],
    queryFn: () => api.getTrades(page, pageSize),
    refetchInterval: REFRESH_INTERVAL,
  });
}

export function useAnalysis(stockId?: number) {
  return useQuery({
    queryKey: ['analysis', stockId],
    queryFn: () => api.getAnalyses(stockId),
    refetchInterval: REFRESH_INTERVAL,
  });
}

export function usePerformance() {
  return useQuery({
    queryKey: ['performance'],
    queryFn: api.getPerformance,
    refetchInterval: REFRESH_INTERVAL,
  });
}

export function useLearning() {
  return useQuery({
    queryKey: ['learning'],
    queryFn: api.getLearning,
    refetchInterval: REFRESH_INTERVAL,
  });
}

export function useSignals(symbol?: string) {
  return useQuery({
    queryKey: ['signals', symbol],
    queryFn: () => api.getAnalyses(),
    enabled: !!symbol,
    refetchInterval: REFRESH_INTERVAL,
  });
}

export function useHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: api.getHealth,
    refetchInterval: REFRESH_INTERVAL,
  });
}
