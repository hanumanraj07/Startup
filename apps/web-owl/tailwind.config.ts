import type { Config } from 'tailwindcss';

/**
 * A colour that lives in a CSS custom property but still honours Tailwind's
 * opacity modifier (`bg-dispute/10`), which a bare var() silently drops.
 * Plain uses stay a plain var(), so only modifier classes rely on
 * color-mix() and older browsers keep every solid colour. Tailwind 3 accepts
 * a function here at runtime; its types only admit strings, hence the cast.
 */
function token(name: string): string {
  const color = ({ opacityValue }: { opacityValue?: string }) =>
    opacityValue === undefined || opacityValue.startsWith('var(--tw-')
      ? `var(--${name})`
      : `color-mix(in srgb, var(--${name}) calc(${opacityValue} * 100%), transparent)`;
  return color as unknown as string;
}

/**
 * Tailwind config for the OWL frontend. Colors are CSS custom properties
 * (defined in src/styles/globals.css) so the whole theme is one file. Token
 * names match apps/web; radii are generous, as on Rapido and Blinkit.
 */
const config: Config = {
  content: ['./index.html', './src/**/*.ts'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: token('brand-50'),
          100: token('brand-100'),
          500: token('brand-500'),
          600: token('brand-600'),
          700: token('brand-700'),
          solid: token('brand-solid'),
        },
        accent: {
          500: token('accent-500'),
          600: token('accent-600'),
          700: token('accent-700'),
          solid: token('accent-solid'),
        },
        tint: {
          green: token('tint-green'),
          blue: token('tint-blue'),
          orange: token('tint-orange'),
          yellow: token('tint-yellow'),
          pink: token('tint-pink'),
          purple: token('tint-purple'),
        },
        ink: {
          900: token('ink-900'),
          700: token('ink-700'),
          500: token('ink-500'),
          400: token('ink-400'),
          300: token('ink-300'),
        },
        paper: {
          0: token('paper-0'),
          '0-light': token('paper-0-light'),
          50: token('paper-50'),
          100: token('paper-100'),
        },
        line: token('line'),
        'line-light': token('line-light'),
        verified: token('verified'),
        progress: token('progress'),
        dispute: token('dispute'),
        info: token('info'),
      },
      fontFamily: {
        sans: ['var(--font-sans)'],
      },
      borderRadius: {
        input: '12px',
        card: '16px',
        sheet: '20px',
        xl: '24px',
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
