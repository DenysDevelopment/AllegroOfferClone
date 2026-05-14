/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          'Roboto',
          '"Helvetica Neue"',
          'Arial',
          'sans-serif',
        ],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      colors: {
        app: 'rgb(var(--c-app) / <alpha-value>)',
        card: 'rgb(var(--c-card) / <alpha-value>)',
        soft: 'rgb(var(--c-soft) / <alpha-value>)',
        border: {
          DEFAULT: 'rgb(var(--c-border) / <alpha-value>)',
          muted: 'rgb(var(--c-border-muted) / <alpha-value>)',
          strong: 'rgb(var(--c-border-strong) / <alpha-value>)',
        },
        ink: {
          DEFAULT: 'rgb(var(--c-ink) / <alpha-value>)',
          muted: 'rgb(var(--c-ink-muted) / <alpha-value>)',
          faint: 'rgb(var(--c-ink-faint) / <alpha-value>)',
          on: 'rgb(var(--c-ink-on) / <alpha-value>)',
        },
        flame: {
          DEFAULT: 'rgb(var(--c-flame) / <alpha-value>)',
          soft: 'rgb(var(--c-flame-soft) / <alpha-value>)',
          tint: 'rgb(var(--c-flame-tint) / <alpha-value>)',
          ring: 'rgb(var(--c-flame-ring) / <alpha-value>)',
        },
        ok: 'rgb(var(--c-ok) / <alpha-value>)',
        okTint: 'rgb(var(--c-ok-tint) / <alpha-value>)',
        warn: 'rgb(var(--c-warn) / <alpha-value>)',
        warnTint: 'rgb(var(--c-warn-tint) / <alpha-value>)',
        bad: 'rgb(var(--c-bad) / <alpha-value>)',
        badTint: 'rgb(var(--c-bad-tint) / <alpha-value>)',
      },
      borderRadius: {
        DEFAULT: '8px',
        sm: '6px',
        md: '8px',
        lg: '12px',
        xl: '16px',
      },
      boxShadow: {
        card: 'var(--shadow-card)',
        pop: 'var(--shadow-pop)',
        focus: '0 0 0 3px rgb(var(--c-flame) / 0.22)',
      },
      animation: {
        'fade-up': 'fadeUp 240ms cubic-bezier(0.2, 0.8, 0.2, 1) both',
      },
      keyframes: {
        fadeUp: {
          '0%': { opacity: '0', transform: 'translateY(3px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
};
