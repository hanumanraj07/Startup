import type { Config } from 'tailwindcss';

/**
 * Tailwind config, built directly from docs/19-ui-design-system.md.
 *
 * Colors are CSS custom properties (defined in globals.css) rather than
 * literal hex values, so light and dark mode are a single variable swap
 * rather than a `dark:` variant on every element. Both palettes are defined
 * explicitly on :root, never only inside a dark media query, per the design
 * doc's dark mode requirement.
 */
const config: Config = {
  darkMode: ['class', '[data-theme="dark"]'],
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: 'var(--brand-50)',
          100: 'var(--brand-100)',
          500: 'var(--brand-500)',
          600: 'var(--brand-600)',
          700: 'var(--brand-700)',
          solid: 'var(--brand-solid)',
        },
        ink: {
          900: 'var(--ink-900)',
          700: 'var(--ink-700)',
          500: 'var(--ink-500)',
          400: 'var(--ink-400)',
          300: 'var(--ink-300)',
        },
        paper: {
          0: 'var(--paper-0)',
          50: 'var(--paper-50)',
          100: 'var(--paper-100)',
        },
        line: 'var(--line)',
        verified: 'var(--verified)',
        progress: 'var(--progress)',
        dispute: 'var(--dispute)',
        info: 'var(--info)',
      },
      fontFamily: {
        sans: ['var(--font-sans)'],
      },
      borderRadius: {
        input: '8px',
        card: '12px',
        sheet: '16px',
      },
      boxShadow: {
        card: 'var(--shadow-card)',
        float: 'var(--shadow-float)',
      },
      transitionTimingFunction: {
        onsite: 'cubic-bezier(0.2, 0, 0, 1)',
      },
      transitionDuration: {
        micro: '120ms',
        base: '220ms',
        page: '320ms',
      },
      maxWidth: {
        prose: '68ch',
      },
    },
  },
  plugins: [],
};

export default config;
