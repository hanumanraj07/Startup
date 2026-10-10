/**
 * Tailwind class strings ported 1:1 from apps/web's Button / Card / Input
 * (class-variance-authority output), so the OWL UI renders identically.
 * Plain functions returning strings: Tailwind's scanner reads these files.
 */

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive' | 'gradient';
export type ButtonSize = 'default' | 'sm' | 'lg' | 'icon';

const BUTTON_BASE =
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-card text-[15px] font-semibold ' +
  'transition-colors duration-micro ease-onsite disabled:pointer-events-none disabled:opacity-50 ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 ' +
  'focus-visible:ring-offset-paper-0 min-h-[var(--tap-min,44px)] px-4';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent-solid text-white hover:bg-accent-700 active:bg-accent-700',
  secondary: 'bg-paper-100 text-ink-900 border border-line hover:bg-paper-0',
  ghost: 'text-ink-900 hover:bg-paper-100',
  destructive: 'bg-dispute text-white hover:opacity-90',
  gradient: 'bg-accent-gradient text-white shadow-glow-accent hover:shadow-none hover:bg-accent-700',
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  default: '',
  sm: 'min-h-[36px] px-3 text-sm',
  lg: 'min-h-[52px] px-6 text-base',
  icon: 'min-h-[var(--tap-min,44px)] w-[var(--tap-min,44px)] px-0',
};

export function btn(variant: ButtonVariant = 'primary', size: ButtonSize = 'default', extra = ''): string {
  return [BUTTON_BASE, BUTTON_VARIANTS[variant], BUTTON_SIZES[size], extra].filter(Boolean).join(' ');
}

export type CardIntent = 'default' | 'glass' | 'gradient';

const CARD_INTENTS: Record<CardIntent, string> = {
  default: 'border border-line bg-paper-0 shadow-card',
  glass: 'glass-panel shadow-float',
  gradient: 'border border-transparent bg-hero-gradient shadow-elevated',
};

export function card(intent: CardIntent = 'default', extra = ''): string {
  return ['rounded-card', CARD_INTENTS[intent], extra].filter(Boolean).join(' ');
}

export const CARD_HEADER = 'flex flex-col gap-1 p-6 pb-0';
export const CARD_TITLE = 'text-[19px] font-semibold text-ink-900';
export const CARD_DESCRIPTION = 'text-sm text-ink-500';
export const CARD_CONTENT = 'p-6';

export function input(invalid = false, extra = ''): string {
  return [
    'flex w-full min-h-[var(--tap-min,44px)] rounded-input border bg-paper-0 px-3.5 text-base text-ink-900',
    'placeholder:text-ink-300 transition-colors duration-micro ease-onsite',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500',
    'disabled:cursor-not-allowed disabled:opacity-50',
    invalid ? 'border-dispute' : 'border-line',
    extra,
  ]
    .filter(Boolean)
    .join(' ');
}

export const LABEL = 'text-sm font-medium text-ink-700';
