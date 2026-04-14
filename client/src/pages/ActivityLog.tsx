import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useActivityLogs, useAnalysisRuns } from '../hooks/useApi';
import { useLogStream, LogEntry } from '../hooks/useLogStream';

const CATEGORIES = ['All', 'Pipeline', 'Signal', 'Trade', 'Portfolio', 'Discovery', 'Learning', 'System', 'LLM'] as const;
const LEVELS = ['All', 'Info', 'Warning', 'Error', 'Reasoning', 'Trade', 'Discovery'] as const;

const VERBOSITY_LABELS: Record<number, string> = {
  1: 'Critical',
  2: 'Important',
  3: 'Normal',
  4: 'Detailed',
  5: 'Debug',
};

const LEVEL_COLORS: Record<string, string> = {
  info: '#3b82f6',
  warn: '#f59e0b',
  warning: '#f59e0b',
  error: 'var(--loss)',
  reasoning: '#a855f7',
  trade: 'var(--profit)',
  discovery: '#06b6d4',
};

function getLevelColor(level: string): string {
  return LEVEL_COLORS[level.toLowerCase()] || 'var(--text-muted)';
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return '--:--:--';
  }
}

function formatFull(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'medium' });
  } catch {
    return iso;
  }
}

function tryFormatJson(raw: string | null): string {
  if (!raw) return '';
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return JSON.stringify(parsed, null, 2);
  } catch {
    return String(raw);
  }
}

