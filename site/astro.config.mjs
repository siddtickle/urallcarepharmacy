import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://www.urallcarepharmacy.com',
  output: 'static',
  build: { inlineStylesheets: 'auto' },
});
