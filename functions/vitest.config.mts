import { defineConfig } from 'vitest/config';

// `*.unit.ts` run anywhere; `*.emu.ts` need the Firestore + Functions emulators (`npm run test:emulator`).
// Not named `*.test.ts` so the web app's root `npm test` doesn't pick them up.
export default defineConfig({
  test: {
    include: ['test/**/*.unit.ts', 'test/**/*.emu.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
    fileParallelism: false,
  },
});
