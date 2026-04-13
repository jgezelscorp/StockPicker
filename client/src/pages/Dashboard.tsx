import { useDashboard, usePortfolioHistory, useAnalysis } from '../hooks/useApi';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
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
function timeAgo(iso: string | null): string {
  if (!iso) return 'Never';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const recColors: Record<string, string> = {
  strong_buy: '#00c853', buy: '#56d364', hold: '#d29922', sell: '#ff6e40', strong_sell: '#ff1744',
};

export default function Dashboard() {
  const { data, isLoading, error } = useDashboard();
  const history = usePortfolioHistory(30);
  const signals = useAnalysis();

  if (isLoading) return <div className="loading-state">Loading dashboard…</div>;
  if (error) return <div className="error-state">Error: {(error as Error).message}</div>;

  const d = data?.data;
  if (!d) return <div className="empty-state">No data available yet.</div>;

  const portfolio = d.portfolio;
  const historyData = history.data?.data ?? [];
  const topSignals = (signals.data?.data ?? []).slice(0, 5);

  return (
    <div>
      <h1 style={{ fontSize: '1.35rem', fontWeight: 700, marginBottom: '1.5rem' }}>Dashboard</h1>

      {/* ─── Portfolio KPI Cards ─── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
        <div className="card">
          <div className="card-header">Total Value</div>
          <div className="card-value">{fmtCompact(portfolio.total_value)}</div>
        </div>
        <div className="card">
          <div className="card-header">Daily P&L</div>
          <div className="card-value" style={{ color: portfolio.total_pnl >= 0 ? 'var(--profit)' : 'var(--loss)' }}>
            {fmt(portfolio.total_pnl)}
          </div>
          <div className="card-subtitle" style={{ color: portfolio.total_pnl_pct >= 0 ? 'var(--profit)' : 'var(--loss)' }}>
            {fmtPct(portfolio.total_pnl_pct)}
          </div>
        </div>
        <div className="card">
          <div className="card-header">Cash Balance</div>
          <div className="card-value">{fmtCompact(portfolio.cash_balance)}</div>
        </div>
        <div className="card">
          <div className="card-header">Invested</div>
          <div className="card-value">{fmtCompact(portfolio.invested_value)}</div>
          <div className="card-subtitle">{portfolio.position_count} position{portfolio.position_count !== 1 ? 's' : ''}</div>
        </div>
      </div>

      {/* ─── Two-column: Chart + Agent Status ─── */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
        {/* Mini Performance Chart */}
        <div className="card">
          <div className="card-header">Portfolio — Last 30 Days</div>
          {historyData.length > 1 ? (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={historyData}>
                <defs>
                  <linearGradient id="valueGradient" x1="0" y1="0" x2="0" y2="1">
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
                  stroke="#6e7681" fontSize={11} tickLine={false}
                  tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`}
                  width={55}
                />
                <Tooltip
                  contentStyle={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 6, fontSize: '0.85rem' }}
                  formatter={(value: number) => [fmt(value), 'Value']}
                  labelFormatter={(label: string) => new Date(label).toLocaleDateString()}
                />
                <Area type="monotone" dataKey="total_value" stroke="#58a6ff" fill="url(#valueGradient)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="empty-state" style={{ padding: '2rem' }}>
              <p>Chart data will appear after daily snapshots begin.</p>
            </div>
          )}
        </div>

        {/* Agent Status */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div>
            <div className="card-header">Agent Status</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem', marginTop: '0.5rem' }}>
              <span className="status-dot status-active" />
              <span style={{ fontWeight: 600 }}>Online</span>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '0.85rem' }}>
            <div>
              <span style={{ color: 'var(--text-muted)' }}>Last Analysis</span>
              <div style={{ fontWeight: 500 }}>{timeAgo(d.lastRunAt)}</div>
            </div>
            <div>
              <span style={{ color: 'var(--text-muted)' }}>Next Scheduled</span>
              <div style={{ fontWeight: 500 }}>{d.nextRunAt ? new Date(d.nextRunAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Pending'}</div>
            </div>
            <div>
              <span style={{ color: 'var(--text-muted)' }}>Tracked Stocks</span>
              <div style={{ fontWeight: 500 }}>{d.pendingAnalyses}</div>
            </div>
          </div>
        </div>
      </div>

      {/* ─── Two-column: Recent Trades + Top Signals ─── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
        {/* Recent Trades */}
        <div className="card">
          <div className="card-header">Recent Trades</div>
          {d.recentTrades.length === 0 ? (
            <div className="empty-state" style={{ padding: '1.5rem 0' }}>
              <p>No trades yet — the agent trades when confidence exceeds 72%.</p>
            </div>
          ) : (
            <table className="data-table" style={{ marginTop: '0.5rem' }}>
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>Action</th>
                  <th className="right">Qty</th>
                  <th className="right">Price</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {d.recentTrades.slice(0, 5).map((t: any) => (
                  <tr key={t.id}>
                    <td style={{ fontWeight: 600 }}>{t.symbol}</td>
                    <td>
                      <span className={`badge ${t.action === 'buy' ? 'badge-buy' : 'badge-sell'}`}>
                        {t.action}
                      </span>
                    </td>
                    <td className="right">{t.quantity}</td>
                    <td className="right mono">{fmt(t.price_per_share)}</td>
                    <td style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                      {new Date(t.executed_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Top Signals */}
        <div className="card">
          <div className="card-header">Strongest Signals</div>
          {topSignals.length === 0 ? (
            <div className="empty-state" style={{ padding: '1.5rem 0' }}>
              <p>No analysis results yet — add stocks to begin.</p>
            </div>
          ) : (
            <table className="data-table" style={{ marginTop: '0.5rem' }}>
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th className="right">Score</th>
                  <th className="right">Conf.</th>
                  <th className="center">Signal</th>
                </tr>
              </thead>
              <tbody>
                {topSignals.map((s: any) => (
                  <tr key={s.id}>
                    <td style={{ fontWeight: 600 }}>{s.symbol}</td>
                    <td className="right mono" style={{ color: s.composite_score >= 0 ? 'var(--profit)' : 'var(--loss)' }}>
                      {s.composite_score >= 0 ? '+' : ''}{s.composite_score.toFixed(3)}
                    </td>
                    <td className="right">{(s.confidence_level * 100).toFixed(0)}%</td>
                    <td className="center">
                      <span style={{
                        color: recColors[s.recommendation] || 'var(--text-primary)',
                        fontWeight: 600,
                        fontSize: '0.8rem',
                        textTransform: 'uppercase',
                      }}>
                        {s.recommendation.replace('_', ' ')}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
