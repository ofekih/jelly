import { beforeAll, describe, expect, it } from 'vitest';
import { buildCorpus, computeUserPredictions, toRankedDoc, type CorpusUser } from '../src/predictions';
import { MAX_WAIT_MS, QUIET_MS, recomputeAllPredictions, runPredictionJobs } from '../src/predictionJobs';
import { adminDb, clearProject } from './helpers';

// Same project the Functions emulator runs triggers for, so writes really mark jobs dirty
const PROJECT = 'demo-jelly';
const db = adminDb(PROJECT);

const entry = (placeId: string, magicScore: number, cuisines = ['Japanese']) => ({
  name: placeId, placeId, category: 'restaurants', cuisines, initialRating: 7, rankIndex: 0, magicScore,
});
const base: Array<[string, number]> = [['p1', 9.5], ['p2', 8.8], ['p3', 7.9], ['p4', 7.0], ['p5', 6.1]];

async function rank(uid: string, spots: Array<[string, number]>) {
  await Promise.all(spots.map(([id, s]) => db.doc(`users/${uid}/restaurants/${id}__restaurants`).set(entry(id, s))));
}

/** The pure model run on a brute-force read of everything in the emulator. */
async function expectedFor(uid: string) {
  const users = new Map<string, CorpusUser>();
  for (const d of (await db.collectionGroup('restaurants').get()).docs) {
    const owner = d.ref.parent.parent!.id;
    if (!users.has(owner)) users.set(owner, { uid: owner, entries: [] });
    const e = toRankedDoc(d.data());
    if (e) users.get(owner)!.entries.push(e);
  }
  const me = users.get(uid)!;
  me.bookmarks = (await db.collection(`users/${uid}/bookmarks`).get()).docs.map((d) => ({
    placeId: d.get('placeId'), name: d.get('name'), category: d.get('category'), cuisines: d.get('cuisines') ?? [],
  }));
  me.followingIds = (await db.doc(`profiles/${uid}`).get()).get('followingIds') ?? [];
  for (const id of me.followingIds!) {
    const name = (await db.doc(`profiles/${id}`).get()).get('displayName');
    if (name && users.has(id)) users.get(id)!.displayName = name;
  }
  return computeUserPredictions(buildCorpus([...users.values()]), uid);
}

// No predictions -> no doc
const stored = async (uid: string) => (await db.doc(`users/${uid}/private/predictions`).get()).get('spots') ?? {};

/** Waits until every user has a job and the triggers have stopped touching them. */
async function waitForJobs(uids: string[]) {
  const deadline = Date.now() + 20000;
  let last = '';
  let stableSince = Date.now();
  for (;;) {
    const docs = (await db.collection('predictionJobs').get()).docs;
    const state = docs.map((d) => `${d.id}@${d.updateTime.toMillis()}`).sort().join(',');
    if (state !== last) [last, stableSince] = [state, Date.now()];
    const ids = docs.map((d) => d.id);
    if (uids.every((u) => ids.includes(u)) && Date.now() - stableSince > 1500) return;
    if (Date.now() > deadline) throw new Error(`jobs never settled: ${state}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

describe('taste predictions (Functions emulator)', () => {
  beforeAll(() => clearProject(PROJECT));

  it('ranking marks jobs dirty; the debounced run writes what the pure model says, guard included', async () => {
    await rank('me', base);
    await db.doc('users/me/bookmarks/bm__restaurants').set({ name: 'bm', placeId: 'bm', category: 'restaurants', cuisines: ['Japanese'] });
    // Three people with my taste rank "three"; only two of them rank "two"
    await rank('a', [...base.map(([p, s]): [string, number] => [p, s - 1]), ['three', 8.5], ['two', 8.5], ['bm', 9]]);
    await rank('b', [...base.map(([p, s]): [string, number] => [p, s - 0.5]), ['three', 9], ['two', 9], ['bm', 9.2]]);
    await rank('c', [...base.map(([p, s]): [string, number] => [p, s - 1.5]), ['three', 8], ['bm', 8.6]]);
    await waitForJobs(['me', 'a', 'b', 'c']);

    // Still within the quiet period: nothing runs yet
    expect(await runPredictionJobs(db, Date.now())).toEqual([]);
    const ran = await runPredictionJobs(db, Date.now() + QUIET_MS + 1000);
    expect(ran.sort()).toEqual(['a', 'b', 'c', 'me']);
    expect((await db.collection('predictionJobs').get()).size).toBe(0);

    const mine = await stored('me');
    expect(mine).toEqual(await expectedFor('me'));
    expect(Object.keys(mine).sort()).toEqual(['bm__restaurants', 'three__restaurants']);
    expect(mine['three__restaurants'].raters).toBe(3);
    // "two" only has two taste-matched raters: no prediction at all
    expect(mine['two__restaurants']).toBeUndefined();
    expect(JSON.stringify(mine)).not.toMatch(/\b[abc]\b/);
  });

  it('a busy user is recomputed after the max wait even if they never go quiet', async () => {
    await rank('me', [['p6', 5]]);
    await waitForJobs(['me']);
    expect(await runPredictionJobs(db, Date.now())).toEqual([]);
    expect(await runPredictionJobs(db, Date.now() + MAX_WAIT_MS + 1000)).toEqual(['me']);
    expect(await stored('me')).toEqual(await expectedFor('me'));
  });

  it('nightly recompute picks up followed friends and other people\'s changes', async () => {
    await db.doc('profiles/me').set({ followingIds: ['d'], rankedCount: 6 });
    await db.doc('profiles/d').set({ displayName: 'Dana', followingIds: [], rankedCount: 6 });
    await rank('d', [...base.map(([p, s]): [string, number] => [p, s - 1]), ['two', 9]]);
    await recomputeAllPredictions(db);
    const mine = await stored('me');
    expect(mine).toEqual(await expectedFor('me'));
    expect(mine['two__restaurants'].basis).toMatch(/^Based on Dana/);
    for (const uid of ['a', 'b', 'c', 'd']) expect(await stored(uid)).toEqual(await expectedFor(uid));
  });
});

describe('profile changes queue prediction recomputes (Functions emulator)', () => {
  const jobIds = async () => (await db.collection('predictionJobs').get()).docs.map((d) => d.id).sort();
  const settle = () => new Promise((r) => setTimeout(r, 3000));

  // Clearing deletes ranked spots, whose triggers queue jobs: let them land, then drop them
  beforeAll(async () => {
    await clearProject(PROJECT);
    await settle();
    await clearProject(PROJECT);
  });

  it('follow changes mark me dirty; other profile fields do not', async () => {
    await db.doc('profiles/me').set({ followingIds: [], rankedCount: 0 });
    await db.doc('profiles/me').update({ rankedCount: 3 });
    await settle();
    expect(await jobIds()).toEqual([]);

    await db.doc('profiles/me').update({ followingIds: ['d'] });
    await waitForJobs(['me']);
    expect(await jobIds()).toEqual(['me']);
  });

  it('a new display name marks the people who follow them dirty', async () => {
    await db.doc('profiles/d').set({ displayName: 'Dana', followingIds: [], rankedCount: 1 });
    await db.doc('profiles/d/followers/me').set({ createdAt: Date.now() });
    await settle();
    await db.doc('predictionJobs/me').delete();

    await db.doc('profiles/d').update({ displayName: 'Dana R' });
    await waitForJobs(['me']);
    expect(await jobIds()).toEqual(['me']);
  });
});
