import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        dashboard: 'dashboard.html',
        admin: 'admin.html',
      },
    },
  },
  server: {
    /* Bind IPv4 loopback by name, not by the `localhost` default. On macOS
       `localhost` can resolve to ::1 first, and the dev server then listens on
       IPv6 only. Every QA script in scripts/ dials http://127.0.0.1, so that
       restart hands them ECONNREFUSED. */
    host: '127.0.0.1',
    /* A build writes dist/ and dist-ssr/ inside this root, and `npm run build`
       deletes dist-ssr again at the end. The watcher read each of those writes
       as a source change and told every open page to reload. A QA script in
       scripts/ then measured a page that reloaded under it, so one build in
       another terminal failed the run. */
    watch: { ignored: ['**/dist/**', '**/dist-ssr/**'] },
    proxy: {
      '/d/': { target: 'http://127.0.0.1:8000', changeOrigin: true },
      '/auth': { target: 'http://127.0.0.1:8000', changeOrigin: true },
      '/linkedin': { target: 'http://127.0.0.1:8000', changeOrigin: true },
      '/email': { target: 'http://127.0.0.1:8000', changeOrigin: true },
      '/twitter': { target: 'http://127.0.0.1:8000', changeOrigin: true },
      '/mailboxes': { target: 'http://127.0.0.1:8000', changeOrigin: true },
      '/api': { target: 'http://127.0.0.1:8000', changeOrigin: true },
    },
  },
})
