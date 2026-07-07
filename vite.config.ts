import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Controle de Vendas Vitória',
        short_name: 'Vendas Vitória',
        description: 'Sistema financeiro de vendas da família',
        theme_color: '#1f4e79',
        background_color: '#f4f6f9',
        display: 'standalone',
        icons: [
          {
            src: '/logo.png',
            sizes: '192x192',
            type: 'image/png'
            purpose: 'any maskable'
          },
          {
            src: '/logo.png',
            sizes: '512x512',
            type: 'image/png'
            purpose: 'any maskable'
          }
        ]
      }
    })
  ]
})
