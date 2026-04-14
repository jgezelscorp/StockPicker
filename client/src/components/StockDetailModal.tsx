import { useState, useEffect, useCallback, useMemo } from 'react';
import { useStockDetail } from '../hooks/useApi';
import {
  ResponsiveContainer, ComposedChart, Area, Line, Bar, BarChart,
  LineChart, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine,
} from 'recharts';

/* ─── Types ─── */
interface StockDetailModalProps {
  symbolOrId: string | number;
  onClose: () => void;
}

type Timeframe = '1D' | '1W' | '1M' | '3M' | '1Y' | '3Y';
type Indicator = 'sma_20' | 'sma_50' | 'ema_12' | 'ema_26' | 'bollinger' | 'rsi' | 'macd';

const TIMEFRAMES: Timeframe[] = ['1D', '1W', '1M', '3M', '1Y', '3Y'];

const INDICATOR_LABELS: Record<Indicator, string> = {
  sma_20: 'SMA 20', sma_50: 'SMA 50', ema_12: 'EMA 12', ema_26: 'EMA 26',
  bollinger: 'Bollinger', rsi: 'RSI', macd: 'MACD',
};

const INDICATOR_COLORS: Record<string, string> = {
  sma_20: '#3b82f6', sma_50: '#f59e0b', ema_12: '#06b6d4', ema_26: '#ec4899',
  bollinger_upper: '#94a3b8', bollinger_lower: '#94a3b8',
  rsi: '#a855f7', macd_line: '#3b82f6', macd_signal: '#f59e0b',
};

const MARKET_FLAG: Record<string, string> = { US: '🇺🇸', EU: '🇪🇺', ASIA: '🌏' };

const REC_COLORS: Record<string, string> = {
  strong_buy: '#00c853', buy: '#56d364', hold: '#d29922', sell: '#ff6e40', strong_sell: '#ff1744',
};

/* ─── Helpers ─── */
function fmt(n: number | null | undefined): string {
  if (n == null) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}

function fmtLarge(n: number | null | undefined): string {
  if (n == null) return '—';
  if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  return fmt(n);
}

function fmtPct(n: number | null | undefined): string {
  if (n == null) return '—';
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}

