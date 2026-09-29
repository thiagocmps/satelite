import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // assets extras copiados do public/ que podem entrar no precache
      includeAssets: ['favicon.svg', 'favicon.ico', 'apple-touch-icon-180x180.png'],
      manifest: {
        name: 'Satelite',
        short_name: 'Satelite',
        description: 'Agregador de notícias com categorização híbrida e resumo por IA',
        lang: 'pt-BR',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        theme_color: '#05070b',
        background_color: '#0b1630',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        // a SPA abre qualquer rota; a API nunca cai no fallback SPA
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            // leitura de listas/detalhes de noticias: rede primeiro, cache curto
            // como fallback (a lista ja carregada fica visivel offline)
            urlPattern: ({ url, request }) =>
              request.method === 'GET' && url.pathname.startsWith('/api/v1/news'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'satelite-news-v1',
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 30, maxAgeSeconds: 300 },
            },
          },
        ],
      },
      injectRegister: 'auto',
      devOptions: { enabled: false },
    }),
  ],
  server: {
    port: 5173,
    // em dev o frontend fala com a API pelo mesmo origin, como no compose
    proxy: {
      '/api': { target: process.env.API_URL ?? 'http://localhost:4000', changeOrigin: true },
    },
  },
  build: { outDir: 'dist', sourcemap: true },
});