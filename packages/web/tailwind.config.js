/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Surface colors (dark-first)
        'surface-0': '#0B0E14',
        'surface-1': '#111520',
        'surface-2': '#161B2A',
        
        // Text colors
        'text-strong': '#E8ECF1',
        'text-muted': '#A8B3C2',
        
        // Primary colors
        'primary': '#5B8CFF',
        'primary-contrast': '#0B0E14',
        
        // Status colors
        'success': '#4CC38A',
        'warning': '#F5A524',
        'danger': '#E5484D',
        'info': '#78A9FF',
        
        // Border
        'border': '#24314A',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica', 'Arial', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'Liberation Mono', 'monospace'],
      },
      spacing: {
        '18': '4.5rem',
        '88': '22rem',
      },
      borderRadius: {
        'DEFAULT': '8px',
        'modal': '12px',
      },
      boxShadow: {
        'elevation-1': '0 1px 3px rgba(0, 0, 0, 0.2)',
        'elevation-2': '0 4px 6px rgba(0, 0, 0, 0.1)',
        'elevation-4': '0 10px 15px rgba(0, 0, 0, 0.1)',
      },
      animation: {
        'pulse-slow': 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
    },
  },
  plugins: [],
};