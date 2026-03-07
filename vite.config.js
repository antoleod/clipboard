import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const subpathBase = '/clipboard-vault-android/'
  const envBase = globalThis.process?.env?.VITE_APP_BASE_PATH
  const base =
    envBase ||
    (mode === 'development' ? '/' : subpathBase)

  return {
    base,
    plugins: [react()],
  }
})
