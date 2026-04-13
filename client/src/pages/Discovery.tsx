import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  useWatchlist, useSystemStatus, useDiscoverStocks,
  useRunAnalysis, useRemoveStock,
} from '../hooks/useApi';
import { api } from '../api/client';

const MARKET_FLAG: Record<string, string> = { US: '🇺🇸', EU: '🇪🇺', ASIA: '🌏' };
const MARKET_COLOR: Record<string, string> = {
  US: '#58a6ff',
  EU: '#3fb950',
  ASIA: '#f0883e',
};

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return 'Never';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function fmtPrice(n: number | null | undefined): string {
  if (n == null) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}

export default function Discovery() {
  const watchlist = useWatchlist();
  const status = useSystemStatus();
  const discover = useDiscoverStocks();
  const analyze = useRunAnalysis();
  const remove = useRemoveStock();

  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const [addForm, setAddForm] = useState({ symbol: '', market: 'US', assetType: 'stock', sector: '' });

  function showToast(msg: string, type: 'success' | 'error' = 'success') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!addForm.symbol.trim()) return;
    try {
      await api.addStock({
        symbol: addForm.symbol.trim().toUpperCase(),
        name: addForm.symbol.trim().toUpperCase(),
        market: addForm.market,
        assetType: addForm.assetType,
        sector: addForm.sector || undefined,
      } as any);
      showToast(`Added ${addForm.symbol.toUpperCase()} to watchlist`);
      setAddForm({ symbol: '', market: 'US', assetType: 'stock', sector: '' });
      watchlist.refetch();
    } catch (err: any) {
      showToast(err.message || 'Failed to add stock', 'error');
    }
  }

  function handleDiscover() {
    discover.mutate(undefined, {
      onSuccess: () => showToast('Discovery run completed'),
      onError: (err: any) => showToast(err.message || 'Discovery failed', 'error'),
    });
  }

  function handleAnalyze() {
    analyze.mutate(undefined, {
      onSuccess: () => showToast('Analysis pipeline started'),
      onError: (err: any) => showToast(err.message || 'Analysis failed', 'error'),
    });
  }

  function handleRemove(id: number, symbol: string) {
    remove.mutate(id, {
      onSuccess: () => showToast(`Removed ${symbol}`),
      onError: (err: any) => showToast(err.message || 'Failed to remove', 'error'),
    });
  }

  const s = status.data?.data ?? status.data ?? {};
  const apis = s.apis ?? {};
  const stocks = useMemo(() => {
    const raw = watchlist.data?.data ?? watchlist.data ?? [];
    if (!Array.isArray(raw)) return [];
    return [...raw].sort((a: any, b: any) => {
      const mOrder: Record<string, number> = { US: 0, EU: 1, ASIA: 2 };
      const mCmp = (mOrder[a.market] ?? 3) - (mOrder[b.market] ?? 3);
      if (mCmp !== 0) return mCmp;
      return (a.symbol ?? '').localeCompare(b.symbol ?? '');
    });
  }, [watchlist.data]);

  const recentlyDiscovered = useMemo(() => {
    if (!Array.isArray(stocks)) return [];
    return [...stocks]
      .filter((s: any) => s.created_at)
      .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 10);
  }, [stocks]);

  return (
    <div>
      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', top: 'calc(var(--header-height) + 12px)', right: '2rem',
          padding: '0.75rem 1.25rem', borderRadius: 'var(--radius-sm)', zIndex: 100,
          background: toast.type === 'success' ? 'var(--profit-bg)' : 'var(--loss-bg)',
          color: toast.type === 'success' ? 'var(--profit)' : 'var(--loss)',
          border: `1px solid ${toast.type === 'success' ? 'var(--profit)' : 'var(--loss)'}`,
          fontSize: '0.85rem', fontWeight: 500, boxShadow: 'var(--shadow-elevated)',
        }}>
          {toast.msg}
        </div>
      )}

      <h1 style={{ fontSize: '1.35rem', fontWeight: 700, marginBottom: '1.5rem' }}>
        Discovery &amp; Watchlist
      </h1>

      {/* ─── System Status Cards ─── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
        <div className="card">
          <div className="card-header">API Status</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginTop: '0.25rem' }}>
            {['yahoo_finance', 'finnhub', 'google_trends'].map((key) => {
              const label = key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
              const active = apis[key] === true || apis[key] === 'configured';
              return (
                <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem' }}>
                  <span className={`status-dot ${active ? 'status-active' : 'status-error'}`} />
                  <span style={{ color: active ? 'var(--text-primary)' : 'var(--text-muted)' }}>{label}</span>
                </div>
              );
            })}
          </div>
        </div>
        <div className="card">
          <div className="card-header">Last Analysis</div>
          <div className="card-value" style={{ fontSize: '1.1rem' }}>{timeAgo(s.lastAnalysisRun ?? s.last_analysis_run)}</div>
        </div>
        <div className="card">
          <div className="card-header">Tracked Stocks</div>
          <div className="card-value">{s.totalStocks ?? s.total_stocks ?? stocks.length}</div>
          <div className="card-subtitle">across {s.markets ?? 3} markets</div>
        </div>
        <div className="card">
          <div className="card-header">Next Scheduled Run</div>
          <div className="card-value" style={{ fontSize: '1.1rem' }}>
            {(s.nextScheduledRun ?? s.next_scheduled_run)
              ? new Date(s.nextScheduledRun ?? s.next_scheduled_run).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
              : 'Pending'}
          </div>
        </div>
      </div>

      {/* ─── Manual Controls ─── */}
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div className="card-header">Controls</div>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end', flexWrap: 'wrap', marginTop: '0.5rem' }}>
          {/* Add Stock Form */}
          <form onSubmit={handleAdd} style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
              <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Symbol</label>
              <input
                value={addForm.symbol}
                onChange={(e) => setAddForm({ ...addForm, symbol: e.target.value })}
                placeholder="AAPL"
                style={{
                  background: 'var(--bg-tertiary)', border: '1px solid var(--border-primary)',
                  borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)',
                  padding: '0.4rem 0.6rem', fontSize: '0.85rem', width: '90px',
                }}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
              <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Market</label>
              <select
                value={addForm.market}
                onChange={(e) => setAddForm({ ...addForm, market: e.target.value })}
                style={{
                  background: 'var(--bg-tertiary)', border: '1px solid var(--border-primary)',
                  borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)',
                  padding: '0.4rem 0.6rem', fontSize: '0.85rem',
                }}
              >
                <option value="US">US</option>
                <option value="EU">EU</option>
                <option value="ASIA">ASIA</option>
              </select>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
              <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Type</label>
              <select
                value={addForm.assetType}
                onChange={(e) => setAddForm({ ...addForm, assetType: e.target.value })}
                style={{
                  background: 'var(--bg-tertiary)', border: '1px solid var(--border-primary)',
                  borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)',
                  padding: '0.4rem 0.6rem', fontSize: '0.85rem',
                }}
              >
                <option value="stock">Stock</option>
                <option value="etf">ETF</option>
              </select>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
              <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Sector</label>
              <input
                value={addForm.sector}
                onChange={(e) => setAddForm({ ...addForm, sector: e.target.value })}
                placeholder="Optional"
                style={{
                  background: 'var(--bg-tertiary)', border: '1px solid var(--border-primary)',
                  borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)',
                  padding: '0.4rem 0.6rem', fontSize: '0.85rem', width: '100px',
                }}
              />
            </div>
            <button type="submit" style={{
              background: '#00d4aa', color: '#0d1117', border: 'none',
              borderRadius: 'var(--radius-sm)', padding: '0.45rem 1rem',
              fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer',
            }}>
              Add Stock
            </button>
          </form>

          <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem' }}>
            <button
              onClick={handleDiscover}
              disabled={discover.isPending}
              style={{
                background: discover.isPending ? 'var(--bg-tertiary)' : '#00d4aa',
                color: discover.isPending ? 'var(--text-muted)' : '#0d1117',
                border: 'none', borderRadius: 'var(--radius-sm)',
                padding: '0.45rem 1rem', fontWeight: 600, fontSize: '0.85rem',
                cursor: discover.isPending ? 'wait' : 'pointer',
              }}
            >
              {discover.isPending ? '⏳ Discovering…' : '🔍 Run Discovery'}
            </button>
            <button
              onClick={handleAnalyze}
              disabled={analyze.isPending}
              style={{
                background: analyze.isPending ? 'var(--bg-tertiary)' : 'var(--accent)',
                color: analyze.isPending ? 'var(--text-muted)' : '#0d1117',
                border: 'none', borderRadius: 'var(--radius-sm)',
                padding: '0.45rem 1rem', fontWeight: 600, fontSize: '0.85rem',
                cursor: analyze.isPending ? 'wait' : 'pointer',
              }}
            >
              {analyze.isPending ? '⏳ Analyzing…' : '◈ Run Analysis Now'}
            </button>
          </div>
        </div>
      </div>

      {/* ─── Watchlist Table ─── */}
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div className="card-header">
          Watchlist ({stocks.length} stock{stocks.length !== 1 ? 's' : ''})
        </div>
        {watchlist.isLoading ? (
          <div className="loading-state">Loading watchlist…</div>
        ) : watchlist.error ? (
          <div className="error-state">
            Error: {(watchlist.error as Error).message}
            <div style={{ marginTop: '0.5rem' }}>
              <button onClick={() => watchlist.refetch()} style={{
                background: 'var(--accent)', color: '#0d1117', border: 'none',
                borderRadius: 'var(--radius-sm)', padding: '0.35rem 0.75rem',
                fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer',
              }}>
                Retry
              </button>
            </div>
          </div>
        ) : stocks.length === 0 ? (
          <div className="empty-state">
            <p>No stocks in watchlist yet — add one above or run discovery.</p>
          </div>
        ) : (
          <table className="data-table" style={{ marginTop: '0.5rem' }}>
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Name</th>
                <th className="center">Market</th>
                <th>Sector</th>
                <th className="right">Price</th>
                <th>Last Analyzed</th>
                <th className="right">Signals</th>
                <th className="center">Status</th>
                <th className="center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {stocks.map((stock: any) => (
                <tr key={stock.id}>
                  <td style={{ fontWeight: 600 }}>{stock.symbol}</td>
                  <td style={{ color: 'var(--text-secondary)', maxWidth: '150px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {stock.name || '—'}
                  </td>
                  <td className="center">
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
                      padding: '0.1rem 0.45rem', borderRadius: '4px', fontSize: '0.8rem',
                      background: `${MARKET_COLOR[stock.market] || 'var(--text-muted)'}15`,
                      color: MARKET_COLOR[stock.market] || 'var(--text-muted)',
                      fontWeight: 600,
                    }}>
                      {MARKET_FLAG[stock.market] || '🌐'} {stock.market}
                    </span>
                  </td>
                  <td style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                    {stock.sector || '—'}
                  </td>
                  <td className="right mono">{fmtPrice(stock.current_price ?? stock.currentPrice)}</td>
                  <td style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                    {timeAgo(stock.last_analyzed ?? stock.lastAnalyzed)}
                  </td>
                  <td className="right">{stock.signal_count ?? stock.signalCount ?? '—'}</td>
                  <td className="center">
                    <span className={`badge ${(stock.status ?? 'active') === 'active' ? 'badge-buy' : 'badge-hold'}`}>
                      {stock.status ?? 'active'}
                    </span>
                  </td>
                  <td className="center">
                    <div style={{ display: 'flex', gap: '0.35rem', justifyContent: 'center' }}>
                      <Link
                        to={`/analysis?stockId=${stock.id}`}
                        style={{
                          fontSize: '0.75rem', padding: '0.2rem 0.5rem',
                          borderRadius: '4px', background: 'var(--accent-bg)',
                          color: 'var(--accent)', textDecoration: 'none', fontWeight: 500,
                        }}
                      >
                        Analysis
                      </Link>
                      <button
                        onClick={() => handleRemove(stock.id, stock.symbol)}
                        disabled={remove.isPending}
                        style={{
                          fontSize: '0.75rem', padding: '0.2rem 0.5rem',
                          borderRadius: '4px', background: 'var(--loss-bg)',
                          color: 'var(--loss)', border: 'none', cursor: 'pointer', fontWeight: 500,
                        }}
                      >
                        Remove
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ─── Discovery Log ─── */}
      <div className="card">
        <div className="card-header">Recently Discovered</div>
        {recentlyDiscovered.length === 0 ? (
          <div className="empty-state" style={{ padding: '1.5rem 0' }}>
            <p>No recent discoveries — run the discovery pipeline to find new stocks.</p>
          </div>
        ) : (
          <table className="data-table" style={{ marginTop: '0.5rem' }}>
            <thead>
              <tr>
                <th>Symbol</th>
                <th className="center">Market</th>
                <th>Sector</th>
                <th>Discovered</th>
                <th>Method</th>
              </tr>
            </thead>
            <tbody>
              {recentlyDiscovered.map((stock: any) => (
                <tr key={stock.id}>
                  <td style={{ fontWeight: 600 }}>{stock.symbol}</td>
                  <td className="center">
                    <span style={{ color: MARKET_COLOR[stock.market] || 'var(--text-muted)' }}>
                      {MARKET_FLAG[stock.market] || '🌐'} {stock.market}
                    </span>
                  </td>
                  <td style={{ color: 'var(--text-secondary)' }}>{stock.sector || '—'}</td>
                  <td style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                    {timeAgo(stock.created_at)}
                  </td>
                  <td style={{ fontSize: '0.8rem' }}>
                    <span style={{
                      padding: '0.1rem 0.4rem', borderRadius: '4px',
                      background: 'var(--bg-tertiary)', color: 'var(--text-secondary)',
                    }}>
                      {stock.discovery_method ?? stock.discoveryMethod ?? 'manual'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
