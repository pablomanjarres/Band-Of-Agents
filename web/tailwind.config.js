/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      keyframes: {
        'pulse-soft': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.55' },
        },
        'dash-flow': {
          to: { strokeDashoffset: '-24' },
        },
        'node-glow': {
          '0%, 100%': { opacity: '0.35' },
          '50%': { opacity: '0.9' },
        },
      },
      animation: {
        'pulse-soft': 'pulse-soft 1.6s ease-in-out infinite',
        'dash-flow': 'dash-flow 0.9s linear infinite',
        'node-glow': 'node-glow 1.8s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
