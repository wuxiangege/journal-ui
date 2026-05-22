import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vite.dev/config/
export default defineConfig({
  base: '/journal-ui/',
  plugins: [vue()],
  // server: {
  //   proxy: {
  //     '/api': {
  //       target: 'http://127.0.0.1:6666',
  //       changeOrigin: true,
  //     },
  //   },
  // },
})
