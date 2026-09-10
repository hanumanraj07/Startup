const STYLES = {
  verified: 'bg-verified/10 text-verified',
  progress: 'bg-progress/10 text-progress',
  dispute: 'bg-dispute/10 text-dispute',
  info: 'bg-info/10 text-info',
} as const;

/**
 * The one component every task status renders through, so the state language
 * is identical everywhere. Color is never the only signal: every status also
 * carries a label, since color alone fails for color-blind users and in
 * direct sunlight. See docs/19-ui-design-system.md.
 */
export function StatusPill({
  tone,
  children,
}: {
  tone: keyof typeof STYLES;
  children: React.ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm font-medium ${STYLES[tone]}`}
    >
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
      {children}
    </span>
  );
}
