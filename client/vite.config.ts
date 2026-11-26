import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: '../public',
    emptyOutDir: true,
  },
  server: {
    port: 5178,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3536',
        changeOrigin: true,
      },
    },
  },
});
