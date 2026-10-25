import { execFileSync } from 'node:child_process';
import { expect, Locator, Page, test } from '@playwright/test';

// The seeded Restaurants list, #1 first (scripts/emulator/seed.ts)
const SEEDED = ['Noodle Bar Uno', 'Casa Verde', 'Golden Dumpling House', 'Trattoria Sole', 'Burger Lab', 'Pho Corner'];

test.beforeEach(async ({ page }) => {
  // Its own process: Playwright's loader can't load firebase-admin
  execFileSync('npx', ['tsx', 'scripts/emulator/seed.ts'], { stdio: 'ignore' });
  await page.goto('/');
  await expect(page.getByTitle(/^Signed in as sam@jelly\.test/)).toBeVisible();
  await expect(page.getByText('Noodle Bar Uno')).toBeVisible();
});

/** The ranked list's names, top first */
async function rankedNames(page: Page): Promise<string[]> {
  const text = await page.locator('main').innerText();
  return SEEDED.filter((name) => text.includes(name)).sort((a, b) => text.indexOf(a) - text.indexOf(b));
}

/** Settings live on the profile page (bottom bar → avatar). */
async function openSettings(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^Profile/ }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
}

/** Drags a sheet's top edge down like a finger would (the app listens to touch events). */
async function swipeDown(target: Locator, distance = 160): Promise<void> {
  await target.evaluate(async (el, dy) => {
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + Math.min(10, r.height / 2);
    const touch = (clientY: number) => new Touch({ identifier: 1, target: el, clientX: x, clientY });
    const fire = (type: string, clientY: number) =>
      el.dispatchEvent(
        new TouchEvent(type, {
          bubbles: true,
          cancelable: true,
          touches: type === 'touchend' ? [] : [touch(clientY)],
          changedTouches: [touch(clientY)],
        })
      );
    fire('touchstart', y);
    for (let i = 1; i <= 8; i++) {
      fire('touchmove', y + (dy * i) / 8);
      await new Promise((resolve) => setTimeout(resolve, 16));
    }
    fire('touchend', y + dy);
  }, distance);
}

test('shows the seeded account with friends and community scores', async ({ page }) => {
  expect(await rankedNames(page)).toEqual(SEEDED);
  await expect(page.getByText('Friends 8.8')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Riley' })).toBeVisible();
});

test('re-ranking with side-by-side moves the spot and keeps its notes', async ({ page }) => {
  await page.getByText('Golden Dumpling House').click();
  await page.getByRole('button', { name: 'Re-rank Golden Dumpling House' }).click();
  await page.getByRole('button', { name: 'Incredible', exact: true }).click();

  // Prefer it every time: it should end up #1
  const prompt = page.getByText(/which do you prefer/i);
  await expect(prompt).toBeVisible();
  while (await prompt.isVisible()) {
    await page.getByRole('button', { name: /Golden Dumpling House.*Tap to pick/ }).click();
    await page.waitForTimeout(250);
  }

  await expect(page.getByText('Ranked Golden Dumpling House #1 in Restaurants')).toBeVisible();
  await page.reload();
  await expect(page.getByText('Noodle Bar Uno')).toBeVisible();
  expect((await rankedNames(page))[0]).toBe('Golden Dumpling House');

  await page.getByText('Golden Dumpling House').click();
  await expect(page.getByText('Soup dumplings, always')).toBeVisible();
});

test('removing a spot can be undone, back in its place', async ({ page }) => {
  await page.getByText('Burger Lab').click();
  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  await page.getByRole('button', { name: 'Remove Spot' }).click();
  await expect(page.getByText('Removed Burger Lab')).toBeVisible();
  expect(await rankedNames(page)).not.toContain('Burger Lab');

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByText('Restored Burger Lab')).toBeVisible();
  await page.reload();
  await expect(page.getByText('Noodle Bar Uno')).toBeVisible();
  expect(await rankedNames(page)).toEqual(SEEDED);
});

test('settings save when the sheet is swiped closed', async ({ page }) => {
  await openSettings(page);
  const title = page.getByRole('heading', { name: 'Settings' });
  await expect(title).toBeVisible();
  await page.getByRole('button', { name: 'Linear' }).click();

  await swipeDown(title.locator('xpath=../..'));
  await expect(title).toBeHidden();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();

  await page.reload();
  await expect(page.getByText('Noodle Bar Uno')).toBeVisible();
  await openSettings(page);
  await expect(page.getByText('Uniform spacing across the entire spectrum.')).toBeVisible();
});

