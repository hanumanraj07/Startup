/**
 * Tailwind class strings for the shared look (Rapido / Blinkit style: big
 * rounded touch targets, a yellow primary with black text, a black button for
 * use on yellow surfaces, green links). Plain functions returning strings:
 * Tailwind's scanner reads this file.
 */

export type ButtonVariant = 'primary' | 'dark' | 'success' | 'secondary' | 'ghost' | 'destructive';
export type ButtonSize = 'default' | 'sm' | 'lg' | 'icon';

const BUTTON_BASE =
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-input text-sm font-semibold ' +
  'transition-[background-color,color,box-shadow,transform] duration-micro ease-onsite active:scale-[0.98] ' +
  'disabled:pointer-events-none disabled:opacity-50 ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-900 focus-visible:ring-offset-2 ' +
  'focus-visible:ring-offset-paper-0 min-h-[var(--tap-min,44px)]';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-brand-solid text-ink-900 hover:bg-brand-500 hover:shadow-card',
  dark: 'bg-ink-900 text-white hover:bg-ink-700',
  success: 'bg-accent-600 text-white hover:bg-accent-700',
  secondary: 'bg-paper-0 text-ink-900 border border-line hover:border-ink-300 hover:bg-paper-50',
  ghost: 'text-ink-900 hover:bg-paper-100',
  destructive: 'bg-dispute text-white hover:opacity-90',
};

// Horizontal padding lives here, never in BUTTON_BASE: two px-* classes on
// one element resolve by stylesheet order, not by which came last, so a base
// px-5 used to override px-0 and squeeze an icon button's icon to 4px wide.
const BUTTON_SIZES: Record<ButtonSize, string> = {
  default: 'px-5',
  sm: 'min-h-[36px] px-4',
  lg: 'min-h-[52px] px-7 text-base',
  icon: 'min-h-[var(--tap-min,44px)] w-[var(--tap-min,44px)] shrink-0 px-0',
};

export function btn(variant: ButtonVariant = 'primary', size: ButtonSize = 'default', extra = ''): string {
  return [BUTTON_BASE, BUTTON_VARIANTS[variant], BUTTON_SIZES[size], extra].filter(Boolean).join(' ');
}

/** A white rounded card. */
export function card(extra = ''): string {
  return ['rounded-card border border-line-light bg-paper-0 shadow-card', extra].filter(Boolean).join(' ');
}

/**
 * A card that lifts on hover, for lists you tap into (tasks, feed, categories).
 * Not for money or evidence, which stay still.
 */
export function tappableCard(extra = ''): string {
  return card(
    `transition-[box-shadow,transform,border-color] duration-base ease-onsite hover:-translate-y-0.5 hover:border-line hover:shadow-float ${extra}`,
  );
}

export const CARD_HEADER = 'flex flex-col gap-1 p-6 pb-0';
export const CARD_TITLE = 'text-lg font-semibold text-ink-900';
export const CARD_DESCRIPTION = 'text-sm text-ink-500';
export const CARD_CONTENT = 'p-6';

export function input(invalid = false, extra = ''): string {
  return [
    'flex w-full min-h-[var(--tap-min,44px)] rounded-input border bg-paper-0 px-3.5 text-[15px] text-ink-900',
    'placeholder:text-ink-300 transition-[border-color,box-shadow] duration-micro ease-onsite',
    'focus-visible:outline-none focus-visible:border-ink-900 focus-visible:ring-2 focus-visible:ring-brand-500',
    'disabled:cursor-not-allowed disabled:opacity-50',
    invalid ? 'border-dispute' : 'border-line',
    extra,
  ]
    .filter(Boolean)
    .join(' ');
}

export const LABEL = 'text-sm font-medium text-ink-700';
/** Links are green, like Blinkit's. */
export const LINK = 'font-medium text-accent-600 hover:underline';
/** An item inside a dropdown menu. */
export const MENU_ITEM = 'block w-full rounded-input px-3 py-2.5 text-left text-sm text-ink-900 hover:bg-paper-100';
