import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  // Relative base: the build is served from <site>/tools/fairshare/ on GitHub Pages.
  base: './',
  resolve: {
    alias: { '@shared': fileURLToPath(new URL('../shared', import.meta.url)) },
  },
  server: { port: 5173, fs: { allow: ['..'] } },
  build: {
    // Toolhub is deployed straight from the branch (no CI build), so the build output is committed.
    outDir: '../../tools/fairshare',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // GitHub Pages runs Jekyll, which silently drops files whose names start with "_".
        entryFileNames: 'assets/app-[hash].js',
        chunkFileNames: 'assets/chunk-[name]-[hash].js',
        assetFileNames: 'assets/asset-[name]-[hash][extname]',
      },
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'FairShare',
        short_name: 'FairShare',
        description: 'Split shared expenses with friends — free.',
        theme_color: '#059669',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: './',
        scope: './',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }],
      },
    }),
  ],
});
