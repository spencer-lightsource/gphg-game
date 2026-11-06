# GPHG 2026 Ballot

A friends' prediction pool for the 2026 Grand Prix d'Horlogerie de Genève. Static site, no backend.

Live: https://spencer-lightsource.github.io/gphg-game/

## How it works

- `index.html` — the game. Name → 14 category rounds → Aiguille d'Or → optional bonus prizes → review → lock. The locked ballot is encoded into a link (`?b=…`). Friends send that link to the commissioner.
- `board.html` — standings. Reads `data/ballots.json` and `data/results.json`. Picks stay sealed until the ceremony starts (Sat 7 Nov 2026, 18:00 Geneva). Anyone can paste extra ballot links to preview standings on their own device.
- `commissioner.html` — owner tools. Paste ballot links → download `ballots.json`. Pick winners → download `results.json`. Commit both into `data/` and push.
- `assets/core.js` — data loading, ballot encode/decode, scoring, merge rules.

## Scoring

1 pt per category winner (14), 3 pts for the Aiguille d'Or, 1 bonus pt each for Audacity, Horological Revelation and Chronometry when the jury awards them. Max 20. Ties: more prizes called, then the earlier ballot. One ballot per name; the latest ballot submitted before the lock counts; ballots timestamped after the lock are excluded.

## Publishing results

```
cp ~/Downloads/ballots.json data/ballots.json
cp ~/Downloads/results.json data/results.json
git add data && git commit -m "Update pool" && git push
```

## Data

`data/watches.json` was built from gphg.org nominee pages on 5 Nov 2026 (84 watches, 14 categories). Watch ids are positions in that file and must never be reordered, because ballots reference them. Images are © Fondation du GPHG and the brands.
