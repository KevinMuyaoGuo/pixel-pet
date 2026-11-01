import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    rollupOptions: {
      input: {
        pet: resolve(projectRoot, 'index.html'),
        settings: resolve(projectRoot, 'settings.html'),
      },
    },
  },
  server: { strictPort: true },
});
