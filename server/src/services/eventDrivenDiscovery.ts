/**
 * Event-Driven Stock Discovery — LLM-powered discovery based on macro events.
 * Scans news headlines → identifies geopolitical/macro events → suggests stocks/ETFs.
 */

import axios from 'axios';
import { getDb } from '../db';
import { chatCompletion } from './llm/provider';
import { logActivity } from './activityLogger';

// ─── Types ──────────────────────────────────────────────────────

export interface DiscoveredEvent {
  event: string;
  impact: string;
  confidence: 'high' | 'medium' | 'low';
  beneficiaries: DiscoveredSymbol[];
  negatively_impacted: DiscoveredSymbol[];
}

export interface DiscoveredSymbol {
  symbol: string;
  name: string;
  asset_type: 'stock' | 'etf';
  reason: string;
}

export interface EventDiscoveryResult {
  timestamp: string;
  events: DiscoveredEvent[];
  symbols_added: number;
  symbols_updated: number;
}

// ─── Finnhub News Fetcher ───────────────────────────────────────

async function fetchMarketNews(): Promise<string[]> {
  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey) {
    console.warn('[EventDiscovery] No FINNHUB_API_KEY — cannot fetch news');
    return [];
  }

  try {
    const categories = ['general', 'forex', 'crypto'];
    const headlines: string[] = [];

    for (const category of categories) {
      try {
        const resp = await axios.get('https://finnhub.io/api/v1/news', {
          params: { category, token: apiKey },
          timeout: 10_000,
        });

        if (Array.isArray(resp.data)) {
          const categoryHeadlines = resp.data
            .slice(0, 30)
            .map((article: any) => article.headline || '')
            .filter((h: string) => h.length > 0);
          headlines.push(...categoryHeadlines);
        }
      } catch (err: any) {
        console.warn(`[EventDiscovery] Failed to fetch ${category} news: ${err.message}`);
      }
    }

    logActivity('info', 'discovery', `Fetched ${headlines.length} news headlines for event analysis`, undefined, undefined, 4);
    return headlines.slice(0, 100); // Max 100 headlines
  } catch (err: any) {
    console.error('[EventDiscovery] News fetch failed:', err.message);
    return [];
  }
}

// ─── LLM Analysis ───────────────────────────────────────────────

async function analyzeEventsWithLLM(headlines: string[]): Promise<DiscoveredEvent[]> {
  if (headlines.length === 0) {
    return [];
  }

  const systemPrompt = `You are a macro-economic analyst specializing in identifying investment opportunities from news events.

Your task is to:
1. Analyze news headlines and identify major macro/geopolitical events
2. Determine which stocks and ETFs would BENEFIT from each event
3. Identify stocks that might be NEGATIVELY impacted
4. Provide clear reasoning and confidence levels

Focus on:
- Geopolitical events (wars, sanctions, trade disputes, elections)
- Macro-economic shifts (interest rates, inflation, employment data)
- Sector-specific catalysts (regulations, policy changes, technology shifts)
- Energy/commodity price movements
- Currency fluctuations and their trade impacts

For each identified event, recommend:
- 5-10 individual stock symbols that would benefit (use actual NYSE/NASDAQ tickers)
- 2-3 ETF symbols that capture the theme
- 2-3 stocks that might be hurt (for short candidates)
- Confidence level (high/medium/low) based on event clarity and market impact
- Brief reasoning for each recommendation

Return ONLY valid JSON (no markdown, no code blocks) in this exact format:
{
  "events": [
    {
      "event": "Event description",
      "impact": "Brief impact summary",
      "confidence": "high|medium|low",
      "beneficiaries": [
        {
          "symbol": "TICKER",
          "name": "Company Name",
          "asset_type": "stock|etf",
          "reason": "Why this benefits"
        }
      ],
      "negatively_impacted": [
        {
          "symbol": "TICKER",
          "name": "Company Name",
          "asset_type": "stock",
          "reason": "Why this is hurt"
        }
      ]
    }
  ]
}`;

  const userPrompt = `Analyze these news headlines and identify investment opportunities:

${headlines.map((h, i) => `${i + 1}. ${h}`).join('\n')}

Identify 2-5 major events and recommend stocks/ETFs that would benefit or be harmed. Return as JSON.`;

  logActivity('info', 'llm', 'Requesting event analysis from LLM', undefined, { headline_count: headlines.length }, 4);

  try {
    const response = await chatCompletion(systemPrompt, userPrompt, { maxTokens: 4096 });
    if (!response) {
      logActivity('warn', 'llm', 'LLM not available for event discovery — falling back to empty result', undefined, undefined, 3);
      return [];
    }

    logActivity('info', 'llm', 'LLM event analysis completed', undefined, { tokens_used: response.tokensUsed }, 5);

    // Parse LLM response — handle markdown blocks, truncated JSON, etc.
    const content = response.content.trim();
    // Extract JSON from markdown code blocks or raw content
    let jsonContent = content;
    const codeBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      jsonContent = codeBlockMatch[1].trim();
    } else {
      // Strip any leading/trailing non-JSON text
      const jsonStart = content.indexOf('{');
      const jsonEnd = content.lastIndexOf('}');
      if (jsonStart >= 0 && jsonEnd > jsonStart) {
        jsonContent = content.slice(jsonStart, jsonEnd + 1);
      }
    }
    
    const parsed = JSON.parse(jsonContent);
    
    if (!parsed.events || !Array.isArray(parsed.events)) {
      logActivity('warn', 'llm', 'LLM response missing events array', undefined, { response: content.slice(0, 200) }, 3);
      return [];
    }

    logActivity('info', 'discovery', `LLM identified ${parsed.events.length} macro events`, undefined, undefined, 3);
    return parsed.events;
  } catch (err: any) {
    logActivity('error', 'llm', `Event analysis parsing failed: ${err.message}`, undefined, undefined, 2);
    return [];
  }
}

