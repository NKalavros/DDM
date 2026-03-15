# Dungeon Dice Monsters Web Remake

This repository contains a web-based remake of Yu-Gi-Oh! Dungeon Dice Monsters with:

- a React/Vite client
- an authoritative Fastify + Socket.IO multiplayer server
- a shared deterministic TypeScript rules engine
- a data-driven content pipeline imported from the Godot remake reference
- a CSS-perspective board view with player-relative orientation

The current scope is the v1 feature set from `FEATURES.md`: monsters, dice, rolling, dimensioning, rotate/flip/change-shape net controls, player crest/hearts state, deckbuilding, movement, attacking, defending, abilities with `FLY` and `TUNNEL`, and lightweight animations.

## What Players Can Do

- Create a private room or join one by room code
- Pick a starter deck or build a local custom 15-die deck
- Roll exactly 3 unused dice on your turn
- Convert matching summon rolls into a dimension action
- Change net shape, rotate, flip, inspect die faces, and place the dimension anchor on the board
- Move monsters multiple times per turn by spending movement crests per square
- Attack enemy monsters and Monster Lords by spending attack crests
- Guard during the defense window by spending defense crests
- Use roll-priority shortcuts for `MOVEMENT`, `ATTACK`, `DEFENSE`, `MAGIC`, and `TRAP`
- Play monsters with `FLY` and `TUNNEL`
- See the match board from your own side, with player labels marked as `YOU` / `OPPONENT`

## Quickstart

### Prerequisites

- Node.js 22+ with Corepack

### Install

```bash
corepack pnpm install
```

### Run In Development

This command regenerates content and prebuilds the shared packages before starting the server and Vite client:

```bash
corepack pnpm dev
```

Default local URLs:

- client: `http://127.0.0.1:5173`
- server: `http://127.0.0.1:3000`

### Production Build

```bash
corepack pnpm build
node apps/server/dist/index.js
```

### Docker / Fly

- Docker image entrypoint is defined in `Dockerfile`
- Fly deployment config is in `fly.toml`

## How To Play The Current Build

1. Enter a player name and create or join a room.
2. Pick a deck from the deck dropdown. Starter decks are generated from supported imported dice; custom decks are stored locally in the browser.
3. Ready both players to start the match.
4. On your roll phase, select exactly 3 unused dice and roll them.
5. If you roll at least two summon faces of the same level, choose one eligible die to dimension.
6. During dimensioning, inspect the die faces if needed, then click a board tile to set the anchor. You can adjust shape/rotation/flip before confirming, and arrow keys also control the net preview.
7. During the action phase, select one of your summons and:
   - `Move` to a highlighted destination. You can move the same summon more than once in the turn if you still have movement crests.
   - `Attack` an enemy target in range
   - `End Turn`
8. If your summon is attacked and you are the defender, choose:
   - `Guard` to spend one defense crest and reduce damage by the defender's defense value
   - `Take Hit` to take full damage

Movement costs in the current build:

- normal summons: `1` movement crest per tile
- `FLY` summons: `2` movement crests per tile

## Deck Builder

The deck builder is in the left sidebar under `Deck Builder`.

- Add dice from the filtered imported catalog
- Remove dice from the current slot list
- Save decks to browser localStorage
- Copy decks as JSON
- Import decks from pasted JSON

The crest summary above the deck picker helps compare decks by crest output. During matches, the roll UI also includes priority buttons that auto-select the best 3 available dice for a target crest type.

## Project Layout

- `apps/web`: user interface, CSS-perspective board view, lobby/deckbuilder UX
- `apps/server`: private-room multiplayer server and match orchestration
- `packages/protocol`: shared schemas, state types, commands, server events, net geometry
- `packages/content`: content importer and generated playable catalog
- `packages/engine`: deterministic match rules

For a feature-by-feature maintainer map, see [docs/FEATURE_IMPLEMENTATION_MAP.md](docs/FEATURE_IMPLEMENTATION_MAP.md).

## Tests

### Unit / Integration

```bash
corepack pnpm test
```

Current automated coverage includes:

- content import normalization and supported ability filtering
- roll resolution and dimension eligibility
- dimension rotate/flip coordinate updates
- multiple-move-per-turn behavior and movement cost rules
- flying movement costing 2 crests per tile
- movement and dimension legality previews on the client
- attack/defense reply resolution
- `TUNNEL` movement through blocked intermediate tiles
- lobby creation/joining and match startup
- explicit resync responses

### End-To-End

Install the Playwright browser once:

```bash
corepack pnpm exec playwright install chromium
```

Then run:

```bash
corepack pnpm test:e2e
```

This currently runs a smoke test that boots the built app and verifies the lobby shell renders.

## Current Limits

- Only monsters with no abilities or with `FLY` / `TUNNEL` are included in the playable v1 catalog.
- Match state is stored in server memory. There is no database or account system yet.
- Animations are intentionally lightweight and UI-driven; there is no physics-based die outcome simulation.
- The board presentation is a stylized CSS perspective view rather than a full 3D camera scene.
