import { defineConfig, devices } from '@playwright/test';

/**
 * Phone-sized click-throughs against the seeded emulators (`npm run dev:emu`), never production.
 * Every test reseeds first, so tests run one at a time.
 */
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    ...devices['Pixel 7'],
    baseURL: 'http://localhost:5180',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev:emu',
    url: 'http://localhost:5180',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
