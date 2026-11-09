import { execFileSync } from 'node:child_process';
import { expect, Page, test } from '@playwright/test';
import { syntheticBeliTexts, syntheticBeliZip } from '../src/lib/beliImport/fixtures';

/**
 * The Beli import at phone size, with a synthetic export (made-up places, never a real one) and
 * Google's Text Search answered locally: "Lucky …" places have several branches (need a look),
 * "Hidden …" places aren't found, everything else matches.
 */

test.beforeEach(async ({ page }) => {
  execFileSync('npx', ['tsx', 'scripts/emulator/seed.ts'], { stdio: 'ignore' });
  await mockPlacesSearch(page);
  await page.goto('/');
  await expect(page.getByTitle(/^Signed in as sam@jelly\.test/)).toBeVisible();
  await expect(page.getByText('Noodle Bar Uno')).toBeVisible();
});

async function mockPlacesSearch(page: Page): Promise<void> {
  await page.route('https://places.googleapis.com/v1/places:searchText', async (route) => {
    const { textQuery } = JSON.parse(route.request().postData() || '{}') as { textQuery: string };
    const [name, ...rest] = textQuery.split(', ');
    const city = (rest[0] || 'Irvine').trim();
    const place = (id: string, displayName: string) => ({
      id,
      displayName: { text: displayName },
      formattedAddress: `${10 + id.length} Main St, ${city}`,
      addressComponents: [
        { longText: city, shortText: city, types: ['locality'] },
        { longText: rest[1]?.trim() || 'CA', shortText: rest[1]?.trim() || 'CA', types: ['administrative_area_level_1'] },
        { longText: 'United States', shortText: 'US', types: ['country'] },
      ],
      location: { latitude: 33.68, longitude: -117.82 },
      types: ['restaurant', 'food'],
      primaryType: 'restaurant',
    });
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const places = /^Hidden/.test(name)
      ? []
      : /^Lucky/.test(name)
        ? [place(`mock-${slug}-1`, name), place(`mock-${slug}-2`, name)]
        : [place(`mock-${slug}`, name)];
    await route.fulfill({ json: { places } });
  });
}

async function openImportFromSettings(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^Profile/ }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: /Import from Beli/ }).click();
}

const dialog = (page: Page) => page.getByRole('dialog', { name: /./ }).last();

