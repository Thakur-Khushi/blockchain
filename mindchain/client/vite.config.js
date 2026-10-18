import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: 5173,
      // Same-origin API calls in development; the backend URL never reaches the bundle.
      proxy: {
        '/api': { target: env.API_PROXY_TARGET || 'http://localhost:5000', changeOrigin: true },
      },
    },
  };
});