function fmtDate(iso: string | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtShortDate(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/* ─── Component ─── */
export default function StockDetailModal({ symbolOrId, onClose }: StockDetailModalProps) {
  const { data, isLoading, error, refetch } = useStockDetail(symbolOrId);
  const [timeframe, setTimeframe] = useState<Timeframe>('3M');
  const [indicators, setIndicators] = useState<Set<Indicator>>(new Set(['sma_20', 'sma_50']));
  const [expandedTrade, setExpandedTrade] = useState<number | null>(null);

  // Close on Escape
  const handleKey = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  }, [onClose]);

  useEffect(() => {
    document.addEventListener('keydown', handleKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.body.style.overflow = '';
    };
  }, [handleKey]);

  const toggleIndicator = (ind: Indicator) => {
    setIndicators(prev => {
      const next = new Set(prev);
      if (next.has(ind)) next.delete(ind);
      else next.add(ind);
      return next;
    });
  };

  const detail = data?.data ?? data ?? {};
  const stock = detail.stock ?? {};
  const quote = detail.quote ?? {};
  const charts = detail.charts ?? {};
  const fundamentals = detail.fundamentals ?? {};
  const technicals = detail.technicals ?? {};
  const position = detail.position;
  const latestAnalysis = detail.latest_analysis;
  const recentTrades = detail.recent_trades ?? [];
  const indicatorSeries = detail.indicator_series ?? {};

  const chartData = useMemo(() => {
    const raw = charts[timeframe] ?? [];
    if (!Array.isArray(raw)) return [];
    return raw.map((pt: any) => {
      const entry: any = { ...pt };
      // Indicator series from the server is only available for 3M data
      if (timeframe === '3M') {
        for (const [key, series] of Object.entries(indicatorSeries)) {
          if (Array.isArray(series)) {
            const match = (series as any[]).find((s: any) => s.date === pt.date);
            if (match) entry[key] = match.value ?? match.close;
          }
        }
      }
      return entry;
    });
  }, [charts, timeframe, indicatorSeries]);

  // Overlay click handler
  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  /* ─── Custom Tooltip ─── */
  const ChartTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    const d = payload[0]?.payload;
    return (
      <div style={{
        background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)',
        borderRadius: 'var(--radius-sm)', padding: '0.6rem 0.8rem', fontSize: '0.8rem',
      }}>
        <div style={{ fontWeight: 600, marginBottom: '0.3rem', color: 'var(--text-secondary)' }}>
          {fmtShortDate(d?.date ?? label)}
        </div>
        {d?.open != null && (
          <div style={{ display: 'grid', gridTemplateColumns: 'auto auto', gap: '0 0.75rem' }}>
            <span style={{ color: 'var(--text-muted)' }}>O</span><span>{fmt(d.open)}</span>
            <span style={{ color: 'var(--text-muted)' }}>H</span><span>{fmt(d.high)}</span>
            <span style={{ color: 'var(--text-muted)' }}>L</span><span>{fmt(d.low)}</span>
            <span style={{ color: 'var(--text-muted)' }}>C</span><span>{fmt(d.close)}</span>
            <span style={{ color: 'var(--text-muted)' }}>V</span><span>{d.volume?.toLocaleString() ?? '—'}</span>
          </div>
        )}
        {payload.filter((p: any) => p.dataKey !== 'close' && p.dataKey !== 'volume' && p.dataKey !== 'bollinger_lower').map((p: any) => (
          <div key={p.dataKey} style={{ display: 'flex', gap: '0.5rem', marginTop: '0.15rem' }}>
            <span style={{ color: p.color || 'var(--text-muted)', fontSize: '0.75rem' }}>{p.name ?? p.dataKey}</span>
            <span style={{ fontSize: '0.75rem' }}>{typeof p.value === 'number' ? p.value.toFixed(2) : '—'}</span>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div
      onClick={handleOverlayClick}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.7)', display: 'flex',
        alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div style={{
        width: '90vw', maxWidth: 1200, maxHeight: '85vh', overflow: 'auto',
        background: 'var(--bg-primary)', border: '1px solid var(--border-primary)',
        borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-elevated)',
        position: 'relative',
      }}>
        {/* Close button */}
        <button
          onClick={onClose}
          style={{
            position: 'sticky', top: '0.75rem', float: 'right', marginRight: '0.75rem',
            zIndex: 10, background: 'var(--bg-tertiary)', border: '1px solid var(--border-primary)',
            borderRadius: '50%', width: 32, height: 32, display: 'flex',
            alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
            color: 'var(--text-secondary)', fontSize: '1rem', fontWeight: 700,
          }}
        >
          ✕
        </button>

        <div style={{ padding: '1.5rem' }}>
          {/* ─── Loading State ─── */}
          {isLoading && (
            <div>
              <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem' }}>
                <div style={{ width: 100, height: 28, background: 'var(--bg-tertiary)', borderRadius: 4, animation: 'pulse 1.5s ease-in-out infinite' }} />
                <div style={{ width: 200, height: 28, background: 'var(--bg-tertiary)', borderRadius: 4, animation: 'pulse 1.5s ease-in-out infinite' }} />
              </div>
              <div style={{ height: 400, background: 'var(--bg-tertiary)', borderRadius: 'var(--radius)', marginBottom: '1rem', animation: 'pulse 1.5s ease-in-out infinite' }} />
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.75rem' }}>
                {[1,2,3,4,5,6,7,8].map(i => (
                  <div key={i} style={{ height: 50, background: 'var(--bg-tertiary)', borderRadius: 4, animation: 'pulse 1.5s ease-in-out infinite' }} />
                ))}
              </div>
              <style>{`@keyframes pulse { 0%,100% { opacity: 0.4; } 50% { opacity: 0.7; } }`}</style>
            </div>
          )}

          {/* ─── Error State ─── */}
          {error && !isLoading && (
            <div style={{ textAlign: 'center', padding: '3rem' }}>
              <div style={{ fontSize: '1.1rem', color: 'var(--loss)', marginBottom: '1rem' }}>
                Failed to load stock details
              </div>
              <div style={{ color: 'var(--text-muted)', marginBottom: '1rem', fontSize: '0.85rem' }}>
                {(error as Error).message}
              </div>
              <button
                onClick={() => refetch()}
                style={{
                  background: 'var(--accent)', color: '#0d1117', border: 'none',
                  borderRadius: 'var(--radius-sm)', padding: '0.5rem 1.25rem',
                  fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer',
                }}
              >
                Retry
              </button>
            </div>
          )}

          {/* ─── Content ─── */}
          {!isLoading && !error && (
            <>
              {/* ═══ HEADER ═══ */}
              <div style={{ marginBottom: '1.25rem' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
                  <span style={{ fontSize: '1.6rem', fontWeight: 800, color: '#00d4aa' }}>
                    {stock.symbol}
                  </span>
                  <span style={{ fontSize: '1.1rem', color: 'var(--text-secondary)', fontWeight: 500 }}>
                    {stock.name || ''}
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
                  {/* Market badge */}
                  {stock.market && (
                    <span style={{
                      padding: '0.15rem 0.5rem', borderRadius: '4px', fontSize: '0.78rem', fontWeight: 600,
                      background: stock.market === 'US' ? 'rgba(88,166,255,0.12)' : stock.market === 'EU' ? 'rgba(63,185,80,0.12)' : 'rgba(240,136,62,0.12)',
                      color: stock.market === 'US' ? '#58a6ff' : stock.market === 'EU' ? '#3fb950' : '#f0883e',
                    }}>
                      {MARKET_FLAG[stock.market] || '🌐'} {stock.market}
                    </span>
                  )}
                  {/* Sector */}
                  {stock.sector && (
                    <span style={{
                      padding: '0.15rem 0.5rem', borderRadius: '4px', fontSize: '0.78rem',
                      background: 'var(--bg-tertiary)', color: 'var(--text-secondary)',
                    }}>
                      {stock.sector}
                    </span>
                  )}
                  {/* Asset type */}
                  <span style={{
                    padding: '0.15rem 0.5rem', borderRadius: '4px', fontSize: '0.78rem', fontWeight: 600,
                    background: 'var(--accent-bg)', color: 'var(--accent)',
                    textTransform: 'uppercase',
                  }}>
                    {stock.asset_type || stock.assetType || 'Stock'}
                  </span>
                </div>

                {/* Price + change */}
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.75rem', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '1.8rem', fontWeight: 700 }}>
                    {fmt(quote.price)}
                  </span>
                  {quote.change != null && (
                    <>
                      <span style={{
                        fontSize: '1rem', fontWeight: 600,
                        color: (quote.change ?? 0) >= 0 ? 'var(--profit)' : 'var(--loss)',
                      }}>
                        {(quote.change ?? 0) >= 0 ? '+' : ''}
                        {fmt(quote.change)}
                      </span>
                      <span style={{
                        fontSize: '0.9rem', fontWeight: 600,
                        color: (quote.change_pct ?? 0) >= 0 ? 'var(--profit)' : 'var(--loss)',
                      }}>
                        ({fmtPct(quote.change_pct)})
                      </span>
                    </>
                  )}
                  {/* Exchange + Currency badges */}
                  {quote.exchange && (
                    <span style={{
                      padding: '0.1rem 0.4rem', borderRadius: '4px', fontSize: '0.72rem',
                      background: 'var(--bg-tertiary)', color: 'var(--text-muted)',
                    }}>
                      {quote.exchange}
                    </span>
                  )}
                  {quote.currency && (
                    <span style={{
                      fontSize: '0.8rem', color: 'var(--text-muted)',
                    }}>
                      {quote.currency}
                    </span>
                  )}
                </div>

                {/* Position info */}
                {position && (
                  <div style={{
                    marginTop: '0.75rem', padding: '0.6rem 0.85rem', borderRadius: 'var(--radius-sm)',
                    background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)',
                    display: 'flex', gap: '1.5rem', flexWrap: 'wrap', fontSize: '0.85rem',
                  }}>
                    <span style={{ color: 'var(--text-muted)' }}>Position:</span>
                    <span><strong>{position.quantity}</strong> shares</span>
                    <span>Avg cost: <strong>{fmt(position.average_cost)}</strong></span>
                    <span style={{ color: (position.unrealised_pnl ?? 0) >= 0 ? 'var(--profit)' : 'var(--loss)', fontWeight: 600 }}>
                      P&L: {fmt(position.unrealised_pnl)} ({fmtPct(position.unrealised_pnl_pct)})
                    </span>
                  </div>
                )}
              </div>

              {/* ═══ APEX ANALYSIS ═══ */}
              {latestAnalysis && (
                <div style={{
                  background: 'var(--bg-secondary)', borderRadius: 'var(--radius)',
                  border: '1px solid var(--border-primary)', padding: '1rem', marginBottom: '1.25rem',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      APEX Analysis
                    </span>
                    {/* Recommendation badge */}
                    <span style={{
                      padding: '0.2rem 0.65rem', borderRadius: '9999px', fontSize: '0.78rem',
                      fontWeight: 700, textTransform: 'uppercase',
                      color: REC_COLORS[latestAnalysis.recommendation] || 'var(--text-primary)',
                      background: `${REC_COLORS[latestAnalysis.recommendation] || '#666'}20`,
                      border: `1px solid ${REC_COLORS[latestAnalysis.recommendation] || '#666'}40`,
                    }}>
                      {(latestAnalysis.recommendation || '').replace(/_/g, ' ')}
                    </span>
                    <span style={{ fontSize: '0.85rem' }}>
                      Score: <strong>{latestAnalysis.composite_score?.toFixed(3)}</strong>
                    </span>
                    <span style={{ fontSize: '0.85rem' }}>
                      Confidence: <strong>{((latestAnalysis.confidence ?? latestAnalysis.confidence_level ?? 0) * 100).toFixed(0)}%</strong>
                    </span>
                  </div>

                  {/* Signal breakdown bars */}
                  {latestAnalysis.signal_breakdown && typeof latestAnalysis.signal_breakdown === 'object' && (
                    <div style={{ marginBottom: '0.75rem' }}>
                      {Object.entries(latestAnalysis.signal_breakdown)
                        .filter(([src]) => src !== 'llm')
                        .map(([src, val]: [string, any]) => {
                        const score = typeof val === 'number' ? val : val?.score ?? 0;
                        const direction = val?.direction;
                        // score is 0-100; bar fills proportionally
                        const pct = Math.min(Math.abs(score), 100);
                        const isBullish = direction === 'bullish' || (!direction && score > 50);
                        return (
                          <div key={src} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.3rem' }}>
                            <span style={{ width: 90, fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'capitalize' }}>
                              {src.replace(/_/g, ' ')}
                            </span>
                            <div style={{ flex: 1, height: 8, background: 'var(--bg-tertiary)', borderRadius: 4, overflow: 'hidden' }}>
                              <div style={{
                                width: `${pct}%`, height: '100%', borderRadius: 4,
                                background: isBullish ? 'var(--profit)' : score < 50 ? 'var(--loss)' : 'var(--text-muted)',
                                transition: 'width 0.3s',
                              }} />
                            </div>
                            <span style={{ fontSize: '0.75rem', color: isBullish ? 'var(--profit)' : score < 50 ? 'var(--loss)' : 'var(--text-muted)', width: 40, textAlign: 'right' }}>
                              {score.toFixed(0)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Rationale */}
                  {latestAnalysis.rationale && (
                    <div style={{
                      fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.6,
                      maxHeight: 200, overflow: 'auto', padding: '0.5rem',
                      background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-sm)',
                      whiteSpace: 'pre-wrap',
                    }}>
                      {latestAnalysis.rationale}
                    </div>
                  )}

                  {latestAnalysis.analyzed_at && (
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
                      Analysis: {fmtDate(latestAnalysis.analyzed_at)}
                    </div>
                  )}
                </div>
              )}

              {/* ═══ KEY STATS GRID ═══ */}
              <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.5rem',
                marginBottom: '1.25rem',
              }}>
                {[
                  { label: 'P/E Ratio', val: (quote.pe ?? fundamentals.pe_ratio)?.toFixed(2) },
                  { label: 'P/B Ratio', val: fundamentals.pb_ratio?.toFixed(2) },
                  { label: 'EPS', val: fundamentals.eps != null ? `$${fundamentals.eps.toFixed(2)}` : null },
                  { label: 'Dividend Yield', val: fundamentals.dividend_yield != null ? `${(fundamentals.dividend_yield * 100).toFixed(2)}%` : null },
                  { label: 'Market Cap', val: fmtLarge(quote.market_cap ?? fundamentals.market_cap) !== '—' ? fmtLarge(quote.market_cap ?? fundamentals.market_cap) : null },
                  { label: 'Volume', val: quote.volume != null ? quote.volume.toLocaleString() : null },
                  { label: 'Prev Close', val: quote.previous_close != null ? fmt(quote.previous_close) : null },
                  { label: '52-Week High', val: fundamentals.week_52_high != null ? fmt(fundamentals.week_52_high) : null },
                  { label: '52-Week Low', val: fundamentals.week_52_low != null ? fmt(fundamentals.week_52_low) : null },
                  { label: 'Beta', val: fundamentals.beta?.toFixed(2) },
                  { label: 'RSI (14)', val: technicals.rsi_14?.toFixed(1) },
                  { label: 'SMA 20', val: technicals.sma_20 != null ? fmt(technicals.sma_20) : null },
                  { label: 'SMA 50', val: technicals.sma_50 != null ? fmt(technicals.sma_50) : null },
                  { label: 'ATR (14)', val: technicals.atr_14?.toFixed(2) },
                ].map(({ label, val }) => (
                  <div key={label} style={{
                    background: 'var(--bg-secondary)', borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border-secondary)', padding: '0.6rem 0.75rem',
                  }}>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.2rem' }}>
                      {label}
                    </div>
                    <div style={{ fontSize: '0.95rem', fontWeight: 600, color: val ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                      {val ?? '—'}
                    </div>
                  </div>
                ))}
              </div>

              {/* ═══ CHART SECTION ═══ */}
              <div style={{
                background: 'var(--bg-secondary)', borderRadius: 'var(--radius)',
                border: '1px solid var(--border-primary)', padding: '1rem', marginBottom: '1.25rem',
              }}>
                {/* Timeframe tabs */}
                <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '0.75rem' }}>
                  {TIMEFRAMES.map(tf => (
                    <button
                      key={tf}
                      onClick={() => setTimeframe(tf)}
                      style={{
                        padding: '0.3rem 0.75rem', borderRadius: 'var(--radius-sm)',
                        border: 'none', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600,
                        background: tf === timeframe ? '#00d4aa' : 'var(--bg-tertiary)',
                        color: tf === timeframe ? '#0d1117' : 'var(--text-secondary)',
                        transition: 'all 0.15s',
                      }}
                    >
                      {tf}
                    </button>
                  ))}
                </div>

                {/* Indicator toggles */}
                <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
                  {(Object.entries(INDICATOR_LABELS) as [Indicator, string][]).map(([key, label]) => {
                    const active = indicators.has(key);
                    const col = INDICATOR_COLORS[key] || INDICATOR_COLORS[key + '_line'] || 'var(--text-muted)';
                    return (
                      <button
                        key={key}
                        onClick={() => toggleIndicator(key)}
                        style={{
                          padding: '0.2rem 0.6rem', borderRadius: '9999px',
                          border: `1px solid ${active ? col : 'var(--border-primary)'}`,
                          background: active ? `${col}18` : 'transparent',
                          color: active ? col : 'var(--text-muted)',
                          fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer',
                          transition: 'all 0.15s',
                        }}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>

                {chartData.length === 0 ? (
                  <div className="empty-state" style={{ padding: '3rem 0' }}>
                    No chart data available for this timeframe.
                  </div>
                ) : (
                  <>
                    {/* Price chart */}
                    <ResponsiveContainer width="100%" height={320}>
                      <ComposedChart data={chartData} syncId="stock-detail" margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                        <defs>
                          <linearGradient id="priceGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#00d4aa" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="#00d4aa" stopOpacity={0.05} />
                          </linearGradient>
                          {indicators.has('bollinger') && (
                            <linearGradient id="bollingerGrad" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="#94a3b8" stopOpacity={0.15} />
                              <stop offset="100%" stopColor="#94a3b8" stopOpacity={0.05} />
                            </linearGradient>
                          )}
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border-primary)" strokeOpacity={0.3} />
                        <XAxis
                          dataKey="date" stroke="#6e7681" fontSize={10} tickLine={false}
                          tickFormatter={fmtShortDate}
                        />
                        <YAxis
                          stroke="#6e7681" fontSize={10} tickLine={false} width={60}
                          domain={['auto', 'auto']}
                          tickFormatter={(v: number) => `$${v.toFixed(0)}`}
                        />
                        <Tooltip content={<ChartTooltip />} />

                        {/* Bollinger bands */}
                        {indicators.has('bollinger') && (
                          <>
                            <Area
                              type="monotone" dataKey="bollinger_upper" stroke="#94a3b8" strokeWidth={1}
                              fill="url(#bollingerGrad)" strokeDasharray="4 2" dot={false} name="BB Upper"
                            />
                            <Area
                              type="monotone" dataKey="bollinger_lower" stroke="#94a3b8" strokeWidth={1}
                              fill="transparent" strokeDasharray="4 2" dot={false} name="BB Lower"
                            />
                          </>
                        )}

                        {/* Price area */}
                        <Area
                          type="monotone" dataKey="close" stroke="#00d4aa" strokeWidth={2}
                          fill="url(#priceGrad)" dot={false} name="Price"
                        />

                        {/* SMA / EMA overlays */}
                        {indicators.has('sma_20') && (
                          <Line type="monotone" dataKey="sma_20" stroke="#3b82f6" strokeWidth={1.5} dot={false} name="SMA 20" />
                        )}
                        {indicators.has('sma_50') && (
                          <Line type="monotone" dataKey="sma_50" stroke="#f59e0b" strokeWidth={1.5} dot={false} name="SMA 50" />
                        )}
                        {indicators.has('ema_12') && (
                          <Line type="monotone" dataKey="ema_12" stroke="#06b6d4" strokeWidth={1.5} strokeDasharray="6 3" dot={false} name="EMA 12" />
                        )}
                        {indicators.has('ema_26') && (
                          <Line type="monotone" dataKey="ema_26" stroke="#ec4899" strokeWidth={1.5} strokeDasharray="6 3" dot={false} name="EMA 26" />
                        )}
                      </ComposedChart>
                    </ResponsiveContainer>

                    {/* Volume chart */}
                    <ResponsiveContainer width="100%" height={100}>
                      <BarChart data={chartData} syncId="stock-detail" margin={{ top: 0, right: 10, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border-primary)" strokeOpacity={0.3} />
                        <XAxis dataKey="date" stroke="#6e7681" fontSize={10} tickLine={false} tickFormatter={fmtShortDate} />
                        <YAxis stroke="#6e7681" fontSize={9} tickLine={false} width={60} tickFormatter={(v: number) => {
                          if (v >= 1e6) return `${(v / 1e6).toFixed(0)}M`;
                          if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
                          return String(v);
                        }} />
                        <Tooltip content={<ChartTooltip />} />
                        <Bar
                          dataKey="volume" name="Volume"
                          fill="var(--text-muted)" fillOpacity={0.3}
                          shape={(props: any) => {
                            const { x, y, width, height, payload } = props;
                            const isUp = (payload.close ?? 0) >= (payload.open ?? 0);
                            return <rect x={x} y={y} width={width} height={height} fill={isUp ? 'var(--profit)' : 'var(--loss)'} fillOpacity={0.35} />;
                          }}
                        />
                      </BarChart>
                    </ResponsiveContainer>

                    {/* RSI sub-chart */}
                    {indicators.has('rsi') && (
                      <ResponsiveContainer width="100%" height={100}>
                        <LineChart data={chartData} syncId="stock-detail" margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-primary)" strokeOpacity={0.3} />
                          <XAxis dataKey="date" stroke="#6e7681" fontSize={9} tickLine={false} tickFormatter={fmtShortDate} />
                          <YAxis domain={[0, 100]} stroke="#6e7681" fontSize={9} tickLine={false} width={60} ticks={[0, 30, 50, 70, 100]} />
                          <ReferenceLine y={70} stroke="var(--loss)" strokeDasharray="3 3" strokeOpacity={0.5} />
                          <ReferenceLine y={30} stroke="var(--profit)" strokeDasharray="3 3" strokeOpacity={0.5} />
                          <Tooltip content={<ChartTooltip />} />
                          <Line type="monotone" dataKey="rsi" stroke="#a855f7" strokeWidth={1.5} dot={false} name="RSI" />
                        </LineChart>
                      </ResponsiveContainer>
                    )}

                    {/* MACD sub-chart */}
                    {indicators.has('macd') && (
                      <ResponsiveContainer width="100%" height={100}>
                        <ComposedChart data={chartData} syncId="stock-detail" margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-primary)" strokeOpacity={0.3} />
                          <XAxis dataKey="date" stroke="#6e7681" fontSize={9} tickLine={false} tickFormatter={fmtShortDate} />
                          <YAxis stroke="#6e7681" fontSize={9} tickLine={false} width={60} />
                          <ReferenceLine y={0} stroke="var(--border-primary)" />
                          <Tooltip content={<ChartTooltip />} />
                          <Bar
                            dataKey="macd_histogram" name="Histogram"
                            shape={(props: any) => {
                              const { x, y, width, height, payload } = props;
                              const val = payload.macd_histogram ?? 0;
                              return <rect x={x} y={y} width={width} height={height} fill={val >= 0 ? 'var(--profit)' : 'var(--loss)'} fillOpacity={0.6} />;
                            }}
                          />
                          <Line type="monotone" dataKey="macd_line" stroke="#3b82f6" strokeWidth={1.5} dot={false} name="MACD" />
                          <Line type="monotone" dataKey="macd_signal" stroke="#f59e0b" strokeWidth={1.5} dot={false} name="Signal" />
                        </ComposedChart>
                      </ResponsiveContainer>
                    )}
                  </>
                )}
              </div>

              {/* ═══ RECENT TRADES ═══ */}
              {recentTrades.length > 0 && (
                <div style={{
                  background: 'var(--bg-secondary)', borderRadius: 'var(--radius)',
                  border: '1px solid var(--border-primary)', padding: '1rem',
                }}>
                  <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.5rem' }}>
                    Recent Trades
                  </div>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Action</th>
                        <th className="right">Qty</th>
                        <th className="right">Price</th>
                        <th className="right">Total</th>
                        <th className="right">Conf.</th>
                        <th>Date</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentTrades.map((t: any, i: number) => (
                        <>
                          <tr key={t.id ?? i}>
                            <td>
                              <span className={`badge ${t.action === 'buy' ? 'badge-buy' : 'badge-sell'}`}>
                                {t.action}
                              </span>
                            </td>
                            <td className="right">{t.quantity}</td>
                            <td className="right mono">{fmt(t.price_per_share ?? t.price)}</td>
                            <td className="right mono">{fmt(t.total_value ?? (t.quantity * (t.price_per_share ?? t.price)))}</td>
                            <td className="right">{(t.confidence ?? t.confidence_level) != null ? `${((t.confidence ?? t.confidence_level) * 100).toFixed(0)}%` : '—'}</td>
                            <td style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                              {fmtDate(t.executed_at ?? t.created_at)}
                            </td>
                            <td>
                              {t.rationale && (
                                <button
                                  onClick={() => setExpandedTrade(expandedTrade === i ? null : i)}
                                  style={{
                                    background: 'none', border: 'none', color: 'var(--accent)',
                                    cursor: 'pointer', fontSize: '0.75rem',
                                  }}
                                >
                                  {expandedTrade === i ? '▾' : '▸'} Why
                                </button>
                              )}
                            </td>
                          </tr>
                          {expandedTrade === i && t.rationale && (
                            <tr key={`${t.id ?? i}-rationale`}>
                              <td colSpan={7} className="expanded-content">
                                {t.rationale}
                              </td>
                            </tr>
                          )}
                        </>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
