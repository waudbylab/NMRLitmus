import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  plugins: [react()],
  // Use root base in dev so public/ files resolve correctly; /nmrlitmus/ for GitHub Pages production
  base: command === 'serve' ? '/' : '/NMRLitmus/',
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'plotly': ['plotly.js-dist-min', 'react-plotly.js'],
          'vendor': ['react', 'react-dom'],
          'numerical': ['ml-levenberg-marquardt']
        }
      }
    }
  }
}))
