import { useState, useMemo, useCallback } from 'react';
import { useTrades, type TradeFilters } from '../hooks/useApi';

function fmt(n: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}

export default function Trades() {
  const [filters, setFilters] = useState<TradeFilters>({ page: 1, pageSize: 50 });
  const [symbolFilter, setSymbolFilter] = useState('');
  const [actionFilter, setActionFilter] = useState<'' | 'buy' | 'sell'>('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const { data, isLoading, error } = useTrades(filters);
  const allTrades: any[] = data?.data ?? [];

  // Client-side filtering (server pagination, client filtering for symbol/action/date)
  const trades = useMemo(() => {
    let result = allTrades;
    if (symbolFilter) {
      const q = symbolFilter.toUpperCase();
      result = result.filter((t: any) => t.symbol?.toUpperCase().includes(q));
    }
    if (actionFilter) {
      result = result.filter((t: any) => t.action === actionFilter);
    }
    if (dateFrom) {
      const from = new Date(dateFrom).getTime();
      result = result.filter((t: any) => new Date(t.executed_at).getTime() >= from);
    }
    if (dateTo) {
      const to = new Date(dateTo).getTime() + 86400000;
      result = result.filter((t: any) => new Date(t.executed_at).getTime() < to);
    }
    return result;
  }, [allTrades, symbolFilter, actionFilter, dateFrom, dateTo]);

  const toggleExpand = useCallback((id: number) => {
    setExpandedId(prev => prev === id ? null : id);
  }, []);

  // Try to parse signal snapshot for expanded view
  function parseSnapshot(json: string | null): Record<string, any> | null {
    if (!json) return null;
    try { return JSON.parse(json); } catch { return null; }
  }

  if (isLoading) return <div className="loading-state">Loading trades…</div>;
  if (error) return <div className="error-state">Error: {(error as Error).message}</div>;

  return (
    <div>
      <h1 style={{ fontSize: '1.35rem', fontWeight: 700, marginBottom: '1.5rem' }}>Trade History</h1>

      {/* ─── Filters ─── */}
      <div className="filter-bar">
        <label>Symbol</label>
        <input
          type="text"
          placeholder="e.g. AAPL"
          value={symbolFilter}
          onChange={e => setSymbolFilter(e.target.value)}
          style={{ width: '100px' }}
        />
        <label>Action</label>
        <select value={actionFilter} onChange={e => setActionFilter(e.target.value as any)}>
          <option value="">All</option>
          <option value="buy">Buy</option>
          <option value="sell">Sell</option>
        </select>
        <label>From</label>
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
        <label>To</label>
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} />
        {(symbolFilter || actionFilter || dateFrom || dateTo) && (
          <button
            onClick={() => { setSymbolFilter(''); setActionFilter(''); setDateFrom(''); setDateTo(''); }}
            style={{
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-primary)',
              color: 'var(--text-secondary)',
              borderRadius: 'var(--radius-sm)',
              padding: '0.35rem 0.75rem',
              cursor: 'pointer',
              fontSize: '0.8rem',
            }}
          >
            Clear
          </button>
        )}
      </div>

      {/* ─── Trade Table ─── */}
      <div className="card">
        {trades.length === 0 ? (
          <div className="empty-state">
            <p>No trades match your filters. The agent trades autonomously when confidence ≥ 55%.</p>
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: '28px' }}></th>
                <th>Date</th>
                <th>Symbol</th>
                <th>Action</th>
                <th className="right">Shares</th>
                <th className="right">Price</th>
                <th className="right">Total</th>
                <th className="right">Conf.</th>
                <th>Rationale</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((t: any) => {
                const isExpanded = expandedId === t.id;
                const snapshot = parseSnapshot(t.signal_snapshot);
                return (
                  <tr key={t.id} style={{ cursor: 'pointer' }} onClick={() => toggleExpand(t.id)}>
                    <td style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      {isExpanded ? '▾' : '▸'}
                    </td>
                    <td style={{ color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                      {new Date(t.executed_at).toLocaleDateString()}
                    </td>
                    <td style={{ fontWeight: 600 }}>{t.symbol}</td>
                    <td>
                      <span className={`badge ${t.action === 'buy' ? 'badge-buy' : 'badge-sell'}`}>
                        {t.action}
                      </span>
                    </td>
                    <td className="right">{t.quantity}</td>
                    <td className="right mono">{fmt(t.price_per_share)}</td>
                    <td className="right mono">{fmt(t.total_value)}</td>
                    <td className="right">{(t.confidence * 100).toFixed(0)}%</td>
                    <td style={{
                      color: 'var(--text-secondary)',
                      maxWidth: isExpanded ? 'none' : '250px',
                      overflow: isExpanded ? 'visible' : 'hidden',
                      textOverflow: isExpanded ? 'unset' : 'ellipsis',
                      whiteSpace: isExpanded ? 'normal' : 'nowrap',
                    }}>
                      {t.rationale}
                      {isExpanded && snapshot && (
                        <div className="expanded-content" style={{ marginTop: '0.75rem', borderRadius: 'var(--radius-sm)' }}>
                          <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.5rem' }}>Signal Snapshot</div>
                          {Object.entries(snapshot).map(([key, val]) => (
                            <div key={key} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.2rem 0', borderBottom: '1px solid var(--border-secondary)' }}>
                              <span style={{ textTransform: 'capitalize' }}>{key.replace(/_/g, ' ')}</span>
                              <span style={{ color: 'var(--text-primary)', fontFamily: 'monospace' }}>
                                {typeof val === 'object' ? JSON.stringify(val) : String(val)}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination info */}
      {data?.total != null && data.total > (filters.pageSize ?? 50) && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem', marginTop: '1rem' }}>
          <button
            disabled={(filters.page ?? 1) <= 1}
            onClick={() => setFilters(f => ({ ...f, page: (f.page ?? 1) - 1 }))}
            style={{
              background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)',
              color: 'var(--text-secondary)', borderRadius: 'var(--radius-sm)',
              padding: '0.4rem 1rem', cursor: 'pointer',
            }}
          >
            ← Prev
          </button>
          <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem', alignSelf: 'center' }}>
            Page {filters.page ?? 1}
          </span>
          <button
            onClick={() => setFilters(f => ({ ...f, page: (f.page ?? 1) + 1 }))}
            style={{
              background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)',
              color: 'var(--text-secondary)', borderRadius: 'var(--radius-sm)',
              padding: '0.4rem 1rem', cursor: 'pointer',
            }}
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
