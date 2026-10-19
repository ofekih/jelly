import { defineConfig, type Plugin } from 'vite';
import tailwindcss from '@tailwindcss/vite';

// Unique per build (and per dev-server start); compared against /version.json to detect deploys.
const APP_VERSION = Date.now().toString(36);

/** Serves (dev) and emits (build) `/version.json` containing the current APP_VERSION. */
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
  plugins: [tailwindcss(), versionJson()],
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
  },
  esbuild: {
    jsx: 'automatic',
  },
});
