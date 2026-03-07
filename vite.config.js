import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

function normalizeBasePath(value) {
  if (!value || value === '/') return '/'
  const trimmed = String(value).trim().replace(/^\/+|\/+$/g, '')
  return `/${trimmed}/`
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const subpathBase = '/clipboard/'
  const envBase = globalThis.process?.env?.VITE_APP_BASE_PATH
  const base = normalizeBasePath(
    envBase ||
      (mode === 'development' ? '/' : subpathBase)
  )

  return {
    base,
    plugins: [react()],
  }
})
