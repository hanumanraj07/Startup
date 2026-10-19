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
    // "Anything illegal" and "anything endangering the worker" (docs/12) are
    // broad catch-alls the earlier patterns above only cover obliquely —
    // this is the direct case: violence or a threat against a person. Words
    // chosen have essentially no legitimate use in a physical-task
    // description (unlike, say, "shoot" or "attack", both common outside
    // this context — "shoot a video" is a real task type here), so this
    // stays a precise hard block rather than a proximity-matched pattern.
    {
      pattern: /\b(kill|murder|assassinat(e|ion)|kidnap(ping)?|abduct(ion)?|torture)\b/i,
      reason: 'violence or a threat against a person',
    },
    // Watching, following or pressuring a person is the commonest way a
    // "verification" task turns into harm against a third party.
    {
      pattern: /\b(stalk(ing)?|spy(ing)? on|harass(ing|ment)?|blackmail(ing)?|extort(ion|ing)?|intimidat(e|ing|ion)|threaten(ing)?)\b/i,
      reason: 'harassment, stalking or intimidation of a person',
    },
    {
      pattern: /\b(escort service|sexual services?|prostitut(e|ion))\b/i,
      reason: 'sexual services',
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

  /**
   * Non-throwing check, for callers that need to know *why* content was
   * blocked before deciding what else to do about it (audit logging, most
   * immediately) — `assertNotProhibited` below is the throwing wrapper most
   * callers actually want.
   */
  findProhibitedMatch(title: string, description: string): string | undefined {
    // Checked twice: as written, and normalised so "k1ll", "k.i.l.l" and
    // look-alike Unicode cannot step around a pattern. Benign phrases are
    // removed from both first, so "glue gun" or "drug store" never trips the
    // weapons or substances line.
    const raw = stripBenignPhrases(`${title}\n${description}`.normalize('NFKC'));
    const normalised = stripBenignPhrases(normaliseForScreening(`${title}\n${description}`));
    return this.prohibitedPatterns.find(({ pattern }) => pattern.test(raw) || pattern.test(normalised))?.reason;
  }

  /** Throws if the task content matches a hard prohibition. */
  assertNotProhibited(title: string, description: string): void {
    const reason = this.findProhibitedMatch(title, description);
    if (reason) {
      throw new BusinessRuleError(
        `This task cannot be created: ${reason}. See docs/12-trust-safety.md for the full list of prohibited categories.`,
      );
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

/**
 * Phrases that contain a prohibited keyword but describe ordinary, legitimate
 * things a worker might inspect. Removed before matching so the hard block
 * stays precise. Keep this list short and specific: every entry is a hole in
 * the filter, justified only by a real everyday use.
 */
const BENIGN_PHRASES: readonly RegExp[] = [
  /\b(glue|spray|heat|nail|staple|toy|water|massage|paint|grease|caulking|nerf)[\s-]+guns?\b/gi,
  /\bdrug[\s-]*stores?\b|\bdrug[\s-]+licen[cs]es?\b/gi,
  /\bforged[\s-]+(steel|iron|alloy|aluminium|aluminum|wheels?|carbon|crankshaft|pistons?)\b/gi,
  /\bbreak[\s-]+in[\s-]+(period|time)\b/gi,
  /\blife[\s-]*hacks?\b/gi,
  /\bkill[\s-]+switch(es)?\b/gi,
];

function stripBenignPhrases(text: string): string {
  return BENIGN_PHRASES.reduce((acc, pattern) => acc.replace(pattern, ' '), text);
}

const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', $: 's', '!': 'i' };

/**
 * Lowercases, folds look-alike Unicode (NFKC), drops zero-width characters,
 * undoes common digit-for-letter swaps, and joins letters spaced out with
 * dots, dashes or spaces ("k i l l", "k.i.l.l"). Used only for matching —
 * never shown or stored.
 */
export function normaliseForScreening(text: string): string {
  const folded = text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u200B-\u200D\u2060\uFEFF\u00AD]/g, '')
    .replace(/[013457@$!]/g, (c) => LEET[c] ?? c);
  // Three or more single letters separated by 1-3 separator characters.
  return folded.replace(/(?<![a-z])[a-z](?:[\s._\-*·]{1,3}[a-z](?![a-z])){2,}/g, (run) => run.replace(/[^a-z]/g, ''));
}
