import { Injectable } from '@nestjs/common';
import { BusinessRuleError } from '../../common/errors';

/**
 * Prohibited-content screening and risk scoring, per
 * docs/12-trust-safety.md.
 *
 * Two distinct things, deliberately not conflated:
 *
 *  - Prohibited content is a hard line. A match blocks creation outright,
 *    because these are not judgment calls: illegal activity, weapons,
 *    purchasing on the requester's behalf, and so on are excluded from the
 *    launch scope entirely, not merely risky.
 *
 *  - Risk scoring (LOW / MEDIUM / HIGH) is a matter of degree. Screening
 *    "escalates to manual review rather than silent rejection" — a HIGH
 *    score does not reject the task, it holds it at publication until an
 *    admin clears it. There is no admin review queue yet (Phase 9), so a
 *    HIGH-risk task simply cannot publish until that exists — an honest
 *    limitation, not a workaround, and it errs toward the safe side.
 *
 * The keyword lists here are a starting heuristic, not a claim of
 * sophistication. A determined bad actor can phrase around them; they are a
 * first filter, with human review and reporting as the real backstop, exactly
 * as the security doc describes.
 */
@Injectable()
export class RiskService {
  private readonly prohibitedPatterns: { pattern: RegExp; reason: string }[] = [
    { pattern: /\b(gun|firearm|pistol|rifle|ammunition|explosive|weapon)\b/i, reason: 'weapons' },
    {
      pattern: /\b(drugs?|narcotics?|cocaine|heroin|methamphetamine)\b/i,
      reason: 'controlled substances',
    },
    {
      pattern: /\b(launder(ing)?|smuggl(e|ing)|counterfeit|forge[dry]*)\b/i,
      reason: 'financial fraud',
    },
    {
      pattern: /\b(impersonat(e|ing|ion)|pretend to be|pose as (a |an )?(officer|police|official))\b/i,
      reason: 'impersonation',
    },
    {
      pattern: /\b(hack(ing)?|unauthoriz(ed|e) access|break ?in|bypass security)\b/i,
      reason: 'unauthorized access',
    },
    // The MVP scope explicitly excludes purchasing on the requester's behalf
    // and any task where the worker fronts money. See docs/01, "do NOT
    // purchase it" in the founding example. The gap between the verb and
    // "for me" is bounded rather than matched greedily, so this catches
    // natural phrasing like "buy this laptop for me" without scanning across
    // an entire unrelated paragraph for a coincidental "for me" later on.
    {
      pattern: /\b(buy|purchase|pay for)\b[\s\S]{0,40}\b(for me|on my behalf)\b/i,
      reason: 'purchasing on the requester\'s behalf is out of scope at launch',
    },
    {
      pattern: /\b(advance|front)\s+(me\s+)?(the\s+)?(cash|money|payment)\b/i,
      reason: 'a worker fronting money is out of scope at launch',
    },
  ];

  /** Borderline signals that raise risk without being an outright block. */
  private readonly riskKeywords: { pattern: RegExp; flag: string }[] = [
    { pattern: /\bcash\b/i, flag: 'mentions_cash' },
    { pattern: /\b(private residence|my home|isolated|secluded|no one around)\b/i, flag: 'isolated_or_private_location' },
    { pattern: /\burgent(ly)?\b.*\btransfer\b/i, flag: 'urgent_transfer_language' },
    { pattern: /\bdo not tell\b|\bdon'?t (tell|inform|call)\b/i, flag: 'secrecy_request' },
  ];

  /** Throws if the task content matches a hard prohibition. */
  assertNotProhibited(title: string, description: string): void {
    const text = `${title}\n${description}`;
    for (const { pattern, reason } of this.prohibitedPatterns) {
      if (pattern.test(text)) {
        throw new BusinessRuleError(
          `This task cannot be created: ${reason}. See docs/12-trust-safety.md for the full list of prohibited categories.`,
        );
      }
    }
  }

  /**
   * Scores risk from content, value, and timing. Returns the level and the
   * specific flags that produced it, so a human reviewer sees the reasoning
   * rather than a bare label.
   */
  scoreRisk(params: {
    title: string;
    description: string;
    budgetPaise: number;
    deadlineAt: Date;
  }): { level: 'LOW' | 'MEDIUM' | 'HIGH'; flags: string[] } {
    const text = `${params.title}\n${params.description}`;
    const flags: string[] = [];

    for (const { pattern, flag } of this.riskKeywords) {
      if (pattern.test(text)) flags.push(flag);
    }

    // "Tasks between 9 PM and 7 AM at non-commercial locations require
    // review." Location type is not classified yet (needs a places API
    // integration beyond this phase's scope), so time of day alone is used
    // as a conservative proxy.
    const hour = params.deadlineAt.getHours();
    const isLateNight = hour >= 21 || hour < 7;
    if (isLateNight) flags.push('late_night_deadline');

    // A high-value task warrants more scrutiny purely on the money at stake.
    const isHighValue = params.budgetPaise >= 2_000_000; // ₹20,000+
    if (isHighValue) flags.push('high_value');

    let level: 'LOW' | 'MEDIUM' | 'HIGH' = 'LOW';
    const hasIsolationOrSecrecy = flags.some(
      (f) => f === 'isolated_or_private_location' || f === 'secrecy_request',
    );

    if (hasIsolationOrSecrecy || (isLateNight && isHighValue)) {
      level = 'HIGH';
    } else if (flags.length > 0) {
      level = 'MEDIUM';
    }

    return { level, flags };
  }

  /**
   * The verification level required to accept a task, from its value. See
   * docs/12-trust-safety.md's table: ≤₹1,000 → L1, ₹1,000–5,000 → L2, above → L3.
   */
  minVerificationLevelForBudget(budgetPaise: number): 1 | 2 | 3 {
    if (budgetPaise > 500_000) return 3; // above ₹5,000
    if (budgetPaise > 100_000) return 2; // above ₹1,000
    return 1;
  }
}
