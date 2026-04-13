/**
 * LLM-powered reasoning engine for APEX.
 *
 * Sits between signal analysis and trade decisions. Takes all raw signals,
 * market data, and news context — produces a qualitative assessment with
 * a written rationale that reads like an analyst note.
 *
 * Gracefully degrades to rule-based rationale when no LLM is configured.
 */
import { chatCompletion, isLLMAvailable, getLLMConfig } from './provider';
import type { MarketData, AggregateSignalResult } from '../signals';

// ─── Types ──────────────────────────────────────────────────────

export interface ReasoningResult {
  /** LLM-generated qualitative assessment (or rule-based fallback) */
  qualitativeAssessment: string;
  /** Whether the LLM agreed, disagreed, or nuanced the signal-based recommendation */
  llmVerdict: 'agree' | 'disagree' | 'nuanced' | 'unavailable';
  /** LLM's own conviction: -1 (strong sell) to +1 (strong buy) */
  llmConviction: number;
  /** Key risks identified by the LLM */
  keyRisks: string[];
  /** Key catalysts identified by the LLM */
  keyCatalysts: string[];
  /** Whether LLM was actually used */
  llmUsed: boolean;
  /** Tokens consumed (0 if LLM not used) */
  tokensUsed: number;
}

// ─── System prompt ──────────────────────────────────────────────

const SYSTEM_PROMPT = `You are APEX, an autonomous stock-picking analyst. You receive quantitative signal data and market context for a stock, and must produce a qualitative assessment.

Your job:
1. INTERPRET the quantitative signals — what story do they tell together?
2. IDENTIFY risks and catalysts the numbers alone don't capture
3. ASSESS whether the quantitative recommendation makes sense given the full picture
4. PROVIDE a conviction score from -1.0 (strong sell) to +1.0 (strong buy)

Respond ONLY in valid JSON with this exact structure:
{
  "assessment": "2-4 sentence analyst-quality assessment of this stock right now",
  "verdict": "agree" | "disagree" | "nuanced",
  "conviction": <number between -1.0 and 1.0>,
  "risks": ["risk 1", "risk 2"],
  "catalysts": ["catalyst 1", "catalyst 2"]
}

Rules:
- Be concise and specific. No generic platitudes.
- If data is thin, say so and lower conviction toward 0.
- "nuanced" means you partly agree but see material factors the signals miss.
- conviction of 0 = no view, ±0.3 = mild, ±0.6 = moderate, ±1.0 = extreme conviction.`;

// ─── Build user prompt from signal + market data ────────────────

function buildUserPrompt(
  symbol: string,
  stockName: string,
  market: string,
  aggregate: AggregateSignalResult,
  marketData: MarketData,
): string {
  const parts: string[] = [];

  parts.push(`## Stock: ${symbol} (${stockName}) — Market: ${market}`);
  parts.push('');

  // Quantitative signals summary
  parts.push('### Signal Analysis Results');
  parts.push(`Overall Score: ${aggregate.overallScore}/100 → ${aggregate.recommendation}`);
  parts.push(`Confidence: ${(aggregate.overallConfidence * 100).toFixed(1)}%`);
  parts.push(`Direction: ${aggregate.direction}`);
  parts.push('');

  for (const sig of aggregate.signals) {
    parts.push(`- **${sig.source}**: ${sig.score}/100 (${sig.direction}, confidence ${(sig.confidence * 100).toFixed(0)}%) — ${sig.reasoning}`);
  }
  parts.push('');

  // Price data
  parts.push('### Price Data');
  if (marketData.currentPrice) parts.push(`Current Price: $${marketData.currentPrice.toFixed(2)}`);
  if (marketData.week52High && marketData.week52Low) {
    const pos52w = marketData.currentPrice
      ? ((marketData.currentPrice - marketData.week52Low) / (marketData.week52High - marketData.week52Low) * 100).toFixed(1)
      : 'N/A';
    parts.push(`52-Week Range: $${marketData.week52Low.toFixed(2)} — $${marketData.week52High.toFixed(2)} (currently at ${pos52w}%)`);
  }
  if (marketData.sma50) parts.push(`SMA-50: $${marketData.sma50.toFixed(2)}`);
  if (marketData.sma200) parts.push(`SMA-200: $${marketData.sma200.toFixed(2)}`);
  parts.push('');

  // Fundamentals
  parts.push('### Fundamentals');
  if (marketData.peRatio != null) parts.push(`P/E Ratio: ${marketData.peRatio.toFixed(2)}`);
  if (marketData.pbRatio != null) parts.push(`P/B Ratio: ${marketData.pbRatio.toFixed(2)}`);
  if (marketData.dividendYield != null) parts.push(`Dividend Yield: ${(marketData.dividendYield * 100).toFixed(2)}%`);
  if (marketData.eps != null) parts.push(`EPS: $${marketData.eps.toFixed(2)}`);
  if (marketData.marketCap != null) parts.push(`Market Cap: $${formatLargeNumber(marketData.marketCap)}`);
  if (marketData.revenueGrowth != null) parts.push(`Revenue Growth: ${(marketData.revenueGrowth * 100).toFixed(1)}%`);
  if (marketData.profitMargin != null) parts.push(`Profit Margin: ${(marketData.profitMargin * 100).toFixed(1)}%`);
  parts.push('');

  // Recent news
  if (marketData.newsArticles && marketData.newsArticles.length > 0) {
    parts.push('### Recent News Headlines');
    for (const article of marketData.newsArticles.slice(0, 8)) {
      const sentLabel = article.sentiment > 0.2 ? '📈' : article.sentiment < -0.2 ? '📉' : '➖';
      parts.push(`- ${sentLabel} "${article.headline}" (${article.source}, ${article.publishedAt})`);
    }
    parts.push('');
  }

  // Search interest
  if (marketData.searchTrend) {
    parts.push('### Search Interest (Google Trends)');
    parts.push(`Trend: ${marketData.searchTrend.trend} (${marketData.searchTrend.changePercent > 0 ? '+' : ''}${marketData.searchTrend.changePercent.toFixed(1)}%)`);
    parts.push(`Current Interest: ${marketData.searchTrend.currentInterest}/100`);
    parts.push('');
  }

  parts.push('### Your Task');
  parts.push(`The quantitative system recommends: **${aggregate.recommendation}**. Assess whether this is correct given all the context above.`);

  return parts.join('\n');
}

