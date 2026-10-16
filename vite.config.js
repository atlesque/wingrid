import { defineConfig } from 'vite';
import { cloudflare } from '@cloudflare/vite-plugin';

// One dev server for both halves: Vite serves the page, and the Cloudflare plugin runs the Worker (with its
// local D1) in workerd at the same origin, so /api/* behaves as it will when deployed.
export default defineConfig({
  plugins: [cloudflare()],
  server: { port: 8796, strictPort: true, host: '127.0.0.1' },
});
