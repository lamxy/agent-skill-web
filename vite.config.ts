import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// 前端原始碼在 web/，建置產物放到 dist/web，由 Fastify 靜態託管。
export default defineConfig({
  root: 'web',
  plugins: [react()],
  build: {
    outDir: '../dist/web',
    emptyOutDir: true
  },
  server: {
    port: 5173,
    // 開發時把 API 請求轉發到 Fastify，維持與正式環境相同的同源行為，
    // 讓 HttpOnly Cookie 不需要任何跨域設定。
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: false
      }
    }
  }
});
