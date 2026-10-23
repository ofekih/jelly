import { Auth, signInWithEmailAndPassword } from 'firebase/auth';

/**
 * The seeded test account (`scripts/emulator/seed.ts`). Emulator-only credentials: the Auth
 * emulator holds no real accounts.
 */
export const TEST_USER = {
  uid: 'test-sam',
  email: 'sam@jelly.test',
  password: 'emulator-only-password',
  name: 'Sam Tester',
  handle: 'samtester',
};

const SIGNED_IN_ONCE_KEY = 'jelly_emulator_signed_in';

/**
 * Signs the tab in as the test user the first time it opens (so signing out sticks for the
 * session), and marks the page so it can't be mistaken for production.
 */
export async function startEmulatorSession(auth: Auth): Promise<void> {
  const badge = document.createElement('div');
  badge.textContent = 'Emulator';
  badge.setAttribute('aria-hidden', 'true');
  badge.style.cssText =
    'position:fixed;left:8px;bottom:8px;z-index:9999;padding:2px 8px;border-radius:9999px;' +
    'background:#f59e0b;color:#18181b;font:600 10px/1.6 system-ui;pointer-events:none;opacity:.9';
  document.body.appendChild(badge);

  await auth.authStateReady();
  if (auth.currentUser || sessionStorage.getItem(SIGNED_IN_ONCE_KEY)) return;
  sessionStorage.setItem(SIGNED_IN_ONCE_KEY, '1');
  await signInWithEmailAndPassword(auth, TEST_USER.email, TEST_USER.password);
}
