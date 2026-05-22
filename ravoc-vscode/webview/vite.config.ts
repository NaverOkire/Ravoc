import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        entryFileNames: 'webview.js',
        chunkFileNames: 'webview.js',
        assetFileNames: 'webview.[ext]',
        manualChunks: undefined,
      },
    },
    outDir: resolve(__dirname, '../media'),
    emptyOutDir: false,
  },
});