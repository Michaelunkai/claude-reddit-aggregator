/** @type {import('tailwindcss').Config} */
module.exports = {
    content: [
        './src/**/*.{js,jsx,ts,tsx}',
        './public/index.html'
    ],
    theme: {
        extend: {
            // UI ENHANCEMENT: Premium font stack with Inter as primary
            fontFamily: {
                sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
            },
            // UI ENHANCEMENT: Extended color palette for brand consistency
            colors: {
                brand: {
                    pink: '#e040fb',
                    purple: '#a855f7',
                    cyan: '#06b6d4',
                },
                surface: {
                    dark: '#0a0a0f',
                    card: '#14141a',
                    elevated: '#1a1a22',
                    border: '#2a2a35',
                },
                source: {
                    reddit: '#ff4500',
                    github: '#8b5cf6',
                    hackernews: '#f59e0b',
                    devto: '#a855f7',
                    anthropic: '#3b82f6',
                },
                purple: {
                    50: '#faf5ff',
                    100: '#f3e8ff',
                    200: '#e9d5ff',
                    300: '#d8b4fe',
                    400: '#c084fc',
                    500: '#a855f7',
                    600: '#9333ea',
                    700: '#7e22ce',
                    800: '#6b21a8',
                    900: '#581c87'
                }
            },
            // UI ENHANCEMENT: Custom animations for micro-interactions
            animation: {
                'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
                'glow-green': 'glow-green 2s ease-in-out infinite',
                'shimmer-text': 'shimmer-text 3s ease-in-out infinite',
                'count-up': 'count-up 0.6s ease-out forwards',
                'slide-up': 'slide-up 0.3s ease-out forwards',
                'new-badge-pulse': 'new-badge-pulse 2s ease-in-out infinite',
                'scroll-progress': 'scroll-progress linear',
                'star-burst': 'star-burst 0.4s ease-out',
                'card-enter': 'card-enter 0.4s ease-out forwards',
            },
            keyframes: {
                'glow-green': {
                    '0%, 100%': { boxShadow: '0 0 4px rgba(34, 197, 94, 0.4), 0 0 8px rgba(34, 197, 94, 0.2)' },
                    '50%': { boxShadow: '0 0 8px rgba(34, 197, 94, 0.6), 0 0 16px rgba(34, 197, 94, 0.3)' },
                },
                'shimmer-text': {
                    '0%': { backgroundPosition: '-200% center' },
                    '100%': { backgroundPosition: '200% center' },
                },
                'slide-up': {
                    '0%': { opacity: '0', transform: 'translateY(8px)' },
                    '100%': { opacity: '1', transform: 'translateY(0)' },
                },
                'new-badge-pulse': {
                    '0%, 100%': { opacity: '1', transform: 'scale(1)' },
                    '50%': { opacity: '0.8', transform: 'scale(1.05)' },
                },
                'star-burst': {
                    '0%': { transform: 'scale(1)' },
                    '40%': { transform: 'scale(1.35)' },
                    '100%': { transform: 'scale(1)' },
                },
                'card-enter': {
                    '0%': { opacity: '0', transform: 'translateY(12px) scale(0.98)' },
                    '100%': { opacity: '1', transform: 'translateY(0) scale(1)' },
                },
            },
            // UI ENHANCEMENT: Better spacing and typography scale
            letterSpacing: {
                'tight-custom': '-0.01em',
            },
            lineHeight: {
                'snug-custom': '1.35',
            },
            backdropBlur: {
                'xs': '2px',
            },
        }
    },
    plugins: []
};
