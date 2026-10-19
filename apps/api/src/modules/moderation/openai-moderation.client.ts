import { Injectable, Logger } from '@nestjs/common';
import { loadEnv } from '../../config/env';

export interface AiModerationVerdict {
  flagged: boolean;
  /** OpenAI category names that were flagged, e.g. "violence", "illicit". */
  categories: string[];
}

interface OpenAiModerationResponse {
  results?: { flagged?: boolean; categories?: Record<string, boolean> }[];
}

const TIMEOUT_MS = 5_000;

/**
 * The OpenAI Moderation API (`POST /v1/moderations`), used as a second opinion
 * after the keyword rules. Only called when OPENAI_API_KEY is set.
 *
 * Fails open: a timeout, an outage or a rejected key returns null and the
 * task is judged by the keyword rules alone, with a warning logged. Failing
 * closed would let a third-party incident stop every requester from posting,
 * and the rules, the appeal queue and user reports remain in place either
 * way. See docs/12-trust-safety.md.
 */
@Injectable()
export class OpenAiModerationClient {
  private readonly logger = new Logger(OpenAiModerationClient.name);

  get isEnabled(): boolean {
    return Boolean(loadEnv().OPENAI_API_KEY);
  }

  async classify(text: string): Promise<AiModerationVerdict | null> {
    const env = loadEnv();
    if (!env.OPENAI_API_KEY) return null;

    try {
      const res = await fetch('https://api.openai.com/v1/moderations', {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: env.OPENAI_MODERATION_MODEL, input: text }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) {
        this.logger.warn(`OpenAI moderation returned ${res.status}; falling back to keyword rules only.`);
        return null;
      }
      const body = (await res.json()) as OpenAiModerationResponse;
      const result = body.results?.[0];
      if (!result) return null;
      const categories = Object.entries(result.categories ?? {})
        .filter(([, hit]) => hit)
        .map(([name]) => name);
      return { flagged: result.flagged === true, categories };
    } catch (error) {
      this.logger.warn(`OpenAI moderation unavailable (${String(error)}); falling back to keyword rules only.`);
      return null;
    }
  }
}

/** Plain-language reasons for OpenAI's category names, for the message the user sees. */
export function describeAiCategories(categories: string[]): string {
  const labels = new Set<string>();
  for (const c of categories) {
    if (c.startsWith('sexual/minors')) labels.add('sexual content involving minors');
    else if (c.startsWith('sexual')) labels.add('sexual content');
    else if (c.startsWith('self-harm')) labels.add('self-harm');
    else if (c.startsWith('illicit')) labels.add('illegal activity');
    else if (c.startsWith('harassment')) labels.add('harassment or threats');
    else if (c.startsWith('hate')) labels.add('hateful content');
    else if (c.startsWith('violence')) labels.add('violence');
  }
  return labels.size > 0 ? [...labels].join(', ') : 'content that breaks our rules';
}
