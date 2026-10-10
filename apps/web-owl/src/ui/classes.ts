/**
 * Tailwind class strings for the shared look (Odoo-style: compact squarer
 * buttons, purple primary, teal links). Plain functions returning strings:
 * Tailwind's scanner reads this file.
 */

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive';
export type ButtonSize = 'default' | 'sm' | 'lg' | 'icon';

const BUTTON_BASE =
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-input text-sm font-medium ' +
  'transition-colors duration-micro ease-onsite disabled:pointer-events-none disabled:opacity-50 ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 ' +
  'focus-visible:ring-offset-paper-0 min-h-[var(--tap-min,40px)] px-4';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-brand-solid text-white hover:bg-brand-700 active:bg-brand-700',
  secondary: 'bg-paper-0 text-ink-900 border border-line hover:bg-paper-100',
  ghost: 'text-ink-900 hover:bg-paper-100',
  destructive: 'bg-dispute text-white hover:opacity-90',
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  default: '',
  sm: 'min-h-[32px] px-3',
  lg: 'min-h-[48px] px-6 text-base',
  icon: 'min-h-[var(--tap-min,40px)] w-[var(--tap-min,40px)] px-0',
};

export function btn(variant: ButtonVariant = 'primary', size: ButtonSize = 'default', extra = ''): string {
  return [BUTTON_BASE, BUTTON_VARIANTS[variant], BUTTON_SIZES[size], extra].filter(Boolean).join(' ');
}

/** A white bordered sheet, like Odoo's form sheet. */
export function card(extra = ''): string {
  return ['rounded-card border border-line bg-paper-0 shadow-card', extra].filter(Boolean).join(' ');
}

export const CARD_HEADER = 'flex flex-col gap-1 p-6 pb-0';
export const CARD_TITLE = 'text-lg font-medium text-ink-900';
export const CARD_DESCRIPTION = 'text-sm text-ink-500';
export const CARD_CONTENT = 'p-6';

export function input(invalid = false, extra = ''): string {
  return [
    'flex w-full min-h-[var(--tap-min,40px)] rounded-input border bg-paper-0 px-3 text-[15px] text-ink-900',
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
/** Odoo links are teal. */
export const LINK = 'text-accent-600 hover:underline';
/** An item inside a dropdown menu. */
export const MENU_ITEM = 'block w-full px-4 py-2 text-left text-sm text-ink-900 hover:bg-paper-100';
