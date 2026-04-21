import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// When building for GitHub Pages at https://<user>.github.io/<repo>/
// the base must match the repository name. Override with VITE_BASE if needed.
const base = process.env.VITE_BASE || '/Tally-App/';

export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: command === 'build' ? base : '/',
  server: {
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          charts: ['recharts'],
          icons: ['lucide-react'],
        },
      },
    },
  },
}));
