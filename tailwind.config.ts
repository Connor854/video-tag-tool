import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/client/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        cream: '#f5f0e8',
        'cream-dark': '#ebe5d9',
        'nakie-green': '#2d6a4f',
        'nakie-teal': '#1b4d5c',
        'tag-brown': '#8b7355',
        'tag-bg': '#f0e6d3',
      },
      fontFamily: {
        heading: ['Fraunces', 'serif'],
        body: ['Outfit', 'sans-serif'],
      },
    },
  },
  plugins: [],
} satisfies Config;
