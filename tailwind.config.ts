import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#f3f6fb',
          100: '#e6ecf5',
          200: '#c3d3e8',
          300: '#9fb9da',
          400: '#5f8cbe',
          500: '#20609e',
          600: '#1c5690',
          700: '#174066',
          800: '#122f4b',
          900: '#0d2035'
        },
        surface: {
          50: '#f8f9fb',
          100: '#f1f3f6',
          200: '#e4e8ee',
          300: '#cdd4de',
          400: '#aeb7c4',
          500: '#8b96a6',
          600: '#667384',
          700: '#3f4b5a',
          800: '#1b2431',
          900: '#111722'
        }
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Inter', 'Helvetica', 'Arial', 'sans-serif']
      },
      boxShadow: {
        card: '0 1px 2px 0 rgba(16, 24, 40, 0.05), 0 1px 3px 0 rgba(16, 24, 40, 0.06)'
      }
    }
  },
  plugins: []
};

export default config;
