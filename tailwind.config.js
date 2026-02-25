/** @type {import('tailwindcss').Config} */
module.exports = {
    content: [
        './src/**/*.{js,jsx,ts,tsx}',
        './public/index.html'
    ],
    theme: {
        extend: {
            // UI ENHANCEMENT: Premium color palette
            colors: {
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
                },
                // UI ENHANCEMENT: Refined dark mode surfaces
                surface: {
                    DEFAULT: '#0a0a0f',
                    raised: '#14141a',
                    overlay: '#1c1c24',
                    border: '#2a2a35',
                },
                accent: {
                    pink: '#e040fb',
                    cyan: '#06b6d4',
                    github: '#8b5cf6',
                    reddit: '#ff4500',
                    hackernews: '#f59e0b',
                    live: '#22c55e',
                }
            },
            // UI ENHANCEMENT: Font family with Inter as primary
            fontFamily: {
                sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
            },
            // UI ENHANCEMENT: Custom animations
            animation: {
                'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
                'glow-green': 'glow-green 2s ease-in-out infinite',
                'shimmer': 'shimmer 2s linear infinite',
                'count-up': 'count-up 0.6s ease-out',
                'slide-up': 'slide-up 0.3s ease-out',
                'slide-down': 'slide-down 0.3s ease-out',
                'new-badge-pulse': 'new-badge-pulse 2s ease-in-out infinite',
                'star-burst': 'star-burst 0.4s ease-out',
                'progress': 'progress 180s linear',
            },
            keyframes: {
                'glow-green': {
                    '0%, 100%': { boxShadow: '0 0 4px rgba(34, 197, 94, 0.4), 0 0 8px rgba(34, 197, 94, 0.2)' },
                    '50%': { boxShadow: '0 0 8px rgba(34, 197, 94, 0.6), 0 0 16px rgba(34, 197, 94, 0.3)' },
                },
                'shimmer': {
                    '0%': { backgroundPosition: '-200% 0' },
                    '100%': { backgroundPosition: '200% 0' },
                },
                'slide-up': {
                    '0%': { transform: 'translateY(8px)', opacity: '0' },
                    '100%': { transform: 'translateY(0)', opacity: '1' },
                },
                'slide-down': {
                    '0%': { transform: 'translateY(-8px)', opacity: '0' },
                    '100%': { transform: 'translateY(0)', opacity: '1' },
                },
                'new-badge-pulse': {
                    '0%, 100%': { opacity: '1', boxShadow: '0 0 0 0 rgba(34, 197, 94, 0.4)' },
                    '50%': { opacity: '0.85', boxShadow: '0 0 0 6px rgba(34, 197, 94, 0)' },
                },
                'star-burst': {
                    '0%': { transform: 'scale(1)' },
                    '30%': { transform: 'scale(1.35)' },
                    '60%': { transform: 'scale(0.95)' },
                    '100%': { transform: 'scale(1)' },
                },
            },
            // UI ENHANCEMENT: Consistent spacing scale
            spacing: {
                '18': '4.5rem',
                '88': '22rem',
            },
            // UI ENHANCEMENT: Refined shadows
            boxShadow: {
                'card': '0 2px 8px rgba(0, 0, 0, 0.08)',
                'card-hover': '0 8px 24px rgba(0, 0, 0, 0.15)',
                'card-dark': '0 2px 8px rgba(0, 0, 0, 0.3)',
                'card-dark-hover': '0 8px 24px rgba(0, 0, 0, 0.45)',
                'glow-pink': '0 0 20px rgba(224, 64, 251, 0.3)',
                'glow-green': '0 0 12px rgba(34, 197, 94, 0.3)',
                'glow-gold': '0 0 12px rgba(250, 204, 21, 0.2)',
            },
            // UI ENHANCEMENT: Better border radius
            borderRadius: {
                '2xl': '1rem',
                '3xl': '1.25rem',
            },
            // UI ENHANCEMENT: Letter spacing for hierarchy
            letterSpacing: {
                'tight': '-0.01em',
                'snug': '-0.005em',
            },
        }
    },
    plugins: []
};
