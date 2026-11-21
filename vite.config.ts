import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    rollupOptions: {
      output: {
        // Three.js dans son propre fichier : mis en cache indépendamment du code du jeu
        manualChunks: { three: ['three'] },
      },
    },
    chunkSizeWarningLimit: 700,
  },
});