test('a short drag springs back instead of closing', async ({ page }) => {
  await openSettings(page);
  const title = page.getByRole('heading', { name: 'Settings' });
  await expect(title).toBeVisible();
  await swipeDown(title.locator('xpath=../..'), 40);
  await page.waitForTimeout(400);
  await expect(title).toBeVisible();
});

test('the profile page shows your stats and closes with Back', async ({ page }) => {
  await page.getByRole('button', { name: /^Profile/ }).click();
  const profile = page.getByRole('region', { name: 'Profile' });
  await expect(profile.getByText('Your lists')).toBeVisible();
  await expect(profile.getByRole('button', { name: /^(Edit handle @|Choose a handle)/ })).toBeVisible();
  await page.goBack();
  await expect(profile).toBeHidden();
  await expect(page.getByText('Noodle Bar Uno')).toBeVisible();
});

test('search finds a title, opens its page, goes back, then saves and ranks it from its row', async ({ page }) => {
  // Title search goes to the TMDB proxy; answer it here so the test never needs the network
  await page.route('**/api/tmdb/search**', (route) =>
    route.fulfill({
      json: {
        results: [
          { kind: 'movie', id: 438631, title: 'Dune', year: 2021, creator: 'Denis Villeneuve', genres: ['Sci-Fi'] },
          { kind: 'movie', id: 329865, title: 'Arrival', year: 2016, creator: 'Denis Villeneuve', genres: ['Sci-Fi'] },
        ],
      },
    })
  );
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  const search = page.getByRole('dialog', { name: 'Search' });
  await search.getByRole('tab', { name: 'Watch' }).click();
  await search.getByRole('textbox').fill('villeneuve');
  // Arrival is the seeded #1 movie
  await expect(search.getByText(/^Ranked #1 · /)).toBeVisible();

  await search.getByRole('button', { name: 'Open Dune' }).click();
  const placePage = page.getByRole('dialog', { name: 'Dune' });
  await expect(placePage.getByText('Not in your lists')).toBeVisible();
  await page.goBack();
  await expect(placePage).toBeHidden();
  await expect(search.getByRole('textbox')).toHaveValue('villeneuve');

  await search.getByRole('button', { name: 'Save Dune to Want to Watch' }).click();
  await expect(search.getByText('On your Want to Watch')).toBeVisible();

  await search.getByRole('button', { name: 'Rank Dune' }).click();
  await page.getByRole('button', { name: 'Skip', exact: true }).click();
  const prompt = page.getByText(/which do you prefer/i);
  await expect(prompt).toBeVisible();
  while (await prompt.isVisible()) {
    await page.getByRole('button', { name: /Tap to pick/ }).filter({ hasNotText: 'Dune' }).first().click();
    await page.waitForTimeout(250);
  }
  await expect(page.getByText('Ranked Dune #4 in Movies')).toBeVisible();
  await expect(search).toBeHidden();
  await expect(page.locator('main').getByText('Dune')).toBeVisible();
});

test('uploading a profile photo shows it everywhere, and removing it goes back', async ({ page }) => {
  await page.getByRole('button', { name: /^Profile/ }).click();
  const png = Buffer.from(
    await page.evaluate(() => {
      const c = document.createElement('canvas');
      c.width = 900;
      c.height = 600;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#a78bfa';
      ctx.fillRect(0, 0, 900, 600);
      return c.toDataURL('image/png').split(',')[1];
    }),
    'base64'
  );
  await page.getByTestId('profile-photo-input').setInputFiles({ name: 'me.png', mimeType: 'image/png', buffer: png });
  const cropper = page.getByRole('dialog', { name: 'Move and scale your photo' });
  await cropper.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(cropper).toBeHidden();
  await expect(page.getByText('Profile photo updated')).toBeVisible();
  // The Storage emulator's URL, on the profile and in the bottom bar
  const bottomBarPhoto = page.getByRole('navigation', { name: 'Main' }).locator('img');
  await expect(bottomBarPhoto).toHaveAttribute('src', /^http:\/\/127\.0\.0\.1:9199\/.*profilePhotos%2Ftest-sam%2F/);

  await page.getByRole('button', { name: 'Change profile photo' }).click();
  await page.getByRole('button', { name: 'Remove photo' }).click();
  await expect(page.getByRole('button', { name: 'Upload a profile photo' })).toBeVisible();
  await expect(bottomBarPhoto).toHaveCount(0);
});
