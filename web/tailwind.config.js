/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
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
        // Surfaces — warm off-white CRM look
        app: '#F7F5F0',          // page background
        card: '#FFFFFF',         // panel / card
        soft: '#FBF8F3',         // subtle inset surface
        border: {
          DEFAULT: '#ECE7DF',    // standard divider
          muted: '#F3EFE9',      // softer line
          strong: '#D8D2C7',     // emphasized
        },
        // Text
        ink: {
          DEFAULT: '#1F1F23',    // primary text
          muted: '#6E6E76',
          faint: '#A8A8B0',
          on: '#FFFFFF',
        },
        // Brand orange (matches LaptopGuru CRM)
        flame: {
          DEFAULT: '#FF6B35',
          soft: '#FF8A5C',
          tint: '#FFF1E8',       // very light orange (active row bg)
          ring: '#FFD2BA',
        },
        ok: '#10B981',
        okTint: '#E8F8F1',
        warn: '#F59E0B',
        warnTint: '#FFF6E5',
        bad: '#EF4444',
        badTint: '#FDECEC',
      },
      borderRadius: {
        DEFAULT: '8px',
        sm: '6px',
        md: '8px',
        lg: '12px',
        xl: '16px',
      },
      boxShadow: {
        card: '0 1px 2px rgba(15, 15, 20, 0.04), 0 0 0 1px rgba(15, 15, 20, 0.04)',
        pop:  '0 4px 12px rgba(15, 15, 20, 0.06), 0 0 0 1px rgba(15, 15, 20, 0.05)',
        focus: '0 0 0 3px rgba(255, 107, 53, 0.18)',
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
