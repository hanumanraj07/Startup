import { formatPaise } from '@onsite/money';
import { cn } from '@/lib/utils';

interface MoneyBreakdownProps {
  budgetPaise: number;
  commissionPaise: number;
  workerPayoutPaise: number;
  /** True for a pre-payment estimate — the server has the authoritative number. */
  estimate?: boolean;
  className?: string;
}

/**
 * Always shows all three figures together — budget, commission, payout —
 * never collapsed to just one. docs/19-ui-design-system.md: money screens
 * are calm and explicit, and tabular numerals are mandatory so the figures
 * align down the column.
 */
export function MoneyBreakdown({
  budgetPaise,
  commissionPaise,
  workerPayoutPaise,
  estimate,
  className,
}: MoneyBreakdownProps) {
  return (
    <div className={cn('flex flex-col gap-3 rounded-card border border-line bg-paper-100 p-4', className)}>
      {estimate ? (
        <p className="text-xs uppercase tracking-wide text-ink-400">Estimate — confirmed exactly at payment</p>
      ) : null}
      <Row label="Task budget" valuePaise={budgetPaise} />
      <Row label="Platform commission" valuePaise={commissionPaise} muted />
      <div className="h-px bg-line" />
      <Row label="Worker receives" valuePaise={workerPayoutPaise} emphasize />
    </div>
  );
}

function Row({
  label,
  valuePaise,
  muted,
  emphasize,
}: {
  label: string;
  valuePaise: number;
  muted?: boolean;
  emphasize?: boolean;
}) {
  return (
    <div className="flex items-center justify-between text-[15px]">
      <span className={muted ? 'text-ink-500' : 'text-ink-900'}>{label}</span>
      <span
        className={cn('tabular font-semibold', muted ? 'text-ink-500 font-normal' : 'text-ink-900', emphasize && 'text-verified')}
      >
        {formatPaise(valuePaise, { forceDecimals: true })}
      </span>
    </div>
  );
}