// ─── Database Integration ──────────────────────────────────────

function ensureDiscoveryColumns(): void {
  const db = getDb();
  const columns = [
    { name: 'discovery_reason', type: 'TEXT' },
    { name: 'discovered_at', type: 'TEXT' },
    { name: 'discovery_event', type: 'TEXT' },
  ];

  for (const col of columns) {
    try {
      db.exec(`ALTER TABLE stocks ADD COLUMN ${col.name} ${col.type}`);
    } catch {
      // Column already exists
    }
  }
}

function addOrUpdateStock(
  symbol: string,
  name: string,
  assetType: 'stock' | 'etf',
  discoveryEvent: string,
  discoveryReason: string
): 'added' | 'updated' {
  const db = getDb();
  
  // Check if stock exists
  const existing = db.prepare('SELECT id, is_active FROM stocks WHERE symbol = ?').get(symbol) as any;
  
  if (existing) {
    // Reactivate and update discovery info
    db.prepare(`
      UPDATE stocks 
      SET is_active = 1,
          discovery_event = ?,
          discovery_reason = ?,
          discovered_at = datetime('now')
      WHERE symbol = ?
    `).run(discoveryEvent, discoveryReason, symbol);
    
    return 'updated';
  } else {
    // Insert new stock
    db.prepare(`
      INSERT INTO stocks (symbol, name, market, asset_type, sector, is_active, discovery_event, discovery_reason, discovered_at)
      VALUES (?, ?, 'US', ?, 'Unknown', 1, ?, ?, datetime('now'))
    `).run(symbol, name, assetType, discoveryEvent, discoveryReason);
    
    return 'added';
  }
}

// ─── Main Discovery Function ────────────────────────────────────

export async function runEventDrivenDiscovery(): Promise<EventDiscoveryResult> {
  logActivity('info', 'discovery', 'Starting event-driven stock discovery', undefined, undefined, 2);
  
  ensureDiscoveryColumns();
  
  const startTime = Date.now();
  
  // 1. Fetch news headlines
  const headlines = await fetchMarketNews();
  if (headlines.length === 0) {
    logActivity('warn', 'discovery', 'No news headlines available — skipping event discovery', undefined, undefined, 3);
    return {
      timestamp: new Date().toISOString(),
      events: [],
      symbols_added: 0,
      symbols_updated: 0,
    };
  }
  
  // 2. Analyze with LLM
  const events = await analyzeEventsWithLLM(headlines);
  if (events.length === 0) {
    logActivity('warn', 'discovery', 'No macro events identified', undefined, undefined, 3);
    return {
      timestamp: new Date().toISOString(),
      events: [],
      symbols_added: 0,
      symbols_updated: 0,
    };
  }
  
  // 3. Add discovered stocks to database
  let symbolsAdded = 0;
  let symbolsUpdated = 0;
  
  for (const event of events) {
    logActivity(
      'discovery',
      'discovery',
      `Event: ${event.event}`,
      undefined,
      {
        impact: event.impact,
        confidence: event.confidence,
        beneficiaries: event.beneficiaries.length,
        negatively_impacted: event.negatively_impacted.length,
      },
      3
    );
    
    // Add beneficiaries
    for (const symbol of event.beneficiaries) {
      const result = addOrUpdateStock(
        symbol.symbol,
        symbol.name,
        symbol.asset_type,
        event.event,
        symbol.reason
      );
      
      if (result === 'added') {
        symbolsAdded++;
        logActivity(
          'discovery',
          'discovery',
          `Added ${symbol.asset_type.toUpperCase()}: ${symbol.symbol} (${symbol.name})`,
          symbol.symbol,
          { event: event.event, reason: symbol.reason, confidence: event.confidence },
          3
        );
      } else {
        symbolsUpdated++;
        logActivity(
          'info',
          'discovery',
          `Reactivated ${symbol.symbol}`,
          symbol.symbol,
          { reason: symbol.reason },
          4
        );
      }
    }
    
    // Note: We don't add negatively_impacted to watchlist, but we log them
    if (event.negatively_impacted.length > 0) {
      logActivity(
        'info',
        'discovery',
        `Identified ${event.negatively_impacted.length} negatively impacted stocks (not added to watchlist)`,
        undefined,
        { symbols: event.negatively_impacted.map(s => s.symbol) },
        4
      );
    }
  }
  
  const duration = Date.now() - startTime;
  
  logActivity(
    'info',
    'discovery',
    `Event-driven discovery completed: ${symbolsAdded} added, ${symbolsUpdated} reactivated in ${duration}ms`,
    undefined,
    { events_found: events.length, duration_ms: duration },
    2
  );
  
  return {
    timestamp: new Date().toISOString(),
    events,
    symbols_added: symbolsAdded,
    symbols_updated: symbolsUpdated,
  };
}

// ─── Get Latest Discovery Results ───────────────────────────────

export function getLatestDiscoveryEvents(): {
  events: Array<{ symbol: string; name: string; asset_type: string; discovery_event: string; discovery_reason: string; discovered_at: string }>;
  count: number;
} {
  const db = getDb();
  
  const events = db.prepare(`
    SELECT symbol, name, asset_type, discovery_event, discovery_reason, discovered_at
    FROM stocks
    WHERE discovery_event IS NOT NULL
    ORDER BY discovered_at DESC
    LIMIT 50
  `).all() as any[];
  
  return {
    events,
    count: events.length,
  };
}
