import axios from 'axios';
import { getDb } from '../db';
import type { Market } from '../types';

// ─── Stock universe seed data ───────────────────────────────────

interface SeedStock {
  symbol: string;
  name: string;
  market: Market;
  assetType: 'stock' | 'etf';
  sector: string | null;
  currency: string;
}

const SEED_UNIVERSE: SeedStock[] = [
  // ── US Stocks (~30) ─────────────────────────────────────────────
  { symbol: 'AAPL', name: 'Apple Inc.', market: 'US', assetType: 'stock', sector: 'Technology', currency: 'USD' },
  { symbol: 'MSFT', name: 'Microsoft Corp.', market: 'US', assetType: 'stock', sector: 'Technology', currency: 'USD' },
  { symbol: 'GOOGL', name: 'Alphabet Inc.', market: 'US', assetType: 'stock', sector: 'Technology', currency: 'USD' },
  { symbol: 'AMZN', name: 'Amazon.com Inc.', market: 'US', assetType: 'stock', sector: 'Consumer Cyclical', currency: 'USD' },
  { symbol: 'NVDA', name: 'NVIDIA Corp.', market: 'US', assetType: 'stock', sector: 'Technology', currency: 'USD' },
  { symbol: 'TSLA', name: 'Tesla Inc.', market: 'US', assetType: 'stock', sector: 'Consumer Cyclical', currency: 'USD' },
  { symbol: 'JPM', name: 'JPMorgan Chase & Co.', market: 'US', assetType: 'stock', sector: 'Financial Services', currency: 'USD' },
  { symbol: 'JNJ', name: 'Johnson & Johnson', market: 'US', assetType: 'stock', sector: 'Healthcare', currency: 'USD' },
  { symbol: 'V', name: 'Visa Inc.', market: 'US', assetType: 'stock', sector: 'Financial Services', currency: 'USD' },
  { symbol: 'PG', name: 'Procter & Gamble Co.', market: 'US', assetType: 'stock', sector: 'Consumer Defensive', currency: 'USD' },
  { symbol: 'UNH', name: 'UnitedHealth Group Inc.', market: 'US', assetType: 'stock', sector: 'Healthcare', currency: 'USD' },
  { symbol: 'HD', name: 'Home Depot Inc.', market: 'US', assetType: 'stock', sector: 'Consumer Cyclical', currency: 'USD' },
  { symbol: 'MA', name: 'Mastercard Inc.', market: 'US', assetType: 'stock', sector: 'Financial Services', currency: 'USD' },
  { symbol: 'DIS', name: 'Walt Disney Co.', market: 'US', assetType: 'stock', sector: 'Communication Services', currency: 'USD' },
  { symbol: 'NFLX', name: 'Netflix Inc.', market: 'US', assetType: 'stock', sector: 'Communication Services', currency: 'USD' },
  { symbol: 'PYPL', name: 'PayPal Holdings Inc.', market: 'US', assetType: 'stock', sector: 'Financial Services', currency: 'USD' },
  { symbol: 'CRM', name: 'Salesforce Inc.', market: 'US', assetType: 'stock', sector: 'Technology', currency: 'USD' },
  { symbol: 'AMD', name: 'Advanced Micro Devices Inc.', market: 'US', assetType: 'stock', sector: 'Technology', currency: 'USD' },
  { symbol: 'INTC', name: 'Intel Corp.', market: 'US', assetType: 'stock', sector: 'Technology', currency: 'USD' },
  { symbol: 'COST', name: 'Costco Wholesale Corp.', market: 'US', assetType: 'stock', sector: 'Consumer Defensive', currency: 'USD' },
  { symbol: 'PEP', name: 'PepsiCo Inc.', market: 'US', assetType: 'stock', sector: 'Consumer Defensive', currency: 'USD' },
  { symbol: 'KO', name: 'Coca-Cola Co.', market: 'US', assetType: 'stock', sector: 'Consumer Defensive', currency: 'USD' },
  { symbol: 'WMT', name: 'Walmart Inc.', market: 'US', assetType: 'stock', sector: 'Consumer Defensive', currency: 'USD' },
  { symbol: 'XOM', name: 'Exxon Mobil Corp.', market: 'US', assetType: 'stock', sector: 'Energy', currency: 'USD' },
  { symbol: 'CVX', name: 'Chevron Corp.', market: 'US', assetType: 'stock', sector: 'Energy', currency: 'USD' },
  { symbol: 'META', name: 'Meta Platforms Inc.', market: 'US', assetType: 'stock', sector: 'Technology', currency: 'USD' },
  { symbol: 'BAC', name: 'Bank of America Corp.', market: 'US', assetType: 'stock', sector: 'Financial Services', currency: 'USD' },
  { symbol: 'ABBV', name: 'AbbVie Inc.', market: 'US', assetType: 'stock', sector: 'Healthcare', currency: 'USD' },
  { symbol: 'LLY', name: 'Eli Lilly & Co.', market: 'US', assetType: 'stock', sector: 'Healthcare', currency: 'USD' },
  { symbol: 'AVGO', name: 'Broadcom Inc.', market: 'US', assetType: 'stock', sector: 'Technology', currency: 'USD' },

  // ── US ETFs ──────────────────────────────────────────────────────
  { symbol: 'SPY', name: 'SPDR S&P 500 ETF', market: 'US', assetType: 'etf', sector: null, currency: 'USD' },
  { symbol: 'QQQ', name: 'Invesco QQQ Trust', market: 'US', assetType: 'etf', sector: null, currency: 'USD' },
  { symbol: 'VTI', name: 'Vanguard Total Stock Market ETF', market: 'US', assetType: 'etf', sector: null, currency: 'USD' },
  { symbol: 'IWM', name: 'iShares Russell 2000 ETF', market: 'US', assetType: 'etf', sector: null, currency: 'USD' },
  { symbol: 'XLF', name: 'Financial Select Sector SPDR', market: 'US', assetType: 'etf', sector: 'Financial Services', currency: 'USD' },
  { symbol: 'XLK', name: 'Technology Select Sector SPDR', market: 'US', assetType: 'etf', sector: 'Technology', currency: 'USD' },

  // ── Europe (~15) ────────────────────────────────────────────────
  { symbol: 'ASML.AS', name: 'ASML Holding NV', market: 'EU', assetType: 'stock', sector: 'Technology', currency: 'EUR' },
  { symbol: 'SAP.DE', name: 'SAP SE', market: 'EU', assetType: 'stock', sector: 'Technology', currency: 'EUR' },
  { symbol: 'NESN.SW', name: 'Nestlé SA', market: 'EU', assetType: 'stock', sector: 'Consumer Defensive', currency: 'CHF' },
  { symbol: 'NOVN.SW', name: 'Novartis AG', market: 'EU', assetType: 'stock', sector: 'Healthcare', currency: 'CHF' },
  { symbol: 'OR.PA', name: "L'Oréal SA", market: 'EU', assetType: 'stock', sector: 'Consumer Cyclical', currency: 'EUR' },
  { symbol: 'MC.PA', name: 'LVMH Moët Hennessy', market: 'EU', assetType: 'stock', sector: 'Consumer Cyclical', currency: 'EUR' },
  { symbol: 'SHEL.L', name: 'Shell plc', market: 'EU', assetType: 'stock', sector: 'Energy', currency: 'GBP' },
  { symbol: 'AZN.L', name: 'AstraZeneca plc', market: 'EU', assetType: 'stock', sector: 'Healthcare', currency: 'GBP' },
  { symbol: 'SIEGY', name: 'Siemens AG', market: 'EU', assetType: 'stock', sector: 'Industrials', currency: 'USD' },
  { symbol: 'VOW3.DE', name: 'Volkswagen AG', market: 'EU', assetType: 'stock', sector: 'Consumer Cyclical', currency: 'EUR' },
  { symbol: 'BMW.DE', name: 'BMW AG', market: 'EU', assetType: 'stock', sector: 'Consumer Cyclical', currency: 'EUR' },
  { symbol: 'SAN.MC', name: 'Banco Santander SA', market: 'EU', assetType: 'stock', sector: 'Financial Services', currency: 'EUR' },
  { symbol: 'SIE.DE', name: 'Siemens AG (Frankfurt)', market: 'EU', assetType: 'stock', sector: 'Industrials', currency: 'EUR' },
  { symbol: 'AIR.PA', name: 'Airbus SE', market: 'EU', assetType: 'stock', sector: 'Industrials', currency: 'EUR' },
  { symbol: 'BNP.PA', name: 'BNP Paribas SA', market: 'EU', assetType: 'stock', sector: 'Financial Services', currency: 'EUR' },

  // ── Asia (~15) ──────────────────────────────────────────────────
  { symbol: '7203.T', name: 'Toyota Motor Corp.', market: 'ASIA', assetType: 'stock', sector: 'Consumer Cyclical', currency: 'JPY' },
  { symbol: '9984.T', name: 'SoftBank Group Corp.', market: 'ASIA', assetType: 'stock', sector: 'Technology', currency: 'JPY' },
  { symbol: '6758.T', name: 'Sony Group Corp.', market: 'ASIA', assetType: 'stock', sector: 'Technology', currency: 'JPY' },
  { symbol: '9988.HK', name: 'Alibaba Group Holding', market: 'ASIA', assetType: 'stock', sector: 'Technology', currency: 'HKD' },
  { symbol: '0700.HK', name: 'Tencent Holdings Ltd.', market: 'ASIA', assetType: 'stock', sector: 'Technology', currency: 'HKD' },
  { symbol: '005930.KS', name: 'Samsung Electronics Co.', market: 'ASIA', assetType: 'stock', sector: 'Technology', currency: 'KRW' },
  { symbol: 'TSM', name: 'Taiwan Semiconductor Mfg.', market: 'ASIA', assetType: 'stock', sector: 'Technology', currency: 'USD' },
  { symbol: '6861.T', name: 'Keyence Corp.', market: 'ASIA', assetType: 'stock', sector: 'Technology', currency: 'JPY' },
  { symbol: '8306.T', name: 'Mitsubishi UFJ Financial', market: 'ASIA', assetType: 'stock', sector: 'Financial Services', currency: 'JPY' },
  { symbol: '9433.T', name: 'KDDI Corp.', market: 'ASIA', assetType: 'stock', sector: 'Communication Services', currency: 'JPY' },
  { symbol: '1299.HK', name: 'AIA Group Ltd.', market: 'ASIA', assetType: 'stock', sector: 'Financial Services', currency: 'HKD' },
  { symbol: '2318.HK', name: 'Ping An Insurance', market: 'ASIA', assetType: 'stock', sector: 'Financial Services', currency: 'HKD' },
  { symbol: 'RELIANCE.NS', name: 'Reliance Industries Ltd.', market: 'ASIA', assetType: 'stock', sector: 'Energy', currency: 'INR' },
  { symbol: 'TCS.NS', name: 'Tata Consultancy Services', market: 'ASIA', assetType: 'stock', sector: 'Technology', currency: 'INR' },
  { symbol: '3690.HK', name: 'Meituan', market: 'ASIA', assetType: 'stock', sector: 'Technology', currency: 'HKD' },
];

