import { useState, useMemo, useEffect } from 'react';
import { usePortfolio, usePortfolioHistory, useDashboard, useAdjustCash, useSellPosition, useRefreshPrices } from '../hooks/useApi';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
  PieChart, Pie, Cell, Legend,
} from 'recharts';
import StockDetailModal from '../components/StockDetailModal';

function fmt(n: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}
function fmtCompact(n: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
}
function fmtPct(n: number): string {
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}

function getStopLossStatus(pnlPct: number, stopLossPct: number): { color: string; label: string; flashing: boolean } {
  if (pnlPct > 0) return { color: 'var(--profit)', label: 'Safe', flashing: false };
  if (pnlPct > stopLossPct / 2) return { color: '#d29922', label: 'Watch', flashing: false };
  if (pnlPct > stopLossPct) return { color: 'var(--loss)', label: 'Danger', flashing: false };
  return { color: 'var(--loss)', label: 'TRIGGERED', flashing: true };
}

const PIE_COLORS = ['#58a6ff', '#00c853', '#d29922', '#f97583', '#bc8cff', '#79c0ff', '#56d364', '#ff7b72', '#e3b341', '#a5d6ff'];

export default function Portfolio() {
  const positions = usePortfolio();
  const history = usePortfolioHistory(90);
  const dashboard = useDashboard();
  const [selectedStock, setSelectedStock] = useState<string | null>(null);
  const [showCashAdjust, setShowCashAdjust] = useState(false);
  const [cashAmount, setCashAmount] = useState('');
  const [cashReason, setCashReason] = useState('');
  const adjustCash = useAdjustCash();

  // Sell modal state
  const [sellTarget, setSellTarget] = useState<any | null>(null);
  const [sellQty, setSellQty] = useState('');
  const [sellPrice, setSellPrice] = useState('');
  const [sellError, setSellError] = useState('');
  const sellPosition = useSellPosition();

  // Price refresh on mount
  const refreshPrices = useRefreshPrices();
  useEffect(() => {
    refreshPrices.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const posData: any[] = positions.data?.data ?? [];
  const histData: any[] = history.data?.data ?? [];
  const portfolio = dashboard.data?.data?.portfolio;

  // Build pie chart data from positions
  const pieData = useMemo(() => {
    return posData.map((p: any) => ({
      name: p.symbol,
      value: Math.abs(p.market_value),
    }));
  }, [posData]);

  // Compute total market value for weight %
  const totalMarketValue = useMemo(() => {
    return posData.reduce((sum: number, p: any) => sum + Math.abs(p.market_value), 0);
  }, [posData]);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.35rem', fontWeight: 700, margin: 0 }}>Portfolio</h1>
        {refreshPrices.isPending && (
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
            Refreshing prices…
          </span>
        )}
      </div>

      {/* ─── Cash balance card ─── */}
      {portfolio && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
          <div className="card">
            <div className="card-header">Total Value</div>
            <div className="card-value">{fmtCompact(portfolio.total_value)}</div>
          </div>
          <div className="card">
            <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              Cash Balance
              <button
                onClick={() => setShowCashAdjust(!showCashAdjust)}
                style={{
                  background: 'var(--bg-tertiary)', border: '1px solid var(--border-primary)',
                  color: 'var(--accent)', borderRadius: 4, padding: '2px 8px', fontSize: '0.7rem',
                  cursor: 'pointer', fontWeight: 600,
                }}
              >
                {showCashAdjust ? '✕' : '± Adjust'}
              </button>
            </div>
            <div className="card-value">{fmtCompact(portfolio.cash_balance)}</div>
            <div className="card-subtitle">
              {portfolio.total_value > 0 ? ((portfolio.cash_balance / portfolio.total_value) * 100).toFixed(1) : '0'}% of portfolio
            </div>
            {showCashAdjust && (
              <div style={{ marginTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                <input
                  type="number"
                  step="any"
                  placeholder="Amount (+ deposit, − withdraw)"
                  value={cashAmount}
                  onChange={(e) => setCashAmount(e.target.value)}
                  style={{
                    background: 'var(--bg-tertiary)', border: '1px solid var(--border-primary)',
                    color: 'var(--text-primary)', borderRadius: 4, padding: '0.35rem 0.5rem',
                    fontSize: '0.8rem', width: '100%',
                  }}
                />
                <input
                  type="text"
                  placeholder="Reason (optional)"
                  value={cashReason}
                  onChange={(e) => setCashReason(e.target.value)}
                  style={{
                    background: 'var(--bg-tertiary)', border: '1px solid var(--border-primary)',
                    color: 'var(--text-primary)', borderRadius: 4, padding: '0.35rem 0.5rem',
                    fontSize: '0.8rem', width: '100%',
                  }}
                />
                <div style={{ display: 'flex', gap: '0.4rem' }}>
                  <button
                    disabled={!cashAmount || adjustCash.isPending}
                    onClick={() => {
                      const amt = parseFloat(cashAmount);
                      if (!isFinite(amt) || amt === 0) return;
                      adjustCash.mutate({ amount: amt, reason: cashReason || undefined }, {
                        onSuccess: () => { setCashAmount(''); setCashReason(''); setShowCashAdjust(false); },
                      });
                    }}
                    style={{
                      flex: 1, background: 'var(--accent)', border: 'none', color: '#000',
                      borderRadius: 4, padding: '0.35rem', fontSize: '0.75rem', fontWeight: 700,
                      cursor: !cashAmount || adjustCash.isPending ? 'not-allowed' : 'pointer',
                      opacity: !cashAmount || adjustCash.isPending ? 0.5 : 1,
                    }}
                  >
                    {adjustCash.isPending ? 'Saving…' : 'Apply'}
                  </button>
                </div>
                {adjustCash.isError && (
                  <div style={{ color: 'var(--loss)', fontSize: '0.75rem' }}>
                    {(adjustCash.error as Error).message}
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="card">
            <div className="card-header">Invested</div>
            <div className="card-value">{fmtCompact(portfolio.invested_value)}</div>
          </div>
          <div className="card">
            <div className="card-header">Total P&L</div>
            <div className="card-value" style={{ color: portfolio.total_pnl >= 0 ? 'var(--profit)' : 'var(--loss)' }}>
              {fmt(portfolio.total_pnl)} <span style={{ fontSize: '0.9rem' }}>({fmtPct(portfolio.total_pnl_pct)})</span>
            </div>
          </div>
        </div>
      )}

      {/* ─── Two-column: Chart + Allocation ─── */}
      <div style={{ display: 'grid', gridTemplateColumns: posData.length > 0 ? '2fr 1fr' : '1fr', gap: '1rem', marginBottom: '1.5rem' }}>
        {/* Portfolio value over time */}
        <div className="card">
          <div className="card-header">Portfolio Value — 90 Days</div>
          {histData.length > 1 ? (
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={histData}>
                <defs>
                  <linearGradient id="pfGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#58a6ff" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#58a6ff" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#21262d" />
                <XAxis
                  dataKey="snapshot_at"
                  tickFormatter={(v: string) => new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  stroke="#6e7681" fontSize={11} tickLine={false}
                />
                <YAxis
                  stroke="#6e7681" fontSize={11} tickLine={false} width={60}
                  tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`}
                />
                <Tooltip
                  contentStyle={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 6, fontSize: '0.85rem' }}
                  formatter={(value: number) => [fmt(value), 'Value']}
                  labelFormatter={(label: string) => new Date(label).toLocaleDateString()}
                />
                <Area type="monotone" dataKey="total_value" stroke="#58a6ff" fill="url(#pfGradient)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="empty-state"><p>Snapshots appear after the first daily run.</p></div>
          )}
        </div>

        {/* Asset allocation pie chart */}
        {posData.length > 0 && (
          <div className="card">
            <div className="card-header">Asset Allocation</div>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={pieData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={90}
                  innerRadius={50}
                  paddingAngle={2}
                  stroke="none"
                  label={({ name, percent }: any) => `${name} ${(percent * 100).toFixed(0)}%`}
                  labelLine={false}
                  fontSize={11}
                >
                  {pieData.map((_: any, i: number) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Legend
                  verticalAlign="bottom"
                  wrapperStyle={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}
                />
                <Tooltip
                  contentStyle={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 6, fontSize: '0.85rem' }}
                  formatter={(value: number) => fmt(value)}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* ─── Positions Table ─── */}
      <div className="card">
        <div className="card-header">Open Positions</div>
        {positions.isLoading && <div className="loading-state">Loading positions…</div>}
        {!positions.isLoading && posData.length === 0 && (
          <div className="empty-state"><p>No open positions. The agent will invest when it finds high-conviction signals.</p></div>
        )}
        {posData.length > 0 && (
          <table className="data-table" style={{ marginTop: '0.5rem' }}>
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Name</th>
                <th className="right">Shares</th>
                <th className="right">Avg Cost</th>
                <th className="right">Current</th>
                <th className="right">P&L ($)</th>
                <th className="right">P&L (%)</th>
                <th className="right">Weight</th>
                <th>Strategy</th>
                <th>Stop-Loss</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {posData.map((p: any) => {
                const weight = totalMarketValue > 0 ? ((p.market_value / totalMarketValue) * 100).toFixed(1) : '0.0';
                const strat = p.strategy;
                const slStatus = strat ? getStopLossStatus(p.unrealised_pnl_pct, strat.stop_loss_pct) : null;
                return (
                  <tr key={p.id}>
                    <td
                      style={{ fontWeight: 600, cursor: 'pointer', color: 'var(--accent)' }}
                      onClick={() => setSelectedStock(p.symbol)}
                      onMouseEnter={(e) => (e.currentTarget.style.textDecoration = 'underline')}
                      onMouseLeave={(e) => (e.currentTarget.style.textDecoration = 'none')}
                    >
                      {p.symbol}
                    </td>
                    <td style={{ color: 'var(--text-secondary)' }}>{p.name}</td>
                    <td className="right">{p.quantity}</td>
                    <td className="right mono">{fmt(p.average_cost)}</td>
                    <td className="right mono">{fmt(p.current_price)}</td>
                    <td className="right mono" style={{
                      color: p.unrealised_pnl >= 0 ? 'var(--profit)' : 'var(--loss)',
                      fontWeight: 600,
                    }}>
                      {fmt(p.unrealised_pnl)}
                    </td>
                    <td className="right" style={{
                      color: p.unrealised_pnl_pct >= 0 ? 'var(--profit)' : 'var(--loss)',
                      fontWeight: 600,
                    }}>
                      {fmtPct(p.unrealised_pnl_pct)}
                    </td>
                    <td className="right" style={{ color: 'var(--text-secondary)' }}>{weight}%</td>
                    {/* Strategy column */}
                    <td style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
                      {strat ? (
                        <div>
                          <span>🛡️ {Math.abs(strat.stop_loss_pct)}% SL{strat.asset_type === 'etf' && strat.min_holding_days > 0 ? ` / ${strat.min_holding_days}d hold` : ''}</span>
                          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 2 }}>
                            SL @ {fmt(strat.stop_loss_price)}
                          </div>
                        </div>
                      ) : null}
                    </td>
                    {/* Stop-Loss status column */}
                    <td style={{ fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
                      {slStatus ? (
                        <span style={{
                          color: slStatus.color,
                          fontWeight: 600,
                          animation: slStatus.flashing ? 'blink 1s step-end infinite' : 'none',
                        }}>
                          <span style={{
                            display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
                            backgroundColor: slStatus.color, marginRight: 6, verticalAlign: 'middle',
                            animation: slStatus.flashing ? 'blink 1s step-end infinite' : 'none',
                          }} />
                          {slStatus.label}
                        </span>
                      ) : null}
                    </td>
                    {/* Sell button */}
                    <td>
                      <button
                        onClick={() => {
                          setSellTarget(p);
                          setSellQty(String(p.quantity));
                          setSellPrice(String(p.current_price));
                          setSellError('');
                          sellPosition.reset();
                        }}
                        style={{
                          background: 'transparent', border: '1px solid var(--loss)',
                          color: 'var(--loss)', borderRadius: 4, padding: '3px 10px',
                          fontSize: '0.7rem', fontWeight: 600, cursor: 'pointer',
                          whiteSpace: 'nowrap',
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--loss)'; e.currentTarget.style.color = '#000'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--loss)'; }}
                      >
                        Sell
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ─── Sell Modal ─── */}
      {sellTarget && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1000,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          onClick={() => { if (!sellPosition.isPending) setSellTarget(null); }}
        >
          <div
            style={{
              background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)',
              borderRadius: 12, padding: '1.5rem', width: 420, maxWidth: '90vw',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '1rem', color: 'var(--text-primary)' }}>
              Sell {sellTarget.symbol} — {sellTarget.name}
            </h2>

            {/* Position info */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem 1rem', marginBottom: '1rem', fontSize: '0.85rem' }}>
              <div><span style={{ color: 'var(--text-muted)' }}>Shares held:</span> <strong>{sellTarget.quantity}</strong></div>
              <div><span style={{ color: 'var(--text-muted)' }}>Avg cost:</span> <strong>{fmt(sellTarget.average_cost)}</strong></div>
              <div><span style={{ color: 'var(--text-muted)' }}>Current price:</span> <strong>{fmt(sellTarget.current_price)}</strong></div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>P&L:</span>{' '}
                <strong style={{ color: sellTarget.unrealised_pnl >= 0 ? 'var(--profit)' : 'var(--loss)' }}>
                  {fmt(sellTarget.unrealised_pnl)} ({fmtPct(sellTarget.unrealised_pnl_pct)})
                </strong>
              </div>
            </div>

            {/* Qty input */}
            <div style={{ marginBottom: '0.75rem' }}>
              <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>
                Shares to sell (max {sellTarget.quantity})
              </label>
              <input
                type="number"
                min={1}
                max={sellTarget.quantity}
                value={sellQty}
                onChange={(e) => { setSellQty(e.target.value); setSellError(''); }}
                style={{
                  background: 'var(--bg-tertiary)', border: '1px solid var(--border-primary)',
                  color: 'var(--text-primary)', borderRadius: 4, padding: '0.4rem 0.5rem',
                  fontSize: '0.85rem', width: '100%',
                }}
              />
              {sellQty && (Number(sellQty) < 1 || Number(sellQty) > sellTarget.quantity) && (
                <div style={{ color: 'var(--loss)', fontSize: '0.75rem', marginTop: 2 }}>
                  Must be between 1 and {sellTarget.quantity}
                </div>
              )}
            </div>

            {/* Price input */}
            <div style={{ marginBottom: '0.75rem' }}>
              <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>
                Price per share <span style={{ color: 'var(--text-muted)' }}>(market: {fmt(sellTarget.current_price)})</span>
              </label>
              <input
                type="number"
                min={0.01}
                step="0.01"
                value={sellPrice}
                onChange={(e) => { setSellPrice(e.target.value); setSellError(''); }}
                style={{
                  background: 'var(--bg-tertiary)', border: '1px solid var(--border-primary)',
                  color: 'var(--text-primary)', borderRadius: 4, padding: '0.4rem 0.5rem',
                  fontSize: '0.85rem', width: '100%',
                }}
              />
              {sellPrice && Number(sellPrice) < 0.01 && (
                <div style={{ color: 'var(--loss)', fontSize: '0.75rem', marginTop: 2 }}>
                  Minimum price is $0.01
                </div>
              )}
            </div>

            {/* Summary */}
            {sellQty && sellPrice && Number(sellQty) >= 1 && Number(sellPrice) >= 0.01 && (
              <div style={{
                background: 'var(--bg-tertiary)', borderRadius: 6, padding: '0.6rem 0.75rem',
                fontSize: '0.85rem', marginBottom: '1rem', color: 'var(--text-secondary)',
              }}>
                Selling <strong style={{ color: 'var(--text-primary)' }}>{sellQty}</strong> shares @{' '}
                <strong style={{ color: 'var(--text-primary)' }}>{fmt(Number(sellPrice))}</strong> ={' '}
                <strong style={{ color: 'var(--text-primary)' }}>{fmt(Number(sellQty) * Number(sellPrice))}</strong>
              </div>
            )}

            {/* Error */}
            {(sellError || sellPosition.isError) && (
              <div style={{ color: 'var(--loss)', fontSize: '0.8rem', marginBottom: '0.75rem' }}>
                {sellError || (sellPosition.error as Error)?.message || 'Sell failed'}
              </div>
            )}

            {/* Buttons */}
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                disabled={sellPosition.isPending}
                onClick={() => setSellTarget(null)}
                style={{
                  flex: 1, background: 'var(--bg-tertiary)', border: '1px solid var(--border-primary)',
                  color: 'var(--text-secondary)', borderRadius: 6, padding: '0.5rem',
                  fontSize: '0.85rem', cursor: sellPosition.isPending ? 'not-allowed' : 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                disabled={
                  sellPosition.isPending ||
                  !sellQty || Number(sellQty) < 1 || Number(sellQty) > sellTarget.quantity ||
                  !sellPrice || Number(sellPrice) < 0.01
                }
                onClick={() => {
                  const qty = Number(sellQty);
                  const price = Number(sellPrice);
                  if (qty < 1 || qty > sellTarget.quantity) { setSellError(`Quantity must be between 1 and ${sellTarget.quantity}`); return; }
                  if (price < 0.01) { setSellError('Price must be at least $0.01'); return; }
                  sellPosition.mutate({ symbol: sellTarget.symbol, quantity: qty, price }, {
                    onSuccess: () => setSellTarget(null),
                  });
                }}
                style={{
                  flex: 1, background: 'var(--accent)', border: 'none', color: '#000',
                  borderRadius: 6, padding: '0.5rem', fontSize: '0.85rem', fontWeight: 700,
                  cursor: (sellPosition.isPending || !sellQty || !sellPrice) ? 'not-allowed' : 'pointer',
                  opacity: (sellPosition.isPending || !sellQty || !sellPrice) ? 0.5 : 1,
                }}
              >
                {sellPosition.isPending ? 'Selling…' : 'Confirm Sell'}
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedStock && (
        <StockDetailModal
          symbolOrId={selectedStock}
          onClose={() => setSelectedStock(null)}
        />
      )}

      {/* Blink animation for triggered stop-loss */}
      <style>{`
        @keyframes blink {
          50% { opacity: 0; }
        }
      `}</style>
    </div>
  );
}