import { useState, useEffect, useCallback, useRef } from 'react';

export interface LogEntry {
  id: number;
  level: string;
  category: string;
  symbol: string | null;
  message: string;
  details: string | null;
  created_at: string;
}

export function useLogStream(enabled = true, maxVerbosity?: number) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [connected, setConnected] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!enabled) return;

    const url = maxVerbosity != null
      ? `/api/logs/stream?max_verbosity=${maxVerbosity}`
      : '/api/logs/stream';
    const es = new EventSource(url);
    eventSourceRef.current = es;

    es.onopen = () => setConnected(true);
    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'connected') {
          setConnected(true);
          return;
        }
        // It's a log entry
        setLogs((prev) => [data, ...prev].slice(0, 500)); // keep last 500
      } catch { /* ignore parse errors */ }
    };
    es.onerror = () => {
      setConnected(false);
      // EventSource auto-reconnects
    };

    return () => {
      es.close();
      eventSourceRef.current = null;
    };
  }, [enabled, maxVerbosity]);

  const clear = useCallback(() => setLogs([]), []);

  return { logs, connected, clear };
}
