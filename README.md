# GPHG 2026 Ballot

A friends' prediction pool for the 2026 Grand Prix d'Horlogerie de Genève. Static site on GitHub Pages plus a tiny pool API on Cloud Run.

Live: https://spencer-lightsource.github.io/gphg-game/

## How it works

- `index.html` — the game. Name → 14 category rounds → Aiguille d'Or → optional bonus prizes → review → lock. The locked ballot is encoded into a link (`?b=…`) and posted to the pool automatically (retried on every visit until it lands).
- `board.html` — standings. Reads the live pool (`GET /ballots`, `GET /results`) and falls back to `data/ballots.json` / `data/results.json`. Everyone's picks are visible as soon as they are in the pool. Compare tab shows overlap between any two people. Ballots lock Sat 7 Nov 2026, 18:00 Geneva.
- `commissioner.html` — owner tools. Shows the live pool; pasted links are posted into it. Pick winners → “Publish winners” sends them to the pool with the commissioner key (`PUT /results`, key stored only in that browser). GitHub-token publishing of the fallback files remains as a backup.
- `pool/` — the Cloud Run service (`server.js`): `POST /ballots` (validated, idempotent by code, server receipt time), `GET /ballots`, `GET /results`, `PUT /results` (needs `X-Key`). Project `gphg-ballot-2026`, region us-central1, data in Firestore. Redeploy with `gcloud run deploy gphg-pool --source pool --project gphg-ballot-2026 --region us-central1 --allow-unauthenticated --set-env-vars COMMISSIONER_KEY=…`.
- `assets/core.js` — data loading, ballot encode/decode, scoring, merge rules.

## Scoring

1 pt per category winner (14), 3 pts for the Aiguille d'Or, 1 bonus pt each for Audacity, Horological Revelation and Chronometry when the jury awards them. Max 20. Ties share a rank (more prizes called breaks a points tie; equal on both means a shared lead). One ballot per name; the latest ballot submitted before the lock counts; ballots received after the lock are excluded. The first submission from a device claims the name; later submissions under that name count only from the same device (or when added by the commissioner).

## Publishing results

```
cp ~/Downloads/ballots.json data/ballots.json
cp ~/Downloads/results.json data/results.json
git add data && git commit -m "Update pool" && git push
```

## Data

`data/watches.json` was built from gphg.org nominee pages on 5 Nov 2026 (84 watches, 14 categories). Watch ids are positions in that file and must never be reordered, because ballots reference them. Images are © Fondation du GPHG and the brands.
