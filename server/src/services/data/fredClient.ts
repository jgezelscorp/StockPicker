/**
 * FRED (Federal Reserve Economic Data) Client
 * 
 * Fetches macroeconomic indicators from the FRED API (https://api.stlouisfed.org/).
 * Free API key required — register at https://fred.stlouisfed.org/docs/api/api_key.html
 * 
 * Indicators tracked:
 * - CPI (Consumer Price Index) — inflation proxy
 * - Unemployment Rate
 * - GDP Growth (Real GDP, quarterly)
 * - PMI (ISM Manufacturing)
 * - Fed Funds Rate
 * - 10Y-2Y Treasury Spread (yield curve — recession predictor)
 * - Initial Jobless Claims (weekly labor market pulse)
 */

import axios from 'axios';
import { getDb } from '../../db';

// ─── Types ──────────────────────────────────────────────────────

export interface FredSeriesObservation {
  date: string;
  value: number;
}

export interface MacroIndicators {
  /** Year-over-year CPI change (inflation %) */
  cpiYoY: number | null;
  /** CPI trend direction over last 3 readings */
  cpiTrend: 'rising' | 'falling' | 'stable' | null;
  /** Unemployment rate (%) */
  unemploymentRate: number | null;
  /** Unemployment trend over last 3 readings */
  unemploymentTrend: 'rising' | 'falling' | 'stable' | null;
  /** Real GDP growth (annualized %) */
  gdpGrowth: number | null;
  /** ISM Manufacturing PMI */
  pmi: number | null;
  /** Federal Funds Effective Rate (%) */
  fedFundsRate: number | null;
  /** 10Y-2Y Treasury Spread (basis points — negative = inverted yield curve) */
  yieldCurveSpread: number | null;
  /** Whether yield curve is inverted (recession signal) */
  yieldCurveInverted: boolean;
  /** Initial jobless claims (thousands, weekly) */
  initialClaims: number | null;
  /** Claims trend over last 4 weeks */
  claimsTrend: 'rising' | 'falling' | 'stable' | null;
  /** Data freshness — oldest observation date among indicators */
  dataAsOf: string | null;
  /** How many indicators successfully loaded */
  indicatorsLoaded: number;
}

export type MacroRegime = 'growth' | 'slowdown' | 'recession' | 'recovery' | 'stagflation';

export interface RegimeClassification {
  regime: MacroRegime;
  confidence: number; // 0–1
  reasoning: string;
  indicators: MacroIndicators;
}

// ─── FRED Series IDs ────────────────────────────────────────────

const FRED_SERIES = {
  CPI_YOY: 'CPIAUCSL',           // CPI for all urban consumers (monthly)
  UNEMPLOYMENT: 'UNRATE',         // Unemployment rate (monthly)
  GDP_GROWTH: 'A191RL1Q225SBEA',  // Real GDP growth (quarterly, annualized)
  PMI: 'MANEMP',                  // ISM Manufacturing Employment (monthly proxy — true ISM is ISM/PMI)
  FED_FUNDS: 'FEDFUNDS',          // Effective federal funds rate (monthly)
  T10Y2Y: 'T10Y2Y',              // 10Y-2Y Treasury spread (daily)
  INITIAL_CLAIMS: 'ICSA',         // Initial jobless claims (weekly)
} as const;

// Use ISM PMI directly if available, else fall back to NAPM index
const PMI_SERIES = 'NAPM';  // ISM Manufacturing: PMI Composite Index

// ─── Cache ──────────────────────────────────────────────────────

const FRED_CACHE_MINUTES = 360; // 6 hours — economic data updates infrequently

