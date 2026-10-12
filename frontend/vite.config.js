import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'

const root = fileURLToPath(new URL('.', import.meta.url))

function sendPage() {
  return {
    name: 'send-page',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (!req.url) return next()
        const queryAt = req.url.indexOf('?')
        const path = queryAt === -1 ? req.url : req.url.slice(0, queryAt)
        const query = queryAt === -1 ? '' : req.url.slice(queryAt)
        if (path === '/send') req.url = `/send/${query}`
        next()
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [sendPage(), react(), tailwindcss()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:8000',
      '/upload': 'http://127.0.0.1:8000',
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(root, 'index.html'),
        send: resolve(root, 'send/index.html'),
      },
    },
  },
})
