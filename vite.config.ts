import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite is loaded as Express middleware by server.ts in dev mode, so this
// config primarily affects production builds. The `server` block is only used
// when running `vite` standalone (e.g. `vite preview`).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
  },
});
