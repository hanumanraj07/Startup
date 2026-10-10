import type { Config } from 'tailwindcss';

/**
 * Tailwind config for the OWL frontend. Colors are CSS custom properties
 * (defined in src/styles/globals.css) so the whole theme is one file. Token
 * names match apps/web; radii are squarer to suit the Odoo-style look.
 */
const config: Config = {
  content: ['./index.html', './src/**/*.ts'],
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
        accent: {
          500: 'var(--accent-500)',
          600: 'var(--accent-600)',
          700: 'var(--accent-700)',
          solid: 'var(--accent-solid)',
        },
        tint: {
          green: 'var(--tint-green)',
          blue: 'var(--tint-blue)',
          orange: 'var(--tint-orange)',
          yellow: 'var(--tint-yellow)',
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
          '0-light': 'var(--paper-0-light)',
          50: 'var(--paper-50)',
          100: 'var(--paper-100)',
        },
        line: 'var(--line)',
        'line-light': 'var(--line-light)',
        verified: 'var(--verified)',
        progress: 'var(--progress)',
        dispute: 'var(--dispute)',
        info: 'var(--info)',
      },
      fontFamily: {
        sans: ['var(--font-sans)'],
      },
      borderRadius: {
        input: '4px',
        card: '6px',
        sheet: '8px',
        xl: '12px',
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
