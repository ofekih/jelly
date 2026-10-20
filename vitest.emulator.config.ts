import { defineConfig } from 'vitest/config';

// Sync tests against the Firestore emulator with the real firestore.rules:
// `npm run test:emulator` starts the emulator, runs these, and stops it.
export default defineConfig({
  test: {
    include: ['src/**/*.emu.test.ts'],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
