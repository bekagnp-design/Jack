import { defineConfig } from 'vite';

// GitHub Pages serves the site from /Jack/; local dev and other hosts can override.
export default defineConfig({
  base: process.env.BASE_PATH || '/Jack/',
  build: { target: 'es2020', outDir: 'dist' },
});