function formatLargeNumber(n: number): string {
  if (n >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  return n.toLocaleString();
}

// ─── Parse LLM response ────────────────────────────────────────

function parseLLMResponse(raw: string): Partial<{
  assessment: string;
  verdict: 'agree' | 'disagree' | 'nuanced';
  conviction: number;
  risks: string[];
  catalysts: string[];
}> {
  try {
    // Extract JSON from potential markdown code blocks
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return {};
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      assessment: typeof parsed.assessment === 'string' ? parsed.assessment : undefined,
      verdict: ['agree', 'disagree', 'nuanced'].includes(parsed.verdict) ? parsed.verdict : undefined,
      conviction: typeof parsed.conviction === 'number' ? Math.max(-1, Math.min(1, parsed.conviction)) : undefined,
      risks: Array.isArray(parsed.risks) ? parsed.risks.filter((r: any) => typeof r === 'string') : undefined,
      catalysts: Array.isArray(parsed.catalysts) ? parsed.catalysts.filter((c: any) => typeof c === 'string') : undefined,
    };
  } catch {
    return {};
  }
}

// ─── Fallback rule-based rationale ──────────────────────────────

function buildFallbackResult(aggregate: AggregateSignalResult): ReasoningResult {
  const risks: string[] = [];
  const catalysts: string[] = [];

  for (const sig of aggregate.signals) {
    if (sig.direction === 'bearish' && sig.confidence > 0.5) {
      risks.push(`${sig.source} signals are bearish (${sig.score}/100)`);
    }
    if (sig.direction === 'bullish' && sig.confidence > 0.5) {
      catalysts.push(`${sig.source} signals are bullish (${sig.score}/100)`);
    }
  }

  return {
    qualitativeAssessment: aggregate.rationale,
    llmVerdict: 'unavailable',
    llmConviction: aggregate.compositeScore,
    keyRisks: risks.length > 0 ? risks : ['No LLM available — relying on quantitative signals only'],
    keyCatalysts: catalysts.length > 0 ? catalysts : ['Quantitative signals drive this recommendation'],
    llmUsed: false,
    tokensUsed: 0,
  };
}

// ─── Main export ────────────────────────────────────────────────

/**
 * Run LLM-powered qualitative reasoning on a stock analysis.
 * Falls back to rule-based rationale if no LLM provider is configured.
 */
export async function analyzeWithReasoning(
  symbol: string,
  stockName: string,
  market: string,
  aggregate: AggregateSignalResult,
  marketData: MarketData,
): Promise<ReasoningResult> {
  if (!isLLMAvailable()) {
    return buildFallbackResult(aggregate);
  }

  const userPrompt = buildUserPrompt(symbol, stockName, market, aggregate, marketData);
  const response = await chatCompletion(SYSTEM_PROMPT, userPrompt);

  if (!response) {
    console.warn(`[Reasoning] LLM call returned null for ${symbol}, using fallback`);
    return buildFallbackResult(aggregate);
  }

  const parsed = parseLLMResponse(response.content);

  return {
    qualitativeAssessment: parsed.assessment || aggregate.rationale,
    llmVerdict: parsed.verdict || 'unavailable',
    llmConviction: parsed.conviction ?? aggregate.compositeScore,
    keyRisks: parsed.risks || [],
    keyCatalysts: parsed.catalysts || [],
    llmUsed: true,
    tokensUsed: response.tokensUsed,
  };
}

/**
 * Generate an enhanced trade rationale combining quantitative + qualitative analysis.
 */
export function buildEnhancedRationale(
  baseRationale: string,
  reasoning: ReasoningResult,
): string {
  if (!reasoning.llmUsed) return baseRationale;

  const parts = [baseRationale];

  if (reasoning.llmVerdict !== 'unavailable') {
    parts.push(`\n\n🧠 AI Assessment (${reasoning.llmVerdict}): ${reasoning.qualitativeAssessment}`);
  }
  if (reasoning.keyRisks.length > 0) {
    parts.push(`\n⚠️ Risks: ${reasoning.keyRisks.join('; ')}`);
  }
  if (reasoning.keyCatalysts.length > 0) {
    parts.push(`\n🚀 Catalysts: ${reasoning.keyCatalysts.join('; ')}`);
  }

  return parts.join('');
}

/** Get current LLM status for the system status endpoint. */
export function getLLMStatus(): { available: boolean; provider: string; model: string } {
  const cfg = getLLMConfig();
  return {
    available: cfg.provider !== 'none',
    provider: cfg.provider,
    model: cfg.model,
  };
}