function ensureCacheTable(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS market_data_cache (
      cache_key   TEXT PRIMARY KEY,
      data        TEXT NOT NULL,
      expires_at  TEXT NOT NULL
    )
  `);
}

function getCached<T>(key: string): T | null {
  try {
    const db = getDb();
    const row = db.prepare(
      "SELECT data FROM market_data_cache WHERE cache_key = ? AND expires_at > datetime('now')"
    ).get(key) as any;
    if (row) return JSON.parse(row.data) as T;
  } catch { /* miss */ }
  return null;
}

function setCache(key: string, data: unknown, ttlMinutes: number): void {
  try {
    const db = getDb();
    db.prepare(`
      INSERT OR REPLACE INTO market_data_cache (cache_key, data, expires_at)
      VALUES (?, ?, datetime('now', '+' || ? || ' minutes'))
    `).run(key, JSON.stringify(data), ttlMinutes);
  } catch { /* ignore */ }
}

// ─── FRED API ───────────────────────────────────────────────────

const FRED_BASE = 'https://api.stlouisfed.org/fred/series/observations';

/**
 * Fetch recent observations for a FRED series.
 * Returns the last `count` observations sorted newest-first.
 */
async function fetchSeries(
  seriesId: string,
  count: number = 6,
): Promise<FredSeriesObservation[]> {
  const apiKey = process.env.FRED_API_KEY;
  if (!apiKey) return [];

  const cacheKey = `fred:${seriesId}:${count}`;
  const cached = getCached<FredSeriesObservation[]>(cacheKey);
  if (cached) return cached;

  try {
    const resp = await axios.get(FRED_BASE, {
      params: {
        series_id: seriesId,
        api_key: apiKey,
        file_type: 'json',
        sort_order: 'desc',
        limit: count,
      },
      timeout: 10_000,
    });

    const observations: FredSeriesObservation[] = (resp.data?.observations || [])
      .filter((o: any) => o.value !== '.' && !isNaN(parseFloat(o.value)))
      .map((o: any) => ({
        date: o.date,
        value: parseFloat(o.value),
      }));

    if (observations.length > 0) {
      setCache(cacheKey, observations, FRED_CACHE_MINUTES);
    }

    return observations;
  } catch (err: any) {
    console.warn(`[FRED] Failed to fetch ${seriesId}: ${err.message}`);
    return [];
  }
}

/**
 * Determine trend direction from a series of observations (newest first).
 */
function detectTrend(observations: FredSeriesObservation[], thresholdPct: number = 0.5): 'rising' | 'falling' | 'stable' | null {
  if (observations.length < 2) return null;

  const newest = observations[0].value;
  const older = observations[Math.min(2, observations.length - 1)].value;

  if (older === 0) return null;
  const changePct = ((newest - older) / Math.abs(older)) * 100;

  if (changePct > thresholdPct) return 'rising';
  if (changePct < -thresholdPct) return 'falling';
  return 'stable';
}

// ─── Main Export ────────────────────────────────────────────────

/**
 * Fetch all macroeconomic indicators from FRED.
 * Gracefully handles missing API key and individual series failures.
 */
export async function fetchMacroIndicators(): Promise<MacroIndicators> {
  ensureCacheTable();

  const masterCacheKey = 'fred:macro_indicators';
  const cached = getCached<MacroIndicators>(masterCacheKey);
  if (cached) return cached;

  const apiKey = process.env.FRED_API_KEY;
  if (!apiKey) {
    console.warn('[FRED] No FRED_API_KEY configured — macro indicators unavailable. Get a free key at https://fred.stlouisfed.org/docs/api/api_key.html');
    return emptyIndicators();
  }

  // Fetch all series in parallel
  const [cpiObs, unempObs, gdpObs, pmiObs, fedObs, yieldObs, claimsObs] = await Promise.all([
    fetchSeries(FRED_SERIES.CPI_YOY, 6),
    fetchSeries(FRED_SERIES.UNEMPLOYMENT, 6),
    fetchSeries(FRED_SERIES.GDP_GROWTH, 4),
    fetchSeries(PMI_SERIES, 4),
    fetchSeries(FRED_SERIES.FED_FUNDS, 4),
    fetchSeries(FRED_SERIES.T10Y2Y, 10),
    fetchSeries(FRED_SERIES.INITIAL_CLAIMS, 8),
  ]);

  let indicatorsLoaded = 0;
  const dates: string[] = [];

  // CPI: compute YoY change from 12-month-apart readings if we have enough,
  // otherwise use the latest value as a proxy for the annual CPI level
  let cpiYoY: number | null = null;
  let cpiTrend: MacroIndicators['cpiTrend'] = null;
  if (cpiObs.length >= 2) {
    // CPI index values — compute month-over-month annualized, or just use last value as approximation
    cpiYoY = cpiObs[0].value; // The CPIAUCSL series itself is an index; we need the change
    // Simple approximation: compare most recent to 12 months prior if available
    if (cpiObs.length >= 6) {
      const recent = cpiObs[0].value;
      const older = cpiObs[5].value; // ~6 months ago
      cpiYoY = older > 0 ? ((recent - older) / older) * 200 : null; // annualized from 6-month
    }
    cpiTrend = detectTrend(cpiObs, 0.3);
    indicatorsLoaded++;
    dates.push(cpiObs[0].date);
  }

  // Unemployment
  let unemploymentRate: number | null = null;
  let unemploymentTrend: MacroIndicators['unemploymentTrend'] = null;
  if (unempObs.length > 0) {
    unemploymentRate = unempObs[0].value;
    unemploymentTrend = detectTrend(unempObs, 0.2);
    indicatorsLoaded++;
    dates.push(unempObs[0].date);
  }

  // GDP Growth
  let gdpGrowth: number | null = null;
  if (gdpObs.length > 0) {
    gdpGrowth = gdpObs[0].value;
    indicatorsLoaded++;
    dates.push(gdpObs[0].date);
  }

  // PMI
  let pmi: number | null = null;
  if (pmiObs.length > 0) {
    pmi = pmiObs[0].value;
    indicatorsLoaded++;
    dates.push(pmiObs[0].date);
  }

  // Fed Funds Rate
  let fedFundsRate: number | null = null;
  if (fedObs.length > 0) {
    fedFundsRate = fedObs[0].value;
    indicatorsLoaded++;
    dates.push(fedObs[0].date);
  }

  // Yield Curve (10Y-2Y spread)
  let yieldCurveSpread: number | null = null;
  let yieldCurveInverted = false;
  if (yieldObs.length > 0) {
    yieldCurveSpread = yieldObs[0].value;
    yieldCurveInverted = yieldCurveSpread < 0;
    indicatorsLoaded++;
    dates.push(yieldObs[0].date);
  }

  // Initial Claims
  let initialClaims: number | null = null;
  let claimsTrend: MacroIndicators['claimsTrend'] = null;
  if (claimsObs.length > 0) {
    initialClaims = claimsObs[0].value;
    claimsTrend = detectTrend(claimsObs, 3);
    indicatorsLoaded++;
    dates.push(claimsObs[0].date);
  }

  const dataAsOf = dates.length > 0 ? dates.sort()[0] : null;

  const result: MacroIndicators = {
    cpiYoY,
    cpiTrend,
    unemploymentRate,
    unemploymentTrend,
    gdpGrowth,
    pmi,
    fedFundsRate,
    yieldCurveSpread,
    yieldCurveInverted,
    initialClaims,
    claimsTrend,
    dataAsOf,
    indicatorsLoaded,
  };

  if (indicatorsLoaded > 0) {
    setCache(masterCacheKey, result, FRED_CACHE_MINUTES);
  }

  console.log(`[FRED] Loaded ${indicatorsLoaded}/7 macro indicators (as of ${dataAsOf})`);
  return result;
}

/**
 * Classify the current macro regime based on FRED indicators.
 */
export function classifyMacroRegime(indicators: MacroIndicators): RegimeClassification {
  if (indicators.indicatorsLoaded === 0) {
    return {
      regime: 'growth',
      confidence: 0.1,
      reasoning: 'No macro data available — defaulting to neutral growth assumption.',
      indicators,
    };
  }

  let growthSignals = 0;
  let slowdownSignals = 0;
  let recessionSignals = 0;
  let inflationSignals = 0;
  const reasons: string[] = [];

  // Yield curve — strongest recession predictor
  if (indicators.yieldCurveInverted) {
    recessionSignals += 2;
    reasons.push('Yield curve inverted (strong recession signal)');
  } else if (indicators.yieldCurveSpread !== null && indicators.yieldCurveSpread < 0.5) {
    slowdownSignals += 1;
    reasons.push('Yield curve flattening');
  } else if (indicators.yieldCurveSpread !== null) {
    growthSignals += 1;
    reasons.push('Healthy yield curve spread');
  }

  // GDP Growth
  if (indicators.gdpGrowth !== null) {
    if (indicators.gdpGrowth > 2.5) {
      growthSignals += 2;
      reasons.push(`Strong GDP growth: ${indicators.gdpGrowth.toFixed(1)}%`);
    } else if (indicators.gdpGrowth > 0) {
      growthSignals += 1;
      reasons.push(`Moderate GDP growth: ${indicators.gdpGrowth.toFixed(1)}%`);
    } else {
      recessionSignals += 2;
      reasons.push(`GDP contracting: ${indicators.gdpGrowth.toFixed(1)}%`);
    }
  }

  // Unemployment
  if (indicators.unemploymentRate !== null) {
    if (indicators.unemploymentRate < 4.5) {
      growthSignals += 1;
      reasons.push(`Low unemployment: ${indicators.unemploymentRate.toFixed(1)}%`);
    } else if (indicators.unemploymentRate > 6) {
      recessionSignals += 1;
      reasons.push(`High unemployment: ${indicators.unemploymentRate.toFixed(1)}%`);
    }
    if (indicators.unemploymentTrend === 'rising') {
      slowdownSignals += 1;
      reasons.push('Unemployment rising');
    }
  }

  // PMI
  if (indicators.pmi !== null) {
    if (indicators.pmi > 55) {
      growthSignals += 1;
      reasons.push(`Strong manufacturing PMI: ${indicators.pmi.toFixed(1)}`);
    } else if (indicators.pmi < 50) {
      slowdownSignals += 1;
      reasons.push(`Contracting PMI: ${indicators.pmi.toFixed(1)}`);
    }
  }

  // Inflation (CPI)
  if (indicators.cpiYoY !== null) {
    if (indicators.cpiYoY > 5) {
      inflationSignals += 2;
      reasons.push(`High inflation: ${indicators.cpiYoY.toFixed(1)}%`);
    } else if (indicators.cpiYoY > 3) {
      inflationSignals += 1;
      reasons.push(`Elevated inflation: ${indicators.cpiYoY.toFixed(1)}%`);
    } else if (indicators.cpiYoY < 1.5) {
      reasons.push(`Low inflation: ${indicators.cpiYoY.toFixed(1)}%`);
    }
  }

  // Claims trend
  if (indicators.claimsTrend === 'rising') {
    slowdownSignals += 1;
    reasons.push('Jobless claims rising');
  } else if (indicators.claimsTrend === 'falling') {
    growthSignals += 1;
    reasons.push('Jobless claims falling');
  }

  // Classify regime
  let regime: MacroRegime;
  if (recessionSignals >= 3 || (recessionSignals >= 2 && slowdownSignals >= 2)) {
    regime = 'recession';
  } else if (inflationSignals >= 2 && slowdownSignals >= 1) {
    regime = 'stagflation';
  } else if (slowdownSignals >= 3 || (slowdownSignals >= 2 && growthSignals < 2)) {
    regime = 'slowdown';
  } else if (growthSignals >= 3 && recessionSignals === 0) {
    regime = 'growth';
  } else if (growthSignals >= 2 && recessionSignals >= 1) {
    regime = 'recovery';
  } else {
    regime = growthSignals >= slowdownSignals ? 'growth' : 'slowdown';
  }

  // Confidence scales with data availability and signal clarity
  const totalSignals = growthSignals + slowdownSignals + recessionSignals + inflationSignals;
  const dominantSignal = Math.max(growthSignals, slowdownSignals, recessionSignals, inflationSignals);
  const clarity = totalSignals > 0 ? dominantSignal / totalSignals : 0;
  const dataScore = indicators.indicatorsLoaded / 7;
  const confidence = Math.round(Math.min(0.95, clarity * 0.5 + dataScore * 0.5) * 100) / 100;

  return {
    regime,
    confidence,
    reasoning: reasons.join('. ') + '.',
    indicators,
  };
}

function emptyIndicators(): MacroIndicators {
  return {
    cpiYoY: null,
    cpiTrend: null,
    unemploymentRate: null,
    unemploymentTrend: null,
    gdpGrowth: null,
    pmi: null,
    fedFundsRate: null,
    yieldCurveSpread: null,
    yieldCurveInverted: false,
    initialClaims: null,
    claimsTrend: null,
    dataAsOf: null,
    indicatorsLoaded: 0,
  };
}