export default function ActivityLog() {
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [levelFilter, setLevelFilter] = useState('All');
  const [verbosity, setVerbosity] = useState(3);
  const [streaming, setStreaming] = useState(true);
  const [autoScroll, setAutoScroll] = useState(true);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [runsExpanded, setRunsExpanded] = useState(true);

  const scrollRef = useRef<HTMLDivElement>(null);

  // Analysis runs
  const { data: runsData } = useAnalysisRuns();
  const analysisRuns = useMemo(() => {
    const raw = runsData?.runs || runsData || [];
    return (Array.isArray(raw) ? raw : []).slice(0, 10);
  }, [runsData]);

  // Initial fetch — last 200 logs
  const { data: initialData, isLoading, isError } = useActivityLogs({ limit: 200, max_verbosity: verbosity });

  // SSE stream
  const { logs: streamLogs, connected, clear: clearStream } = useLogStream(streaming, verbosity);

  // Merge initial + streamed, deduplicate by id, newest first
  const allLogs = useMemo(() => {
    const initial: LogEntry[] = initialData?.data || initialData?.logs || initialData || [];
    const initialArr = Array.isArray(initial) ? initial : [];
    const map = new Map<number, LogEntry>();
    for (const entry of initialArr) {
      if (entry.id != null) map.set(entry.id, entry);
    }
    for (const entry of streamLogs) {
      if (entry.id != null) map.set(entry.id, entry);
    }
    return Array.from(map.values()).sort((a, b) => {
      if (a.id && b.id) return b.id - a.id;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }, [initialData, streamLogs]);

  // Apply filters
  const filteredLogs = useMemo(() => {
    return allLogs.filter((entry) => {
      if (categoryFilter !== 'All' && entry.category?.toLowerCase() !== categoryFilter.toLowerCase()) return false;
      if (levelFilter !== 'All' && entry.level?.toLowerCase() !== levelFilter.toLowerCase()) return false;
      return true;
    });
  }, [allLogs, categoryFilter, levelFilter]);

  // Auto-scroll to top when new entries arrive (newest at top)
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [filteredLogs.length, autoScroll]);

  const toggleExpand = useCallback((id: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const handleClear = () => {
    clearStream();
    setExpandedIds(new Set());
  };

  // Styles
  const pageStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    height: 'calc(100vh - var(--header-height) - 3rem)',
    gap: '0.75rem',
  };

  const headerStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: '0.75rem',
  };

  const titleRowStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '0.6rem',
  };

  const liveDotStyle: React.CSSProperties = {
    width: 10,
    height: 10,
    borderRadius: '50%',
    background: connected ? 'var(--profit)' : 'var(--loss)',
    boxShadow: connected ? '0 0 8px var(--profit)' : 'none',
    animation: connected ? 'pulse 2s ease-in-out infinite' : 'none',
  };

  const filterBarStyle: React.CSSProperties = {
    display: 'flex',
    gap: '0.75rem',
    alignItems: 'center',
    flexWrap: 'wrap',
    padding: '0.6rem 1rem',
    background: 'var(--bg-tertiary)',
    border: '1px solid var(--border-secondary)',
    borderRadius: 'var(--radius-sm)',
  };

  const selectStyle: React.CSSProperties = {
    background: 'var(--bg-secondary)',
    border: '1px solid var(--border-primary)',
    borderRadius: 'var(--radius-sm)',
    color: 'var(--text-primary)',
    padding: '0.35rem 0.6rem',
    fontSize: '0.85rem',
    outline: 'none',
    cursor: 'pointer',
  };

  const btnStyle: React.CSSProperties = {
    background: 'var(--bg-secondary)',
    border: '1px solid var(--border-primary)',
    borderRadius: 'var(--radius-sm)',
    color: 'var(--text-secondary)',
    padding: '0.35rem 0.75rem',
    fontSize: '0.8rem',
    cursor: 'pointer',
    transition: 'all 0.15s',
    whiteSpace: 'nowrap',
  };

  const activeBtnStyle: React.CSSProperties = {
    ...btnStyle,
    background: 'var(--accent-bg)',
    borderColor: 'var(--accent)',
    color: 'var(--accent)',
  };

  const logAreaStyle: React.CSSProperties = {
    flex: 1,
    overflow: 'auto',
    background: 'var(--bg-primary)',
    border: '1px solid var(--border-primary)',
    borderRadius: 'var(--radius)',
  };

  const rowStyle = (index: number, level: string): React.CSSProperties => ({
    display: 'flex',
    alignItems: 'flex-start',
    gap: '0.6rem',
    padding: '0.5rem 0.75rem',
    background: index % 2 === 0 ? 'var(--bg-secondary)' : 'transparent',
    borderLeft: `3px solid ${getLevelColor(level)}`,
    cursor: 'pointer',
    transition: 'background 0.1s',
    fontSize: '0.85rem',
    lineHeight: '1.4',
  });

  const timestampStyle: React.CSSProperties = {
    fontFamily: "'SF Mono', 'Cascadia Code', 'Fira Code', monospace",
    fontSize: '0.8rem',
    color: 'var(--text-muted)',
    whiteSpace: 'nowrap',
    minWidth: '5.5rem',
    userSelect: 'none',
  };

  const levelBadgeStyle = (level: string): React.CSSProperties => ({
    display: 'inline-block',
    padding: '0.1rem 0.4rem',
    borderRadius: '4px',
    fontSize: '0.7rem',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.03em',
    color: getLevelColor(level),
    background: `${getLevelColor(level)}18`,
    whiteSpace: 'nowrap',
    minWidth: '4.5rem',
    textAlign: 'center',
  });

  const categoryBadgeStyle: React.CSSProperties = {
    display: 'inline-block',
    padding: '0.1rem 0.35rem',
    borderRadius: '4px',
    fontSize: '0.65rem',
    fontWeight: 500,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    color: 'var(--text-muted)',
    background: 'var(--bg-tertiary)',
    whiteSpace: 'nowrap',
  };

  const symbolStyle: React.CSSProperties = {
    fontWeight: 700,
    color: 'var(--accent)',
    fontSize: '0.85rem',
    whiteSpace: 'nowrap',
  };

  const messageStyle: React.CSSProperties = {
    flex: 1,
    color: 'var(--text-primary)',
    wordBreak: 'break-word',
  };

  const detailsStyle: React.CSSProperties = {
    fontFamily: "'SF Mono', 'Cascadia Code', 'Fira Code', monospace",
    fontSize: '0.78rem',
    color: 'var(--text-secondary)',
    background: 'var(--bg-tertiary)',
    border: '1px solid var(--border-secondary)',
    borderRadius: 'var(--radius-sm)',
    padding: '0.6rem 0.75rem',
    margin: '0.4rem 0 0.2rem 6.1rem',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-all',
    maxHeight: '300px',
    overflow: 'auto',
  };

  const countStyle: React.CSSProperties = {
    fontSize: '0.75rem',
    color: 'var(--text-muted)',
    padding: '0.3rem 0.75rem',
    borderTop: '1px solid var(--border-secondary)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  };

  // Pulse animation via style tag
  const pulseKeyframes = `
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; }
    }
    @keyframes runPulse {
      0%, 100% { background: var(--bg-secondary); }
      50% { background: var(--bg-tertiary); }
    }
  `;

  return (
    <div style={pageStyle}>
      <style>{pulseKeyframes}</style>

      {/* Header */}
      <div style={headerStyle}>
        <div style={titleRowStyle}>
          <span style={{ fontSize: '1.25rem', fontWeight: 700 }}>Activity Log</span>
          <div style={liveDotStyle} title={connected ? 'Live stream connected' : 'Stream disconnected'} />
          <span style={{ fontSize: '0.75rem', color: connected ? 'var(--profit)' : 'var(--text-muted)' }}>
            {connected ? 'LIVE' : 'OFFLINE'}
          </span>
        </div>
      </div>

      {/* Filter bar */}
      <div style={filterBarStyle}>
        <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 500 }}>Category</label>
        <select style={selectStyle} value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>

        <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 500, marginLeft: '0.5rem' }}>Level</label>
        <select style={selectStyle} value={levelFilter} onChange={(e) => setLevelFilter(e.target.value)}>
          {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>

        <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 500, marginLeft: '0.5rem' }}>Verbosity</label>
        <div style={{ display: 'flex', gap: '2px' }}>
          {[1, 2, 3, 4, 5].map((v) => (
            <button
              key={v}
              onClick={() => setVerbosity(v)}
              title={VERBOSITY_LABELS[v]}
              style={{
                width: '1.8rem',
                height: '1.8rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '0.8rem',
                fontWeight: 700,
                cursor: 'pointer',
                transition: 'all 0.15s',
                border: v === verbosity ? '1px solid var(--accent)' : '1px solid var(--border-primary)',
                borderRadius: v === 1 ? 'var(--radius-sm) 0 0 var(--radius-sm)' : v === 5 ? '0 var(--radius-sm) var(--radius-sm) 0' : '0',
                background: v === verbosity ? 'var(--accent-bg)' : 'var(--bg-secondary)',
                color: v === verbosity ? 'var(--accent)' : 'var(--text-muted)',
              }}
            >
              {v}
            </button>
          ))}
        </div>

        <div style={{ flex: 1 }} />

        <button
          style={autoScroll ? activeBtnStyle : btnStyle}
          onClick={() => setAutoScroll(!autoScroll)}
          title="Auto-scroll to newest entries"
        >
          ↕ Auto-scroll {autoScroll ? 'ON' : 'OFF'}
        </button>

        <button
          style={streaming ? activeBtnStyle : btnStyle}
          onClick={() => setStreaming(!streaming)}
          title={streaming ? 'Pause live stream' : 'Resume live stream'}
        >
          {streaming ? '⏸ Pause' : '▶ Resume'}
        </button>

        <button
          style={btnStyle}
          onClick={handleClear}
          title="Clear streamed log entries"
        >
          ✕ Clear
        </button>
      </div>

      {/* Recent Analysis Runs */}
      {analysisRuns.length > 0 && (
        <div style={{
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-primary)',
          borderRadius: 'var(--radius)',
          overflow: 'hidden',
        }}>
          <div
            onClick={() => setRunsExpanded(!runsExpanded)}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '0.5rem 0.75rem',
              cursor: 'pointer',
              userSelect: 'none',
              borderBottom: runsExpanded ? '1px solid var(--border-secondary)' : 'none',
            }}
          >
            <span style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              📊 Recent Analysis Runs
            </span>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              {runsExpanded ? '▾ collapse' : '▸ expand'}
            </span>
          </div>
          {runsExpanded && (
            <div style={{ overflowX: 'auto' }}>
              <table style={{
                width: '100%',
                borderCollapse: 'collapse',
                fontFamily: "'SF Mono', 'Cascadia Code', 'Fira Code', monospace",
                fontSize: '0.8rem',
              }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-secondary)' }}>
                    {['Run #', 'Started', 'Duration', 'Stocks', 'Signals', 'Trades', 'Errors', 'Status'].map((h) => (
                      <th key={h} style={{
                        padding: '0.35rem 0.6rem',
                        textAlign: h === 'Started' ? 'left' : 'center',
                        color: 'var(--text-muted)',
                        fontWeight: 600,
                        fontSize: '0.72rem',
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em',
                        whiteSpace: 'nowrap',
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {analysisRuns.map((run: any, idx: number) => {
                    const isRunning = run.status === 'running';
                    const isFailed = run.status === 'failed';
                    const hasErrors = (run.errors_count || 0) > 0;
                    const durationMs = run.duration_ms || 0;
                    const mins = Math.floor(durationMs / 60000);
                    const secs = Math.floor((durationMs % 60000) / 1000);
                    const durationStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
                    const startedStr = run.started_at
                      ? new Date(run.started_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
                        ', ' +
                        new Date(run.started_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })
                      : '—';
                    const statusIcon = isRunning ? '🔄' : isFailed ? '❌' : '✅';

                    return (
                      <tr key={run.id ?? idx} style={{
                        borderBottom: '1px solid var(--border-secondary)',
                        animation: isRunning ? 'runPulse 2s ease-in-out infinite' : 'none',
                        background: idx % 2 === 0 ? 'transparent' : 'var(--bg-primary)',
                      }}>
                        <td style={{ padding: '0.35rem 0.6rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                          {run.id ?? analysisRuns.length - idx}
                        </td>
                        <td style={{ padding: '0.35rem 0.6rem', textAlign: 'left', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                          {startedStr}
                        </td>
                        <td style={{ padding: '0.35rem 0.6rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                          {isRunning ? '…' : durationStr}
                        </td>
                        <td style={{ padding: '0.35rem 0.6rem', textAlign: 'center', color: 'var(--text-primary)' }}>
                          {run.stocks_analysed ?? '—'}
                        </td>
                        <td style={{ padding: '0.35rem 0.6rem', textAlign: 'center', color: 'var(--text-primary)' }}>
                          {run.signals_captured ?? '—'}
                        </td>
                        <td style={{ padding: '0.35rem 0.6rem', textAlign: 'center', color: 'var(--accent)', fontWeight: 700 }}>
                          {run.trades_executed ?? 0}
                        </td>
                        <td style={{
                          padding: '0.35rem 0.6rem',
                          textAlign: 'center',
                          color: hasErrors ? 'var(--loss)' : 'var(--text-muted)',
                          fontWeight: hasErrors ? 700 : 400,
                        }}>
                          {run.errors_count ?? 0}
                        </td>
                        <td style={{ padding: '0.35rem 0.6rem', textAlign: 'center', whiteSpace: 'nowrap' }}>
                          <span title={run.status}>{statusIcon} {run.status}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Log entries */}
      <div ref={scrollRef} style={logAreaStyle}>
        {isLoading && filteredLogs.length === 0 && (
          <div className="loading-state">Loading activity logs…</div>
        )}

        {isError && filteredLogs.length === 0 && (
          <div className="empty-state">
            <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>▤</div>
            <div style={{ fontWeight: 600, marginBottom: '0.3rem' }}>No log data available</div>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              The activity log endpoint is not responding yet. Logs will appear here once the pipeline starts running.
            </div>
          </div>
        )}

        {!isLoading && !isError && filteredLogs.length === 0 && (
          <div className="empty-state">
            <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>▤</div>
            <div style={{ fontWeight: 600, marginBottom: '0.3rem' }}>No activity yet</div>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              {categoryFilter !== 'All' || levelFilter !== 'All'
                ? 'No entries match the current filters. Try adjusting your selection.'
                : 'Waiting for pipeline activity. Log entries will appear in real-time.'}
            </div>
          </div>
        )}

        {filteredLogs.map((entry, i) => (
          <div key={entry.id ?? `${entry.created_at}-${i}`}>
            <div
              style={rowStyle(i, entry.level)}
              onClick={() => entry.details && toggleExpand(entry.id)}
            >
              <span style={timestampStyle} title={formatFull(entry.created_at)}>
                {formatTime(entry.created_at)}
              </span>
              <span style={levelBadgeStyle(entry.level)}>
                {entry.level}
              </span>
              <span style={categoryBadgeStyle}>
                {entry.category}
              </span>
              {entry.symbol && (
                <span style={symbolStyle}>{entry.symbol}</span>
              )}
              <span style={messageStyle}>
                {entry.message}
                {entry.details && (
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginLeft: '0.4rem' }}>
                    {expandedIds.has(entry.id) ? '▾' : '▸'}
                  </span>
                )}
              </span>
            </div>

            {entry.details && expandedIds.has(entry.id) && (
              <div style={detailsStyle}>
                {tryFormatJson(entry.details)}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Footer status bar */}
      <div style={countStyle}>
        <span>
          {filteredLogs.length} {filteredLogs.length === 1 ? 'entry' : 'entries'}
          {(categoryFilter !== 'All' || levelFilter !== 'All') && ` (filtered from ${allLogs.length})`}
        </span>
        <span>
          {streamLogs.length} streamed · {connected ? '🟢 connected' : '🔴 disconnected'}
        </span>
      </div>
    </div>
  );
}
