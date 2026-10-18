---
name: jelly-ship
description: >-
  Test, build, deploy and push the jelly app (eatwithjelly.com). Use after making
  any change to the jelly repo that should go live, or when the user says
  "deploy", "ship", "push", or "make it live".
---

# Ship jelly

Run from the repo root.

1. **Verify**: `npm test && npm run build`. Fix every TS error or failing test before going on.
2. **Firestore rules (only if `firestore.rules` changed)**:
   `npx -y firebase-tools@latest deploy --only firestore:rules --project ofek-beli-ranker`
3. **Deploy hosting**:
   `npx -y firebase-tools@latest deploy --only hosting --project ofek-beli-ranker`
   and confirm the output contains `Deploy complete!`.
4. **Commit & push** (gpgsign must be disabled per-commit):
   `git add -A && git -c commit.gpgsign=false commit -m "<concise summary>" && git push origin main`
5. **Report** the short commit hash. If you changed icons or favicons, bump the `?v=N`
   query on the favicon `<link>` in `index.html` so browsers don't keep showing the old one.

Notes:
- Builds take ~5 s; deploys take ~10 s. Run them with enough wait time instead of polling.
- The >500 kB chunk-size warning from Vite is known and harmless.