// ─── Seed the initial stock universe ─────────────────────────────

/**
 * Insert seed stocks into the `stocks` table if not already present.
 * Safe to call multiple times — uses INSERT OR IGNORE.
 */
export function seedInitialUniverse(): number {
  const db = getDb();
  const insert = db.prepare(`
    INSERT OR IGNORE INTO stocks (symbol, name, market, asset_type, sector, currency, is_active)
    VALUES (?, ?, ?, ?, ?, ?, 1)
  `);

  const insertMany = db.transaction((stocks: SeedStock[]) => {
    let inserted = 0;
    for (const s of stocks) {
      const result = insert.run(s.symbol, s.name, s.market, s.assetType, s.sector, s.currency);
      if (result.changes > 0) inserted++;
    }
    return inserted;
  });

  const inserted = insertMany(SEED_UNIVERSE);
  console.log(`[StockDiscovery] Seeded ${inserted} new stocks (${SEED_UNIVERSE.length} total in universe)`);
  return inserted;
}

// ─── Discover new stocks ────────────────────────────────────────

interface YahooScreenerQuote {
  symbol: string;
  shortName?: string;
  longName?: string;
  marketCap?: number;
  averageDailyVolume3Month?: number;
  exchange?: string;
}

/**
 * Discover new stock opportunities using Yahoo Finance screener.
 * Looks for high-volume, large-cap stocks not yet in our universe.
 */
