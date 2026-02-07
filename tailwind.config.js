/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        game: ['Orbitron', 'sans-serif'],
      },
      colors: {
        neon: {
          cyan: '#0ff',
          pink: '#f0f',
          green: '#0f0',
          yellow: '#ff0',
        }
      },
      animation: {
        'glow': 'glow 1.5s ease-in-out infinite alternate',
        'float': 'float 3s ease-in-out infinite',
      },
      keyframes: {
        glow: {
          'from': { textShadow: '0 0 10px #0ff, 0 0 20px #0ff' },
          'to': { textShadow: '0 0 20px #0ff, 0 0 40px #0ff, 0 0 60px #0ff' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-10px)' },
        }
      }
    },
  },
  plugins: [],
}