import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: 'class',
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          'SF Pro Text',
          'SF Pro Display',
          'SF Pro',
          'Helvetica Neue',
          'Helvetica',
          'Arial',
          'ui-sans-serif',
          'system-ui',
          'sans-serif',
        ],
        'sf-pro': ['var(--font-sf-pro)'],
        display: [
          '-apple-system',
          'BlinkMacSystemFont',
          'SF Pro Display',
          'SF Pro Text',
          'Helvetica Neue',
          'sans-serif',
        ],
      },
      fontWeight: {
        'normal': '400',
        'medium': '500',
        'semibold': '600',
        'bold': '700',
      },
      letterSpacing: {
        'tight': '-0.02em',
        'snug': '-0.01em',
        'normal': '-0.005em',
      },
      colors: {
        ink: 'var(--ink)',
        soft: 'var(--ink-2)',
        subtle: 'var(--ink-3)',
        faint: 'var(--ink-4)',
        fill: 'var(--fill)',
        cta: 'var(--cta-bg)',
        'on-cta': 'var(--cta-fg)',
      },
    },
  },
  plugins: [],
}

export default config 