/** @type {import('tailwindcss').Config} */

// Map a CSS token to a Tailwind colour that still honours <alpha-value>,
// so utilities like bg-surface/60 and text-accent/40 keep working.
const token = (name) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: token('bg'),
        'bg-soft': token('bg-soft'),
        surface: token('surface'),
        'surface-2': token('surface-2'),
        'surface-3': token('surface-3'),
        border: token('border'),
        'border-strong': token('border-strong'),
        fg: token('fg'),
        muted: token('muted'),
        faint: token('faint'),
        accent: {
          DEFAULT: token('accent'),
          strong: token('accent-strong'),
        },
        human: token('human'),
        warn: token('warn'),
        danger: token('danger'),
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['"Instrument Serif"', 'Georgia', 'serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        xl: 'var(--radius)',
        '2xl': 'calc(var(--radius) + 0.375rem)',
      },
      keyframes: {
        'pulse-soft': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.55' },
        },
        'dash-flow': {
          to: { strokeDashoffset: '-24' },
        },
        'node-glow': {
          '0%, 100%': { opacity: '0.3' },
          '50%': { opacity: '0.85' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        marquee: {
          '0%': { transform: 'translateX(0)' },
          '100%': { transform: 'translateX(-50%)' },
        },
      },
      animation: {
        'pulse-soft': 'pulse-soft 1.6s ease-in-out infinite',
        'dash-flow': 'dash-flow 0.9s linear infinite',
        'node-glow': 'node-glow 1.8s ease-in-out infinite',
        shimmer: 'shimmer 2.4s linear infinite',
        marquee: 'marquee 36s linear infinite',
      },
    },
  },
  plugins: [],
};
