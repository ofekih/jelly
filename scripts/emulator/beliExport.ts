/**
 * Writes `scripts/emulator/beli-synthetic-export.zip`: a made-up Beli export in the real format
 * (src/lib/beliImport/fixtures.ts), to pick by hand when trying the import against `npm run dev:emu`.
 * Never put a real export here: real ones hold the person's email and phone number.
 *
 * Run: `npx tsx scripts/emulator/beliExport.ts [restaurants=60]`
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { syntheticBeliZip } from '../../src/lib/beliImport/fixtures';

const out = fileURLToPath(new URL('./beli-synthetic-export.zip', import.meta.url));
writeFileSync(out, syntheticBeliZip({ restaurants: Number(process.argv[2] ?? 60) }));
console.log(`Wrote ${out}`);
