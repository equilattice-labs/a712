import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  server: {
    fs: { strict: true, allow: ['.'], deny: ['**/key.txt', '**/.env*', '**/*private-key*'] },
    proxy: { '/api': { target: 'http://127.0.0.1:8787', changeOrigin: false } },
  },
  build: { sourcemap: false },
})
