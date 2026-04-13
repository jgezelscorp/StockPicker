import { useMemo } from 'react';
import { usePortfolio, usePortfolioHistory, useDashboard } from '../hooks/useApi';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
  PieChart, Pie, Cell, Legend,
} from 'recharts';

function fmt(n: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}
function fmtCompact(n: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
}
function fmtPct(n: number): string {
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}

const PIE_COLORS = ['#58a6ff', '#00c853', '#d29922', '#f97583', '#bc8cff', '#79c0ff', '#56d364', '#ff7b72', '#e3b341', '#a5d6ff'];

export default function Portfolio() {
  const positions = usePortfolio();
  const history = usePortfolioHistory(90);
  const dashboard = useDashboard();

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
      <h1 style={{ fontSize: '1.35rem', fontWeight: 700, marginBottom: '1.5rem' }}>Portfolio</h1>

      {/* ─── Cash balance card ─── */}
      {portfolio && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
          <div className="card">
            <div className="card-header">Total Value</div>
            <div className="card-value">{fmtCompact(portfolio.total_value)}</div>
          </div>
          <div className="card">
            <div className="card-header">Cash Balance</div>
            <div className="card-value">{fmtCompact(portfolio.cash_balance)}</div>
            <div className="card-subtitle">
              {portfolio.total_value > 0 ? ((portfolio.cash_balance / portfolio.total_value) * 100).toFixed(1) : '0'}% of portfolio
            </div>
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
              </tr>
            </thead>
            <tbody>
              {posData.map((p: any) => {
                const weight = totalMarketValue > 0 ? ((p.market_value / totalMarketValue) * 100).toFixed(1) : '0.0';
                return (
                  <tr key={p.id}>
                    <td style={{ fontWeight: 600 }}>{p.symbol}</td>
                    <td style={{ color: 'var(--text-secondary)' }}>{p.stock_name}</td>
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
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
