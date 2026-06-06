import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const backendTarget = `http://localhost:${process.env.BACKEND_PORT ?? '8000'}`

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/login': {
        target: backendTarget,
        changeOrigin: true,
        bypass: (req) => {
          const accept = req.headers?.accept ?? ''
          // Let the SPA handle browser navigations like /login
          if (typeof accept === 'string' && accept.includes('text/html')) {
            return req.url
          }
          return undefined
        },
      },
      '/forgot-password': {
        target: backendTarget,
        changeOrigin: true,
      },
      '/reset-password': {
          target: backendTarget,
          changeOrigin: true,
          bypass: (req) => {
            const accept = req.headers?.accept ?? ''

            // Let React frontend handle browser page navigation
            if (typeof accept === 'string' && accept.includes('text/html')) {
              return req.url
            }

            return undefined
          },
        },
      '/refresh': {
        target: backendTarget,
        changeOrigin: true,
      },
      '/me': {
        target: backendTarget,
        changeOrigin: true,
      },
      '/approvals': {
        target: backendTarget,
        changeOrigin: true,
      },
      '/audit': {
        target: backendTarget,
        changeOrigin: true,
      },
      '/dashboard': {
        target: backendTarget,
        changeOrigin: true,
        bypass: (req) => {
          const accept = req.headers?.accept ?? ''
          // Let the SPA handle browser navigations like /dashboard
          if (typeof accept === 'string' && accept.includes('text/html')) {
            return req.url
          }
          return undefined
        },
      },
      '/tasks': {
        target: backendTarget,
        changeOrigin: true,
      },
      '/reports': {
        target: backendTarget,
        changeOrigin: true,
      },
      '/auth': {
        target: backendTarget,
        changeOrigin: true,
      },
      '/admin': {
        target: backendTarget,
        changeOrigin: true,
        bypass: (req) => {
          const accept = req.headers?.accept ?? ''
          // Let the SPA handle browser navigations like /admin/login
          if (typeof accept === 'string' && accept.includes('text/html')) {
            return req.url
          }
          return undefined
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
