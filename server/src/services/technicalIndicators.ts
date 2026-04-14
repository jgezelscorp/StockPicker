// ─── Technical Indicator Calculations ────────────────────────────
// Pure functions — no side effects, no DB access.

// ─── Point Values (latest snapshot) ─────────────────────────────

/**
 * Simple Moving Average over the last `period` values.
 */
export function calcSMA(prices: number[], period: number): number | null {
  if (prices.length < period || period <= 0) return null;
  const slice = prices.slice(-period);
  return slice.reduce((s, v) => s + v, 0) / period;
}

/**
 * Exponential Moving Average.
 * Uses the standard multiplier k = 2 / (period + 1).
 */
export function calcEMA(prices: number[], period: number): number | null {
  if (prices.length < period || period <= 0) return null;
  const k = 2 / (period + 1);
  // Seed with SMA of first `period` values
  let ema = prices.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = period; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
  }
  return ema;
}

/**
 * Relative Strength Index (Wilder smoothing).
 */
export function calcRSI(prices: number[], period: number = 14): number | null {
  if (prices.length < period + 1) return null;

  const changes: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    changes.push(prices[i] - prices[i - 1]);
  }

  // First average gain/loss over initial window
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 0; i < period; i++) {
    if (changes[i] > 0) avgGain += changes[i];
    else avgLoss += Math.abs(changes[i]);
  }
  avgGain /= period;
  avgLoss /= period;

  // Wilder smoothing for remaining values
  for (let i = period; i < changes.length; i++) {
    const change = changes[i];
    avgGain = (avgGain * (period - 1) + (change > 0 ? change : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (change < 0 ? Math.abs(change) : 0)) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/**
 * MACD (12, 26, 9) — returns latest snapshot.
 */
export function calcMACD(prices: number[]): { macd: number; signal: number; histogram: number } | null {
  if (prices.length < 35) return null; // need 26 + 9 minimum

  const ema12All = calcEMASeries_raw(prices, 12);
  const ema26All = calcEMASeries_raw(prices, 26);

  // MACD line = EMA12 – EMA26 (from index 25 onward where both exist)
  const macdLine: number[] = [];
  const startIdx = 25; // 0-indexed: first valid EMA26
  for (let i = startIdx; i < prices.length; i++) {
    macdLine.push(ema12All[i] - ema26All[i]);
  }

  if (macdLine.length < 9) return null;

  // Signal = 9-period EMA of MACD line
  const signalAll = calcEMASeries_raw(macdLine, 9);
  const last = macdLine.length - 1;
  const macd = macdLine[last];
  const signal = signalAll[last];
  return { macd, signal, histogram: macd - signal };
}

/**
 * Bollinger Bands (period-SMA ± 2 std devs).
 */
export function calcBollinger(
  prices: number[],
  period: number = 20,
): { upper: number; middle: number; lower: number } | null {
  if (prices.length < period || period <= 0) return null;
  const slice = prices.slice(-period);
  const middle = slice.reduce((s, v) => s + v, 0) / period;
  const variance = slice.reduce((s, v) => s + (v - middle) ** 2, 0) / period;
  const stdDev = Math.sqrt(variance);
  return { upper: middle + 2 * stdDev, middle, lower: middle - 2 * stdDev };
}

/**
 * Average True Range (ATR).
 */
export function calcATR(
  highs: number[],
  lows: number[],
  closes: number[],
  period: number = 14,
): number | null {
  const n = highs.length;
  if (n < period + 1 || lows.length < n || closes.length < n) return null;

  const trueRanges: number[] = [];
  for (let i = 1; i < n; i++) {
    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1]),
    );
    trueRanges.push(tr);
  }

  // Wilder smoothing
  let atr = trueRanges.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = period; i < trueRanges.length; i++) {
    atr = (atr * (period - 1) + trueRanges[i]) / period;
  }
  return atr;
}

// ─── Series (arrays for chart overlays) ─────────────────────────

export function calcSMASeries(
  prices: number[],
  dates: string[],
  period: number,
): { date: string; value: number }[] {
  const result: { date: string; value: number }[] = [];
  if (prices.length < period) return result;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += prices[i];
  result.push({ date: dates[period - 1], value: sum / period });
  for (let i = period; i < prices.length; i++) {
    sum += prices[i] - prices[i - period];
    result.push({ date: dates[i], value: sum / period });
  }
  return result;
}

