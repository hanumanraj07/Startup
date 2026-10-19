import { describe, expect, it } from 'vitest';
import { compareNames, isAcceptableMatch } from './name-match';

describe('compareNames', () => {
  it('matches the same name regardless of case, order, titles and punctuation', () => {
    expect(compareNames('Rahul Sharma', 'SHARMA RAHUL')).toBe('MATCH');
    expect(compareNames('Mr. Rahul Sharma', 'rahul  sharma')).toBe('MATCH');
  });

  it('accepts a middle name or an initial on one side', () => {
    expect(compareNames('Rahul Sharma', 'Rahul Kumar Sharma')).toBe('PARTIAL');
    expect(compareNames('R Sharma', 'Rahul Sharma')).toBe('PARTIAL');
    expect(compareNames('Rahul S.', 'Rahul Sharma')).toBe('PARTIAL');
  });

  it('rejects a different person, even with a shared surname or first name', () => {
    expect(compareNames('Rahul Sharma', 'Priya Sharma')).toBe('MISMATCH');
    expect(compareNames('Rahul Sharma', 'Rahul Verma')).toBe('MISMATCH');
    expect(compareNames('Rahul Sharma', 'Amit Kumar')).toBe('MISMATCH');
  });

  it('does not accept initials alone', () => {
    expect(compareNames('R S', 'Rahul Sharma')).toBe('MISMATCH');
  });

  it('treats an empty name as a mismatch', () => {
    expect(compareNames('', 'Rahul Sharma')).toBe('MISMATCH');
    expect(compareNames('Mr.', 'Rahul Sharma')).toBe('MISMATCH');
  });

  it('accepts only MATCH and PARTIAL for payouts', () => {
    expect(isAcceptableMatch('MATCH')).toBe(true);
    expect(isAcceptableMatch('PARTIAL')).toBe(true);
    expect(isAcceptableMatch('MISMATCH')).toBe(false);
  });
});
