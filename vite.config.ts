import type { Plugin } from 'vite';
import { configDefaults, defineConfig } from 'vitest/config';
import tailwindcss from '@tailwindcss/vite';

// Unique per build (and per dev-server start); compared against /version.json to detect deploys.
const APP_VERSION = Date.now().toString(36);

/** Serves (dev) and emits (build) `/version.json` containing the current APP_VERSION. */
/** Dev-only: serves the about page at /about like Hosting does in production. */
function aboutRoute(): Plugin {
  return {
    name: 'jelly-about-route',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (req.url === '/about' || req.url?.startsWith('/about?')) req.url = req.url.replace('/about', '/about.html');
        next();
      });
    },
  };
}

function versionJson(): Plugin {
  const body = JSON.stringify({ version: APP_VERSION });
  return {
    name: 'jelly-version-json',
    configureServer(server) {
      server.middlewares.use('/version.json', (_req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-store');
        res.end(body);
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: body });
    },
  };
}

export default defineConfig({
  plugins: [tailwindcss(), versionJson(), aboutRoute()],
  server: {
    // Title search runs in a Cloud Function behind Hosting; dev uses the live one
    proxy: { '/api': { target: 'https://eatwithjelly.com', changeOrigin: true } },
  },
  build: {
    rollupOptions: {
      input: { main: 'index.html', about: 'about.html' },
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
  },
  esbuild: {
    jsx: 'automatic',
  },
  test: {
    // Emulator tests run via `npm run test:emulator`; functions/ and worktrees have their own
    exclude: [...configDefaults.exclude, '**/*.emu.test.ts', 'functions/**', '.claude/**'],
  },
});
