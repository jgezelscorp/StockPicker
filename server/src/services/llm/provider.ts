/**
 * LLM Provider Abstraction — supports OpenAI, Azure OpenAI, and Ollama.
 * Configured via environment variables. Returns null when no provider is set,
 * allowing graceful fallback to rule-based reasoning.
 */
import OpenAI from 'openai';

export interface LLMConfig {
  provider: 'openai' | 'azure-openai' | 'ollama' | 'none';
  model: string;
  maxTokens: number;
  temperature: number;
}

export interface LLMResponse {
  content: string;
  model: string;
  tokensUsed: number;
}

let client: OpenAI | null = null;
let config: LLMConfig | null = null;

/**
 * Resolve LLM configuration from environment variables.
 * Priority: AZURE_OPENAI > OPENAI > OLLAMA > none
 */
export function getLLMConfig(): LLMConfig {
  if (config) return config;

  if (process.env.AZURE_OPENAI_API_KEY && process.env.AZURE_OPENAI_ENDPOINT) {
    config = {
      provider: 'azure-openai',
      model: process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-4o-mini',
      maxTokens: 1024,
      temperature: 0.3,
    };
  } else if (process.env.OPENAI_API_KEY) {
    config = {
      provider: 'openai',
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      maxTokens: 1024,
      temperature: 0.3,
    };
  } else if (process.env.OLLAMA_BASE_URL) {
    config = {
      provider: 'ollama',
      model: process.env.OLLAMA_MODEL || 'llama3.1',
      maxTokens: 1024,
      temperature: 0.3,
    };
  } else {
    config = { provider: 'none', model: '', maxTokens: 0, temperature: 0 };
  }

  return config;
}

function getClient(): OpenAI | null {
  if (client) return client;
  const cfg = getLLMConfig();

  if (cfg.provider === 'openai') {
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  } else if (cfg.provider === 'azure-openai') {
    client = new OpenAI({
      apiKey: process.env.AZURE_OPENAI_API_KEY,
      baseURL: `${process.env.AZURE_OPENAI_ENDPOINT}/openai/deployments/${cfg.model}`,
      defaultQuery: { 'api-version': process.env.AZURE_OPENAI_API_VERSION || '2024-06-01' },
      defaultHeaders: { 'api-key': process.env.AZURE_OPENAI_API_KEY! },
    });
  } else if (cfg.provider === 'ollama') {
    client = new OpenAI({
      apiKey: 'ollama',
      baseURL: `${process.env.OLLAMA_BASE_URL}/v1`,
    });
  }
  return client;
}

/**
 * Send a chat completion request to the configured LLM.
 * Returns null if no provider is configured or call fails.
 */
export async function chatCompletion(
  systemPrompt: string,
  userPrompt: string,
): Promise<LLMResponse | null> {
  const cfg = getLLMConfig();
  if (cfg.provider === 'none') return null;

  const openai = getClient();
  if (!openai) return null;

  try {
    const response = await openai.chat.completions.create({
      model: cfg.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: cfg.maxTokens,
      temperature: cfg.temperature,
    });

    const choice = response.choices[0];
    return {
      content: choice?.message?.content || '',
      model: response.model,
      tokensUsed: response.usage?.total_tokens || 0,
    };
  } catch (err: any) {
    console.error(`[LLM] ${cfg.provider} call failed:`, err.message);
    return null;
  }
}

/** Check if an LLM provider is configured and available. */
export function isLLMAvailable(): boolean {
  return getLLMConfig().provider !== 'none';
}

/** Reset cached client/config (useful for testing). */
export function resetLLM(): void {
  client = null;
  config = null;
}
