import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { deleteObject, getBytes, listAll, ref, uploadBytes } from 'firebase/storage';

// storage.rules: uploaded profile pictures (src/lib/profilePhoto.ts)
let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-jelly-rules',
    storage: { rules: readFileSync(resolve(__dirname, '../../storage.rules'), 'utf8') },
  });
});
afterAll(() => env.cleanup());
beforeEach(async () => {
  await env.clearStorage();
  await env.withSecurityRulesDisabled(async (ctx) => {
    await uploadBytes(ref(ctx.storage(), 'profilePhotos/bob/old.webp'), bytes(10), { contentType: 'image/webp' });
  });
});

const bytes = (n: number) => new Uint8Array(n).fill(7);
const anon = () => env.unauthenticatedContext().storage();
const as = (uid: string) => env.authenticatedContext(uid).storage();
const webp = { contentType: 'image/webp' };

describe('profilePhotos/{uid}/{file}', () => {
  it('the owner can upload a WebP or JPEG and delete it', async () => {
    await assertSucceeds(uploadBytes(ref(as('alice'), 'profilePhotos/alice/m1-abc.webp'), bytes(40_000), webp));
    await assertSucceeds(
      uploadBytes(ref(as('alice'), 'profilePhotos/alice/m2_abc.jpg'), bytes(40_000), { contentType: 'image/jpeg' })
    );
    await assertSucceeds(deleteObject(ref(as('alice'), 'profilePhotos/alice/m1-abc.webp')));
  });

  it('anyone can fetch a picture, but nobody can list a folder', async () => {
    await assertSucceeds(getBytes(ref(anon(), 'profilePhotos/bob/old.webp')));
    await assertFails(listAll(ref(anon(), 'profilePhotos/bob')));
    await assertFails(listAll(ref(as('bob'), 'profilePhotos/bob')));
  });

  it("nobody can write or delete someone else's pictures", async () => {
    await assertFails(uploadBytes(ref(anon(), 'profilePhotos/alice/a.webp'), bytes(10), webp));
    await assertFails(uploadBytes(ref(as('mallory'), 'profilePhotos/bob/old.webp'), bytes(10), webp));
    await assertFails(deleteObject(ref(as('mallory'), 'profilePhotos/bob/old.webp')));
    await assertFails(deleteObject(ref(anon(), 'profilePhotos/bob/old.webp')));
  });

  it('rejects big files, other types, odd names and other paths', async () => {
    const alice = as('alice');
    await assertFails(uploadBytes(ref(alice, 'profilePhotos/alice/big.webp'), bytes(1024 * 1024), webp));
    await assertFails(
      uploadBytes(ref(alice, 'profilePhotos/alice/a.webp'), bytes(10), { contentType: 'image/svg+xml' })
    );
    await assertFails(uploadBytes(ref(alice, 'profilePhotos/alice/a.webp'), bytes(10), { contentType: 'text/html' }));
    await assertFails(uploadBytes(ref(alice, 'profilePhotos/alice/a.png'), bytes(10), { contentType: 'image/png' }));
    await assertFails(uploadBytes(ref(alice, 'profilePhotos/alice/nested/a.webp'), bytes(10), webp));
    await assertFails(uploadBytes(ref(alice, 'other/alice/a.webp'), bytes(10), webp));
  });
});