export async function discoverNewStocks(): Promise<number> {
  const db = getDb();
  let totalAdded = 0;

  try {
    // Fetch Yahoo Finance most-active / gainers as discovery source
    const screenerUrls = [
      'https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?formatted=false&scrIds=most_actives&count=25',
      'https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?formatted=false&scrIds=day_gainers&count=25',
    ];

    const existingSymbols = new Set<string>(
      (db.prepare('SELECT symbol FROM stocks').all() as any[]).map((r: any) => r.symbol)
    );

    for (const url of screenerUrls) {
      try {
        const resp = await axios.get(url, {
          timeout: 15_000,
          headers: { 'User-Agent': 'APEX/1.0' },
        });

        const quotes: YahooScreenerQuote[] =
          resp.data?.finance?.result?.[0]?.quotes || [];

        for (const q of quotes) {
          if (!q.symbol || existingSymbols.has(q.symbol)) continue;
          // Filter: market cap > $1B and decent volume
          if ((q.marketCap ?? 0) < 1_000_000_000) continue;
          if ((q.averageDailyVolume3Month ?? 0) < 1_000_000) continue;

          const market = inferMarket(q.symbol, q.exchange);
          const name = q.longName || q.shortName || q.symbol;

          try {
            db.prepare(`
              INSERT OR IGNORE INTO stocks (symbol, name, market, asset_type, sector, currency, is_active)
              VALUES (?, ?, ?, 'stock', NULL, 'USD', 1)
            `).run(q.symbol, name, market);
            existingSymbols.add(q.symbol);
            totalAdded++;
          } catch { /* duplicate or constraint error — skip */ }
        }
      } catch (err: any) {
        console.warn(`[StockDiscovery] Screener fetch failed: ${err.message}`);
      }
    }

    if (totalAdded > 0) {
      console.log(`[StockDiscovery] Discovered ${totalAdded} new stocks`);
    }

    // Record last discovery run
    db.prepare(`
      INSERT OR REPLACE INTO system_state (key, value, updated_at)
      VALUES ('last_discovery_run', datetime('now'), datetime('now'))
    `).run();
  } catch (err: any) {
    console.error(`[StockDiscovery] Discovery failed: ${err.message}`);
  }

  return totalAdded;
}

