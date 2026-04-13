import { useMemo } from 'react';
import { usePerformance, useAnalysis, useLearning } from '../hooks/useApi';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  LineChart, Line, Legend,
} from 'recharts';

function fmt(n: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}
function fmtPct(n: number): string {
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}

const recColors: Record<string, string> = {
  strong_buy: '#00c853', buy: '#56d364', hold: '#d29922', sell: '#ff6e40', strong_sell: '#ff1744',
};

const SIGNAL_SOURCES = ['pe_ratio', 'price_trend', 'macro_trend', 'google_trends', 'social_sentiment', 'news_sentiment'];
const SIGNAL_LABELS: Record<string, string> = {
  pe_ratio: 'P/E Ratio', price_trend: 'Price Trend', macro_trend: 'Macro',
  google_trends: 'Google Trends', social_sentiment: 'Social', news_sentiment: 'News',
};

export default function Analysis() {
  const perf = usePerformance();
  const analysis = useAnalysis();
  const learning = useLearning();

  const metrics = perf.data?.data;
  const analyses: any[] = analysis.data?.data ?? [];
  const learnings: any[] = learning.data?.data ?? [];

  // Build signal accuracy data from learning outcomes
  const signalAccuracyData = useMemo(() => {
    // Estimate from analyses: group by signal source, track accuracy
    const counts: Record<string, { correct: number; total: number }> = {};
    SIGNAL_SOURCES.forEach(s => { counts[s] = { correct: 0, total: 0 }; });

    learnings.forEach((l: any) => {
      let lessons: any = null;
      try { lessons = typeof l.lessons_learned === 'string' ? JSON.parse(l.lessons_learned) : l.lessons_learned; } catch { /* skip */ }
      if (lessons?.signalAccuracy) {
        Object.entries(lessons.signalAccuracy).forEach(([key, val]: [string, any]) => {
          if (counts[key]) {
            counts[key].total += 1;
            if (val?.correct || val?.accurate) counts[key].correct += 1;
          }
        });
      } else {
        // Fallback: count correct/incorrect overall for each source
        SIGNAL_SOURCES.forEach(s => {
          counts[s].total += 1;
          if (l.was_correct) counts[s].correct += 1;
        });
      }
    });

    return SIGNAL_SOURCES.map(s => ({
      name: SIGNAL_LABELS[s],
      accuracy: counts[s].total > 0 ? Math.round((counts[s].correct / counts[s].total) * 100) : 0,
      total: counts[s].total,
    }));
  }, [learnings]);

  // Decision quality over time — aggregate by week
  const qualityOverTime = useMemo(() => {
    if (learnings.length === 0) return [];
    const sorted = [...learnings].sort((a, b) => new Date(a.evaluated_at).getTime() - new Date(b.evaluated_at).getTime());
    const weeks: Record<string, { correct: number; total: number }> = {};
    sorted.forEach((l: any) => {
      const d = new Date(l.evaluated_at);
      const weekStart = new Date(d);
      weekStart.setDate(d.getDate() - d.getDay());
      const key = weekStart.toISOString().slice(0, 10);
      if (!weeks[key]) weeks[key] = { correct: 0, total: 0 };
      weeks[key].total += 1;
      if (l.was_correct) weeks[key].correct += 1;
    });
    return Object.entries(weeks).map(([week, { correct, total }]) => ({
      week,
      winRate: Math.round((correct / total) * 100),
      trades: total,
    }));
  }, [learnings]);

  // Learning insights summary
  const insightsSummary = useMemo(() => {
    if (learnings.length === 0) return null;
    const correct = learnings.filter((l: any) => l.was_correct).length;
    const avgHold = learnings.reduce((s: number, l: any) => s + (l.holding_days || 0), 0) / learnings.length;
    const avgExpected = learnings.reduce((s: number, l: any) => s + (l.expected_return || 0), 0) / learnings.length;
    const avgActual = learnings.reduce((s: number, l: any) => s + (l.actual_return || 0), 0) / learnings.length;
    return { correct, total: learnings.length, avgHold, avgExpected, avgActual };
  }, [learnings]);

  return (
    <div>
      <h1 style={{ fontSize: '1.35rem', fontWeight: 700, marginBottom: '1.5rem' }}>Analysis & Learning</h1>

      {/* ─── Performance Metric Cards ─── */}
      {metrics && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
          <div className="card">
            <div className="card-header">Total Return</div>
            <div className="card-value" style={{ color: metrics.totalReturn >= 0 ? 'var(--profit)' : 'var(--loss)' }}>
              {fmt(metrics.totalReturn)}
            </div>
            <div className="card-subtitle" style={{ color: metrics.totalReturnPct >= 0 ? 'var(--profit)' : 'var(--loss)' }}>
              {fmtPct(metrics.totalReturnPct)}
            </div>
          </div>
          <div className="card">
            <div className="card-header">Win Rate</div>
            <div className="card-value">{metrics.winRate.toFixed(1)}%</div>
            <div className="card-subtitle">{metrics.closedPositions} closed trades</div>
          </div>
          <div className="card">
            <div className="card-header">Avg Win</div>
            <div className="card-value profit">{fmt(metrics.avgWin)}</div>
          </div>
          <div className="card">
            <div className="card-header">Avg Loss</div>
            <div className="card-value loss">{fmt(metrics.avgLoss)}</div>
          </div>
          <div className="card">
            <div className="card-header">Profit Factor</div>
            <div className="card-value">{metrics.profitFactor === Infinity ? '∞' : metrics.profitFactor.toFixed(2)}</div>
          </div>
          <div className="card">
            <div className="card-header">Sharpe Est.</div>
            <div className="card-value">{metrics.sharpeEstimate.toFixed(2)}</div>
          </div>
        </div>
      )}

      {/* ─── Two-column: Signal Accuracy + Decision Quality ─── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
        {/* Signal Accuracy Bar Chart */}
        <div className="card">
          <div className="card-header">Signal Source Accuracy</div>
          {signalAccuracyData.some(d => d.total > 0) ? (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={signalAccuracyData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#21262d" horizontal={false} />
                <XAxis type="number" stroke="#6e7681" fontSize={11} domain={[0, 100]} tickFormatter={(v: number) => `${v}%`} />
                <YAxis type="category" dataKey="name" stroke="#6e7681" fontSize={11} width={100} />
                <Tooltip
                  contentStyle={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 6, fontSize: '0.85rem' }}
                  formatter={(value: number) => [`${value}%`, 'Accuracy']}
                />
                <Bar dataKey="accuracy" fill="#58a6ff" radius={[0, 4, 4, 0]} barSize={18} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="empty-state"><p>Signal accuracy data will appear after the learning engine evaluates trades.</p></div>
          )}
        </div>

        {/* Decision Quality Line Chart */}
        <div className="card">
          <div className="card-header">Decision Quality Over Time</div>
          {qualityOverTime.length > 1 ? (
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={qualityOverTime}>
                <CartesianGrid strokeDasharray="3 3" stroke="#21262d" />
                <XAxis
                  dataKey="week"
                  stroke="#6e7681" fontSize={11}
                  tickFormatter={(v: string) => new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                />
                <YAxis stroke="#6e7681" fontSize={11} domain={[0, 100]} tickFormatter={(v: number) => `${v}%`} width={45} />
                <Tooltip
                  contentStyle={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 6, fontSize: '0.85rem' }}
                  formatter={(value: number, name: string) => [`${value}%`, name === 'winRate' ? 'Win Rate' : name]}
                  labelFormatter={(label: string) => `Week of ${new Date(label).toLocaleDateString()}`}
                />
                <Legend wrapperStyle={{ fontSize: '0.8rem' }} />
                <Line type="monotone" dataKey="winRate" name="Win Rate" stroke="#00c853" strokeWidth={2} dot={{ fill: '#00c853', r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="empty-state"><p>Trend data requires multiple weeks of evaluated trades.</p></div>
          )}
        </div>
      </div>

      {/* ─── Learning Insights Panel ─── */}
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div className="card-header">Learning Insights</div>
        {insightsSummary ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1.5rem', marginTop: '0.75rem' }}>
            <div>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>Evaluated Trades</div>
              <div style={{ fontSize: '1.1rem', fontWeight: 600 }}>
                {insightsSummary.correct}/{insightsSummary.total} correct ({((insightsSummary.correct / insightsSummary.total) * 100).toFixed(0)}%)
              </div>
            </div>
            <div>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>Avg Holding Period</div>
              <div style={{ fontSize: '1.1rem', fontWeight: 600 }}>{insightsSummary.avgHold.toFixed(1)} days</div>
            </div>
            <div>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>Avg Expected Return</div>
              <div style={{ fontSize: '1.1rem', fontWeight: 600 }}>{fmtPct(insightsSummary.avgExpected * 100)}</div>
            </div>
            <div>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>Avg Actual Return</div>
              <div style={{ fontSize: '1.1rem', fontWeight: 600, color: insightsSummary.avgActual >= 0 ? 'var(--profit)' : 'var(--loss)' }}>
                {fmtPct(insightsSummary.avgActual * 100)}
              </div>
            </div>
          </div>
        ) : (
          <div className="empty-state" style={{ padding: '1.5rem 0' }}>
            <p>Learning insights will appear after the weekly evaluation cycle runs.</p>
            <p style={{ fontSize: '0.8rem', marginTop: '0.5rem' }}>The agent evaluates closed positions every Sunday, comparing expected vs actual returns and tracking signal accuracy.</p>
          </div>
        )}
      </div>

      {/* ─── Recent Analysis Table ─── */}
      <div className="card">
        <div className="card-header">Latest Analysis Results</div>
        {analyses.length === 0 ? (
          <div className="empty-state"><p>No analysis results yet. Add stocks and the pipeline runs every 4 hours.</p></div>
        ) : (
          <table className="data-table" style={{ marginTop: '0.5rem' }}>
            <thead>
              <tr>
                <th>Symbol</th>
                <th className="right">Score</th>
                <th className="right">Confidence</th>
                <th className="center">Signal</th>
                <th>Rationale</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {analyses.map((a: any) => (
                <tr key={a.id}>
                  <td style={{ fontWeight: 600 }}>{a.symbol}</td>
                  <td className="right mono" style={{ color: a.composite_score >= 0 ? 'var(--profit)' : 'var(--loss)' }}>
                    {a.composite_score >= 0 ? '+' : ''}{a.composite_score.toFixed(3)}
                  </td>
                  <td className="right">{(a.confidence_level * 100).toFixed(0)}%</td>
                  <td className="center">
                    <span style={{
                      color: recColors[a.recommendation] || 'var(--text-primary)',
                      fontWeight: 600, fontSize: '0.8rem', textTransform: 'uppercase',
                    }}>
                      {a.recommendation.replace('_', ' ')}
                    </span>
                  </td>
                  <td style={{ color: 'var(--text-secondary)', maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {a.rationale}
                  </td>
                  <td style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{new Date(a.analysed_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
