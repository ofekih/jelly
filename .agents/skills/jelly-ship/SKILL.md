---
name: jelly-ship
description: >-
  Test, build, deploy and push the jelly app (eatwithjelly.com). Use after making
  any change to the jelly repo that should go live, or when the user says
  "deploy", "ship", "push", or "make it live".
---

# Ship jelly

Run from the repo root.

1. **Changelog (only if users can see the change)**: add bullets to the newest entry in
   `src/lib/changelog.ts`, or start a new entry on top and bump `version` in both
   `package.json` and `package-lock.json` to match (a test enforces this). A new minor
   (`2.1.0`) for features, a new major (`3.0.0`) for big shifts; these show a dot on Settings
   until users open "What's new". Patch (`2.0.1`) for small tweaks worth noting quietly.
   Skip for fixes and internal work. Write plain user-facing bullets, no internal names.
2. **Verify**: `npm test && npm run build`. Fix every TS error or failing test before going on.
3. **Firestore rules (only if `firestore.rules` changed)**:
   `npx -y firebase-tools@latest deploy --only firestore:rules --project ofek-beli-ranker`
4. **Deploy hosting**:
   `npx -y firebase-tools@latest deploy --only hosting --project ofek-beli-ranker`
   and confirm the output contains `Deploy complete!`.
5. **Commit & push** (gpgsign must be disabled per-commit):
   `git add -A && git -c commit.gpgsign=false commit -m "<concise summary>" && git push origin main`
6. **Report** the short commit hash. If you changed icons or favicons, bump the `?v=N`
   query on the favicon `<link>` in `index.html` so browsers don't keep showing the old one.

Notes:
- Builds take ~5 s; deploys take ~10 s. Run them with enough wait time instead of polling.
- The >500 kB chunk-size warning from Vite is known and harmless.