// ─── Prune inactive stocks ──────────────────────────────────────

/**
 * Remove stocks that have had consistently neutral signals for 30+ days.
 * Does not prune stocks with open positions.
 */
export function pruneInactiveStocks(): number {
  const db = getDb();

  try {
    // Find stocks with only neutral signals in the last 30 days (or no signals at all)
    const candidates = db.prepare(`
      SELECT s.id, s.symbol FROM stocks s
      WHERE s.is_active = 1
      AND NOT EXISTS (
        SELECT 1 FROM portfolio_positions pp
        WHERE pp.stock_id = s.id AND pp.quantity > 0
      )
      AND NOT EXISTS (
        SELECT 1 FROM signals sig
        WHERE sig.stock_id = s.id
        AND sig.direction != 'neutral'
        AND sig.captured_at > datetime('now', '-30 days')
      )
      AND EXISTS (
        SELECT 1 FROM signals sig2
        WHERE sig2.stock_id = s.id
        AND sig2.captured_at > datetime('now', '-60 days')
      )
    `).all() as any[];

    if (candidates.length === 0) return 0;

    const deactivate = db.prepare('UPDATE stocks SET is_active = 0 WHERE id = ?');
    const pruneMany = db.transaction((items: any[]) => {
      let count = 0;
      for (const c of items) {
        deactivate.run(c.id);
        count++;
      }
      return count;
    });

    const pruned = pruneMany(candidates);
    if (pruned > 0) {
      console.log(`[StockDiscovery] Pruned ${pruned} inactive stocks: ${candidates.map(c => c.symbol).join(', ')}`);
    }
    return pruned;
  } catch (err: any) {
    console.error(`[StockDiscovery] Pruning failed: ${err.message}`);
    return 0;
  }
}

// ─── Helpers ────────────────────────────────────────────────────

function inferMarket(symbol: string, exchange?: string): Market {
  if (symbol.endsWith('.T') || symbol.endsWith('.HK') || symbol.endsWith('.SS') ||
      symbol.endsWith('.SZ') || symbol.endsWith('.KS') || symbol.endsWith('.NS') ||
      symbol.endsWith('.BO')) {
    return 'ASIA';
  }
  if (symbol.endsWith('.DE') || symbol.endsWith('.PA') || symbol.endsWith('.L') ||
      symbol.endsWith('.AS') || symbol.endsWith('.SW') || symbol.endsWith('.MC') ||
      symbol.endsWith('.MI')) {
    return 'EU';
  }
  if (exchange) {
    const exUpper = exchange.toUpperCase();
    if (exUpper.includes('TOKYO') || exUpper.includes('HONG KONG') || exUpper.includes('SHANGHAI') ||
        exUpper.includes('SHENZHEN') || exUpper.includes('KOREA') || exUpper.includes('NSE') ||
        exUpper.includes('BSE')) {
      return 'ASIA';
    }
    if (exUpper.includes('LONDON') || exUpper.includes('XETRA') || exUpper.includes('EURONEXT') ||
        exUpper.includes('PARIS') || exUpper.includes('AMSTERDAM') || exUpper.includes('FRANKFURT') ||
        exUpper.includes('SWISS')) {
      return 'EU';
    }
  }
  return 'US';
}
