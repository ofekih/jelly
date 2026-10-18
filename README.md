# jelly

A personal restaurant ranking app—rate spots on a gut-feeling spectrum, refine with quick side-by-side comparisons, and see how friends (and all jelly users) rate the same places.

Live at **https://eatwithjelly.com**.

## Features
- Gut-feeling rating spectrum (non-linear by default, linear toggle in settings) with side-by-side comparisons to place each spot precisely
- Drag-to-rerank list and map view with score pins
- Occasion (breakfast / lunch / dinner / dessert…) and cuisine filters
- Bookmarks (want-to-try), friends & followers, shared lists, "Eat Together" group blend
- Predicted ratings based on taste similarity with other users

## Stack
React 19 · TypeScript · Vite 6 · Tailwind v4 · Firebase (Hosting, Auth, Firestore, Analytics) · Google Places & Maps APIs · Vitest

## Development
```bash
npm install
npm run dev     # local dev server
npm test        # unit tests
npm run build   # type-check + production build
```

Deploy:
```bash
npx -y firebase-tools@latest deploy --only hosting --project ofek-beli-ranker
```

## For AI agents
See [`AGENTS.md`](./AGENTS.md) for the architecture map, data model, and conventions, and [`.agents/skills/jelly-ship`](./.agents/skills/jelly-ship/SKILL.md) for the ship workflow.
