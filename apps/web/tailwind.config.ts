import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Warm paper palette
        paper: {
          50: '#fdfcfb',
          100: '#faf9f7',
          200: '#f5f3ef',
          300: '#ece8e1',
          400: '#d9d3c9',
          500: '#b8b0a3',
          600: '#8a8277',
          700: '#6b6459',
          800: '#4a453d',
          900: '#2d2a25',
        },
        accent: {
          DEFAULT: '#d97448',
          50: '#fef6f0',
          100: '#fde8d8',
          200: '#faceaf',
          300: '#f6ac7d',
          400: '#f08a4e',
          500: '#d97448',
          600: '#c45a2e',
          700: '#a24526',
          800: '#843925',
          900: '#6c3122',
        },
        // Priority colors
        priority: {
          urgent: '#ef4444',
          high: '#f59e0b',
          medium: '#3b82f6',
          low: '#6b7280',
          none: '#d1d5db',
        },
        // Execution type colors
        exec: {
          ai: '#6366f1',
          manual: '#10b981',
          hybrid: '#8b5cf6',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      animation: {
        'fade-in': 'fadeIn 0.15s ease-out',
        'slide-up': 'slideUp 0.2s ease-out',
        'slide-out': 'slideOut 0.3s ease-out forwards',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideOut: {
          '0%': { opacity: '1', transform: 'translateX(0)', maxHeight: '80px' },
          '50%': { opacity: '0', transform: 'translateX(20px)', maxHeight: '80px' },
          '100%': { opacity: '0', transform: 'translateX(20px)', maxHeight: '0', padding: '0', margin: '0' },
        },
      },
    },
  },
  plugins: [],
};

export default config;
