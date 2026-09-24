import { describe, expect, it } from 'vitest';
import { RiskService } from './risk.service';
import { BusinessRuleError } from '../../common/errors';

const service = new RiskService();

describe('assertNotProhibited', () => {
  it('allows the founding example unchanged', () => {
    expect(() =>
      service.assertNotProhibited(
        'Inspect MacBook Air M4 at XYZ Computer Store',
        'Check whether the MacBook Air M4 16/512 is in stock, verify the serial number, take photos and a video. Do NOT purchase it.',
      ),
    ).not.toThrow();
  });

  it('blocks weapons', () => {
    expect(() => service.assertNotProhibited('Sell a firearm', 'Meet to hand over a rifle')).toThrow(
      BusinessRuleError,
    );
  });

  it('blocks controlled substances', () => {
    expect(() => service.assertNotProhibited('Pickup', 'Collect some narcotics from a contact')).toThrow(
      BusinessRuleError,
    );
  });

  it('blocks impersonation', () => {
    expect(() =>
      service.assertNotProhibited('Verification visit', 'Pose as a police officer to gain entry'),
    ).toThrow(BusinessRuleError);
  });

  it('blocks unauthorized access', () => {
    expect(() =>
      service.assertNotProhibited('Access needed', 'Need someone to hack into a account for us'),
    ).toThrow(BusinessRuleError);
  });

  it('blocks violence or a threat against a person', () => {
    expect(() => service.assertNotProhibited('Task', 'I need someone to kill my neighbor')).toThrow(
      BusinessRuleError,
    );
    expect(() => service.assertNotProhibited('Task', 'Kidnap this person for me')).toThrow(BusinessRuleError);
  });

  it('does not block ordinary photography or video tasks', () => {
    // The false-positive risk this pattern deliberately avoids: "shoot" is
    // an everyday verb for this app's own task categories.
    expect(() =>
      service.assertNotProhibited('Shoot a video', 'Take photos and shoot a short video of the storefront'),
    ).not.toThrow();
  });

  it('blocks purchasing on the requester\'s behalf, the launch-scope exclusion', () => {
    expect(() =>
      service.assertNotProhibited('Buy a laptop', 'Please buy this laptop for me and ship it'),
    ).toThrow(BusinessRuleError);
  });

  it('blocks a worker fronting money', () => {
    expect(() =>
      service.assertNotProhibited('Urgent', 'Please advance me the cash and I will repay you'),
    ).toThrow(BusinessRuleError);
  });

  it('does not block ordinary mentions of money or prices', () => {
    // A false positive here would break the core inspection use case, where
    // discussing price is the entire point.
    expect(() =>
      service.assertNotProhibited(
        'Check the price',
        'Ask how much the laptop costs and whether cash or card is accepted',
      ),
    ).not.toThrow();
  });
});

describe('scoreRisk', () => {
  const base = { title: 'Inspect a laptop', description: 'Standard inspection at a shop.' };

  it('scores an ordinary daytime task as low risk', () => {
    const result = service.scoreRisk({
      ...base,
      budgetPaise: 50_000,
      deadlineAt: new Date('2026-09-07T14:00:00'),
    });
    expect(result.level).toBe('LOW');
    expect(result.flags).toHaveLength(0);
  });

  it('flags a late-night deadline as medium risk alone', () => {
    const result = service.scoreRisk({
      ...base,
      budgetPaise: 50_000,
      deadlineAt: new Date('2026-09-07T23:30:00'),
    });
    expect(result.level).toBe('MEDIUM');
    expect(result.flags).toContain('late_night_deadline');
  });

  it('flags a high-value task as medium risk alone', () => {
    const result = service.scoreRisk({
      ...base,
      budgetPaise: 2_500_000,
      deadlineAt: new Date('2026-09-07T14:00:00'),
    });
    expect(result.level).toBe('MEDIUM');
    expect(result.flags).toContain('high_value');
  });

  it('escalates to high risk when late-night and high-value combine', () => {
    const result = service.scoreRisk({
      ...base,
      budgetPaise: 2_500_000,
      deadlineAt: new Date('2026-09-07T23:30:00'),
    });
    expect(result.level).toBe('HIGH');
  });

  it('escalates to high risk on an isolated-location mention alone', () => {
    const result = service.scoreRisk({
      title: 'Meet at a secluded spot',
      description: 'Come to an isolated location, no one around.',
      budgetPaise: 50_000,
      deadlineAt: new Date('2026-09-07T14:00:00'),
    });
    expect(result.level).toBe('HIGH');
    expect(result.flags).toContain('isolated_or_private_location');
  });

  it('escalates to high risk on a secrecy request alone', () => {
    const result = service.scoreRisk({
      title: 'Quiet task',
      description: "Please don't tell anyone about this task.",
      budgetPaise: 50_000,
      deadlineAt: new Date('2026-09-07T14:00:00'),
    });
    expect(result.level).toBe('HIGH');
    expect(result.flags).toContain('secrecy_request');
  });

  it('records every flag that fired, not just the first', () => {
    const result = service.scoreRisk({
      title: 'Cash pickup at night',
      description: 'Bring cash. Urgent, need a transfer done quickly.',
      budgetPaise: 50_000,
      deadlineAt: new Date('2026-09-07T22:00:00'),
    });
    expect(result.flags).toEqual(
      expect.arrayContaining(['mentions_cash', 'urgent_transfer_language', 'late_night_deadline']),
    );
  });
});

describe('minVerificationLevelForBudget', () => {
  it('requires level 1 up to and including ₹1,000', () => {
    expect(service.minVerificationLevelForBudget(50_000)).toBe(1);
    expect(service.minVerificationLevelForBudget(100_000)).toBe(1);
  });

  it('requires level 2 above ₹1,000 up to ₹5,000', () => {
    expect(service.minVerificationLevelForBudget(100_001)).toBe(2);
    expect(service.minVerificationLevelForBudget(500_000)).toBe(2);
  });

  it('requires level 3 above ₹5,000', () => {
    expect(service.minVerificationLevelForBudget(500_001)).toBe(3);
    expect(service.minVerificationLevelForBudget(5_000_000)).toBe(3);
  });
});