test('imports a Beli export: lists, scores, problem places, add, then undo from Settings', async ({ page }) => {
  test.setTimeout(60_000); // A whole import: ~50 lookups, then two list writes
  await openImportFromSettings(page);
  await expect(page.getByRole('heading', { name: 'Bring your Beli rankings' })).toBeVisible();

  await page.getByTestId('beli-file-input').setInputFiles({
    name: 'beli_data_export.zip',
    mimeType: 'application/zip',
    buffer: Buffer.from(syntheticBeliZip({ restaurants: 40 })),
  });

  // What's coming: 40 + 4 + 2 + 1 rankings in 4 lists, 3 want-to-try places
  await expect(page.getByRole('heading', { name: 'Found 47 rankings and 3 places to try' })).toBeVisible();
  await expect(page.getByRole('switch', { name: /Restaurants/ })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('button', { name: 'Continue' }).click();

  // Scores while places are looked up: point at where "It was fine" starts, answer the picks
  await expect(page.getByText(/Finding places on Google Maps|Looked up all/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Where does “It was fine” start?' })).toBeVisible();
  await page.getByRole('radio', { name: /^#30 / }).click();
  await page.getByRole('button', { name: 'None I didn’t like' }).click();
  const better = page.getByRole('heading', { name: 'Which was better?' });
  while (await better.isVisible()) {
    await page.getByRole('button', { name: 'Too close to call' }).click();
  }
  await expect(page.getByRole('heading', { name: 'How did these feel?' })).toBeVisible();
  const top = page.getByRole('slider').first();
  await top.focus();
  await page.keyboard.press('End'); // #1 felt as good as it gets
  await expect(top).toHaveAttribute('aria-valuetext', /Flawless/);
  await expect(page.getByRole('region', { name: 'Preview' })).toBeVisible();

  // The other lists get suggested scores
  await page.getByRole('button', { name: 'Use suggested' }).click();
  await expect(page.getByRole('heading', { name: /places? needs? you/ })).toBeVisible({ timeout: 30_000 });

  // A chain branch: pick the first candidate
  const firstChoice = page.getByRole('radiogroup', { name: /^Which Lucky/ }).first().getByRole('radio').first();
  await firstChoice.click();
  await expect(page.getByText(/^✓ Lucky/).first()).toBeVisible();

  // Not found: keep one without a pin
  await page.getByRole('tab', { name: /Not found/ }).click();
  await page.getByRole('button', { name: 'Keep without pin' }).first().click();
  await expect(page.getByText('✓ Kept without a map pin').first()).toBeVisible();

  // The matched list is windowed: far fewer rows rendered than matched
  await page.getByRole('tab', { name: 'Matched' }).click();
  const list = page.getByRole('list', { name: /matched places/ });
  await expect(list).toBeVisible();
  expect(await list.getByRole('listitem').count()).toBeLessThan(30);

  await page.getByRole('button', { name: 'Add to jelly' }).click();
  const confirm = page.getByRole('alertdialog');
  await expect(confirm.getByText(/They’re woven in among your spots by score/)).toBeVisible();
  await confirm.getByRole('button', { name: 'Add spots' }).click();

  await expect(page.getByRole('heading', { name: /spots are in jelly$/ })).toBeVisible();
  await expect(page.getByText(/^Imported \d+ spots from Beli$/)).toBeVisible();
  await page.getByRole('button', { name: /^See my Restaurants/ }).click();
  await expect(page.locator('main').getByText('Café Lumière')).toBeVisible();
  await expect(page.locator('main').getByText('Noodle Bar Uno')).toBeVisible();

  // Saved: still there after a reload
  await page.reload();
  await expect(page.locator('main').getByText('Café Lumière')).toBeVisible();

  // Undo from Settings takes the imported spots back out
  await page.getByRole('button', { name: /^Profile/ }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: /Undo Beli import/ }).click();
  await page.getByRole('button', { name: 'Undo import' }).click();
  await expect(page.getByText(/^Removed \d+ imported spots$/)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('main').getByText('Café Lumière')).toBeHidden();
  await expect(page.locator('main').getByText('Noodle Bar Uno')).toBeVisible();
});

test('without the file yet: the request email is filled in, and Settings remembers the wait', async ({ page }) => {
  await openImportFromSettings(page);
  await page.getByRole('button', { name: 'I don’t have it yet – ask Beli' }).click();
  await expect(page.getByRole('heading', { name: 'First, ask Beli for a copy' })).toBeVisible();
  await expect(page.getByText(/about 3 weeks/)).toBeVisible();

  await page.getByLabel('Your Beli username').fill('@sam.eats');
  const mail = page.getByRole('link', { name: 'Write the email' });
  const href = (await mail.getAttribute('href')) ?? '';
  expect(href.startsWith('mailto:support@beliapp.com?subject=Data%20export%20request&body=')).toBe(true);
  expect(decodeURIComponent(href)).toContain('Username: @sam.eats');
  expect(decodeURIComponent(href).toLowerCase()).not.toContain('phone');

  await page.getByRole('button', { name: 'I’ve sent it – remind me' }).click();
  await expect(page.getByRole('heading', { name: 'First, ask Beli for a copy' })).toBeHidden();
  await page.getByRole('button', { name: /^Profile/ }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByText(/^Waiting on Beli since /)).toBeVisible();
});

test('a file that isn’t the export says what was picked and what’s needed', async ({ page }) => {
  await openImportFromSettings(page);
  await page.getByTestId('beli-file-input').setInputFiles({
    name: 'user_profile.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(syntheticBeliTexts()['user_profile.csv']),
  });
  await expect(page.getByRole('alert')).toContainText('You picked user_profile.csv, which doesn’t include rankings.csv');
  await expect(dialog(page)).toBeVisible();
});
