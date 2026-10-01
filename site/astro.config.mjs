import { defineConfig } from 'astro/config';

export default defineConfig({
  // GitHub Pages builds set SITE_URL and BASE_PATH (e.g. https://you.github.io + /allcare-pharmacy-site).
  site: process.env.SITE_URL || 'https://www.urallcarepharmacy.com',
  base: process.env.BASE_PATH || '/',
  output: 'static',
  build: { inlineStylesheets: 'auto' },
});