export function calcEMASeries(
  prices: number[],
  dates: string[],
  period: number,
): { date: string; value: number }[] {
  const result: { date: string; value: number }[] = [];
  if (prices.length < period) return result;
  const k = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((s, v) => s + v, 0) / period;
  result.push({ date: dates[period - 1], value: ema });
  for (let i = period; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
    result.push({ date: dates[i], value: ema });
  }
  return result;
}

export function calcBollingerSeries(
  prices: number[],
  dates: string[],
  period: number = 20,
): { upper: { date: string; value: number }[]; lower: { date: string; value: number }[] } {
  const upper: { date: string; value: number }[] = [];
  const lower: { date: string; value: number }[] = [];
  if (prices.length < period) return { upper, lower };
  for (let i = period - 1; i < prices.length; i++) {
    const slice = prices.slice(i - period + 1, i + 1);
    const mean = slice.reduce((s, v) => s + v, 0) / period;
    const variance = slice.reduce((s, v) => s + (v - mean) ** 2, 0) / period;
    const stdDev = Math.sqrt(variance);
    upper.push({ date: dates[i], value: mean + 2 * stdDev });
    lower.push({ date: dates[i], value: mean - 2 * stdDev });
  }
  return { upper, lower };
}

export function calcRSISeries(
  prices: number[],
  dates: string[],
  period: number = 14,
): { date: string; value: number }[] {
  const result: { date: string; value: number }[] = [];
  if (prices.length < period + 1) return result;

  const changes: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    changes.push(prices[i] - prices[i - 1]);
  }

  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 0; i < period; i++) {
    if (changes[i] > 0) avgGain += changes[i];
    else avgLoss += Math.abs(changes[i]);
  }
  avgGain /= period;
  avgLoss /= period;

  const rsi = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  // changes index `period - 1` corresponds to prices index `period`
  result.push({ date: dates[period], value: rsi });

  for (let i = period; i < changes.length; i++) {
    const change = changes[i];
    avgGain = (avgGain * (period - 1) + (change > 0 ? change : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (change < 0 ? Math.abs(change) : 0)) / period;
    const val = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    result.push({ date: dates[i + 1], value: val });
  }
  return result;
}

export function calcMACDSeries(
  prices: number[],
  dates: string[],
): {
  macd_line: { date: string; value: number }[];
  macd_signal: { date: string; value: number }[];
  macd_histogram: { date: string; value: number }[];
} {
  const empty = { macd_line: [] as any[], macd_signal: [] as any[], macd_histogram: [] as any[] };
  if (prices.length < 35) return empty;

  const ema12All = calcEMASeries_raw(prices, 12);
  const ema26All = calcEMASeries_raw(prices, 26);

  const macdLine: number[] = [];
  const macdDates: string[] = [];
  const startIdx = 25;
  for (let i = startIdx; i < prices.length; i++) {
    macdLine.push(ema12All[i] - ema26All[i]);
    macdDates.push(dates[i]);
  }

  if (macdLine.length < 9) return empty;

  const signalAll = calcEMASeries_raw(macdLine, 9);

  // Signal line starts at index 8 of macdLine
  const result_macd: { date: string; value: number }[] = [];
  const result_signal: { date: string; value: number }[] = [];
  const result_hist: { date: string; value: number }[] = [];

  for (let i = 8; i < macdLine.length; i++) {
    result_macd.push({ date: macdDates[i], value: macdLine[i] });
    result_signal.push({ date: macdDates[i], value: signalAll[i] });
    result_hist.push({ date: macdDates[i], value: macdLine[i] - signalAll[i] });
  }

  return { macd_line: result_macd, macd_signal: result_signal, macd_histogram: result_hist };
}

// ─── Internal helper: raw EMA series as plain number array ──────

function calcEMASeries_raw(prices: number[], period: number): number[] {
  const result: number[] = new Array(prices.length).fill(0);
  if (prices.length < period) return result;
  let ema = prices.slice(0, period).reduce((s, v) => s + v, 0) / period;
  // Fill initial entries with 0 (not usable)
  result[period - 1] = ema;
  for (let i = period; i < prices.length; i++) {
    const k = 2 / (period + 1);
    ema = prices[i] * k + ema * (1 - k);
    result[i] = ema;
  }
  return result;
}
