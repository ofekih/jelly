/**
 * One-off, idempotent backfill for the Phase 1 social data model. Run manually with the Admin SDK:
 *
 *   npm run backfill -- --project ofek-beli-ranker [--dry-run]
 *
 * 1. `profiles/{uid}` from every `sharedLists` doc (overwritten each run).
 * 2. `profiles/{target}/followers/{follower}` for every `followingIds` edge (existing edges keep
 *    their `createdAt`; edges are only added, never removed).
 * 3. `placeStats/*` recomputed from all users' ranked restaurants; stale stats docs are deleted.
 *
 * Uses Application Default Credentials (`gcloud auth application-default login`), or the emulator
 * when FIRESTORE_EMULATOR_HOST is set.
 */
import { initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore, type Firestore } from 'firebase-admin/firestore';
import { computePlaceStat, placeKeyOf, placeStatId, type PlaceKey, type RankedRow } from '../src/placeStats';
import { profileFromSharedList, sharedListOwner } from '../src/profiles';

interface Options {
  projectId: string;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Options {
  const dryRun = argv.includes('--dry-run');
  const i = argv.indexOf('--project');
  const projectId = (i >= 0 ? argv[i + 1] : undefined) || process.env.GCLOUD_PROJECT;
  if (!projectId) throw new Error('Pass --project <projectId>');
  return { projectId, dryRun };
}

export async function backfill(db: Firestore, { dryRun }: { dryRun: boolean }) {
  const writer = db.bulkWriter();
  const write = (fn: () => unknown) => {
    if (!dryRun) fn();
  };

  // Ranked restaurants per user (also gives an exact rankedCount, unlike the 500-capped snapshot)
  const restaurants = await db
    .collectionGroup('restaurants')
    .select('placeId', 'category', 'magicScore')
    .get();
  const rankedCountByUid = new Map<string, number>();
  const rowsByStat = new Map<string, { key: PlaceKey; rows: RankedRow[] }>();
  for (const d of restaurants.docs) {
    const userRef = d.ref.parent.parent;
    if (!userRef || userRef.parent.id !== 'users') continue;
    const uid = userRef.id;
    rankedCountByUid.set(uid, (rankedCountByUid.get(uid) || 0) + 1);
    const key = placeKeyOf(d.data());
    if (!key) continue;
    const id = placeStatId(key);
    if (!rowsByStat.has(id)) rowsByStat.set(id, { key, rows: [] });
    rowsByStat.get(id)!.rows.push({ uid, magicScore: d.get('magicScore') });
  }

  // 1 + 2. Profiles and follower edges
  const shared = await db.collection('sharedLists').get();
  const existingEdges = new Set(
    (await db.collectionGroup('followers').get()).docs
      .filter((d) => d.ref.parent.parent?.parent.id === 'profiles')
      .map((d) => d.ref.path)
  );
  let profiles = 0;
  let newEdges = 0;
  for (const d of shared.docs) {
    const uid = sharedListOwner(d.id, d.data());
    if (!uid) continue;
    const listCount = Array.isArray(d.get('restaurants')) ? d.get('restaurants').length : 0;
    const profile = profileFromSharedList(uid, d.data(), rankedCountByUid.get(uid) ?? listCount);
    profiles++;
    write(() =>
      writer.set(db.doc(`profiles/${uid}`), { ...profile, updatedAt: FieldValue.serverTimestamp() })
    );
    for (const target of profile.followingIds) {
      const ref = db.doc(`profiles/${target}/followers/${uid}`);
      if (existingEdges.has(ref.path)) continue;
      newEdges++;
      write(() => writer.set(ref, { createdAt: Date.now() }));
    }
  }

  // 3. placeStats: full recompute, delete docs nobody backs any more
  let stats = 0;
  for (const [id, { rows }] of rowsByStat) {
    const stat = computePlaceStat(rows);
    if (!stat) continue;
    stats++;
    write(() =>
      writer.set(db.doc(`placeStats/${id}`), { ...stat, updatedAt: FieldValue.serverTimestamp() })
    );
  }
  let staleStats = 0;
  for (const ref of await db.collection('placeStats').listDocuments()) {
    const entry = rowsByStat.get(ref.id);
    if (entry && computePlaceStat(entry.rows)) continue;
    staleStats++;
    write(() => writer.delete(ref));
  }

  await writer.close();
  return { sharedLists: shared.size, profiles, newEdges, stats, staleStats };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  initializeApp({ projectId: opts.projectId });
  const target = process.env.FIRESTORE_EMULATOR_HOST
    ? `emulator ${process.env.FIRESTORE_EMULATOR_HOST}`
    : `PRODUCTION project ${opts.projectId}`;
  console.log(`${opts.dryRun ? '[dry run] ' : ''}Backfilling ${target}…`);
  const result = await backfill(getFirestore(), opts);
  console.log(result);
  if (opts.dryRun) console.log('Dry run: nothing was written.');
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
