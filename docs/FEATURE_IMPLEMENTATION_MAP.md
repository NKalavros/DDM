# Feature Implementation Map

This document maps every item in `FEATURES.md` to the current codebase so a future agent can continue work without rediscovering the architecture.

## Architecture Summary

- Shared schemas and state contracts live in `packages/protocol/src/index.ts`
- Imported dice/monster content lives in `packages/content/src/normalize.ts` and `packages/content/generated/catalog.generated.ts`
- Match rules live in `packages/engine/src/index.ts`
- Multiplayer room flow lives in `apps/server/src/app.ts`
- User interactions live in `apps/web/src/App.tsx`
- 3D board rendering lives in `apps/web/src/Board3D.tsx`
- Client-side board previews/path helpers live in `apps/web/src/board-helpers.ts`

## Feature Matrix

| `FEATURES.md` item | Current implementation | Main files | Notes |
| --- | --- | --- | --- |
| Monster | Implemented | `packages/protocol/src/index.ts`, `packages/engine/src/index.ts`, `packages/content/generated/catalog.generated.ts` | Monster definitions are normalized into protocol-level `MonsterDefinition` objects and instantiated as `SummonState`. |
| Monster Dice | Implemented | `packages/protocol/src/index.ts`, `packages/content/src/normalize.ts`, `apps/web/src/App.tsx` | Dice are explicit six-face objects and are selectable in the deckbuilder and roll UI. |
| Dice attributes | Implemented | `packages/protocol/src/index.ts`, `packages/content/src/normalize.ts` | `DieFace` supports summon faces and crest faces with explicit crest type and amount. |
| Health | Implemented | `packages/protocol/src/index.ts`, `packages/engine/src/index.ts`, `apps/web/src/App.tsx` | Monsters and Monster Lords track health; player hearts are derived from Monster Lord health. |
| Attack | Implemented | `packages/protocol/src/index.ts`, `packages/engine/src/index.ts`, `apps/web/src/App.tsx` | Attack stats are part of both definitions and runtime summon state. |
| Defense | Implemented | `packages/protocol/src/index.ts`, `packages/engine/src/index.ts`, `apps/web/src/App.tsx` | Defense stat reduces damage only when the defender chooses `Guard`. |
| Dice Rolling | Implemented | `packages/engine/src/index.ts`, `apps/web/src/App.tsx` | Server-authoritative `submit_roll` resolves rolled faces and crest gains. |
| Dimensioning | Implemented | `packages/protocol/src/index.ts`, `packages/engine/src/index.ts`, `apps/web/src/App.tsx`, `apps/web/src/Board3D.tsx` | Matching summon rolls open a dimension step with a live net preview. |
| Change shape | Implemented | `packages/protocol/src/index.ts`, `packages/engine/src/index.ts`, `apps/web/src/App.tsx` | Exposed as `set_dimension_net`; current UI supports all Godot net types. |
| Rotate | Implemented | `packages/protocol/src/index.ts`, `packages/engine/src/index.ts`, `apps/web/src/App.tsx` | Rotation and flip both recompute server-validated net coordinates. |
| Player attributes | Implemented | `packages/protocol/src/index.ts`, `packages/engine/src/index.ts`, `apps/web/src/App.tsx` | Name, hearts, crest pools, deck, dice pool, and summoned monsters are tracked per player. |
| Deck | Implemented | `packages/protocol/src/index.ts`, `packages/content/src/index.ts`, `apps/web/src/App.tsx`, `apps/server/src/app.ts` | Decks are 15-die lists, stored locally on the client and validated on the server. |
| Crest prioritization | Implemented as deck-summary support | `apps/web/src/App.tsx` | Current implementation is a crest summary and filtering aid in the deck UI, not AI/autoplay logic. |
| Moving | Implemented | `packages/engine/src/index.ts`, `apps/web/src/board-helpers.ts`, `apps/web/src/App.tsx` | Movement costs crests and uses validated path submission. |
| Attacking | Implemented | `packages/engine/src/index.ts`, `apps/web/src/App.tsx` | Attacks open a reply window instead of resolving immediately. |
| Defending | Implemented | `packages/engine/src/index.ts`, `apps/web/src/App.tsx` | Defender chooses `guard` or `take_hit`. |
| Abilities | Partially implemented | `packages/protocol/src/index.ts`, `packages/engine/src/index.ts`, `packages/content/src/normalize.ts` | Ability framework exists; only `FLY` and `TUNNEL` are playable in v1. |
| Flying | Implemented | `packages/engine/src/index.ts`, `apps/web/src/board-helpers.ts` | `FLY` currently allows traversal over blocked/intermediate occupied tiles and empty terrain. |
| Tunneling | Implemented | `packages/engine/src/index.ts`, `apps/web/src/board-helpers.ts` | `TUNNEL` currently uses the same traversal model as `FLY` for v1 movement. |
| Animations | Implemented, lightweight | `apps/web/src/Board3D.tsx`, `apps/web/src/styles.css` | Board is rendered in 3D, die cards animate on roll, dimension previews elevate tiles. |

## Tests That Cover These Features

- `packages/content/test/content.test.ts`
  - content normalization
  - supported vs unsupported ability filtering
- `packages/engine/test/engine.test.ts`
  - roll resolution
  - dimension availability
  - net rotation and flip updates
  - movement costs
  - guard/defense resolution
  - `TUNNEL` traversal through blocked intermediate tiles
- `apps/server/test/server.test.ts`
  - room creation and joining
  - ready-up to match start
  - explicit resync behavior
- `tests/e2e/smoke.spec.ts`
  - built app boots and renders the lobby shell

## Pickup Notes For The Next Agent

- The content importer intentionally filters the playable catalog to monsters with no abilities or only `FLY` / `TUNNEL`. Expanding the catalog means extending `mapAbilities()` in `packages/content/src/normalize.ts` and then adding engine behavior in `packages/engine/src/index.ts`.
- If deckbuilding should become server-persistent, the first cut point is `choose_deck` in `apps/server/src/app.ts`; there is no persistence layer yet.
- If client-side movement and attack previews start drifting from server rules, compare `apps/web/src/board-helpers.ts` against the canonical logic in `packages/engine/src/index.ts`.
- The root `dev` script prebuilds shared packages because the server and web app currently consume built workspace outputs.
