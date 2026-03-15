import type { Coord, MatchState, NetType, SummonState } from "@ddm/protocol";
import { applyNetTransform, coordKey } from "@ddm/protocol";

const DIRS: Coord[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 }
];

function getTile(state: MatchState, coord: Coord) {
  return state.board.find((tile) => tile.coord.x === coord.x && tile.coord.y === coord.y);
}

function movementCostPerTile(summon: SummonState): number {
  return summon.abilities.some((ability) => ability.kind === "FLY") ? 2 : 1;
}

function canTraverse(state: MatchState, summon: SummonState, coord: Coord, isFinal: boolean): boolean {
  const tile = getTile(state, coord);
  if (!tile) {
    return false;
  }
  const canIgnore = summon.abilities.some((ability) => ability.kind === "FLY" || ability.kind === "TUNNEL");
  if (tile.occupantId && tile.occupantId !== summon.id) {
    return canIgnore && !isFinal;
  }
  if (tile.state === "block") {
    return canIgnore && !isFinal;
  }
  if (tile.state === "empty" && !canIgnore) {
    return false;
  }
  return !isFinal || !tile.occupantId || tile.occupantId === summon.id;
}

export function legalMoves(state: MatchState, summonId: string): Coord[] {
  const summon = state.summons[summonId];
  if (!summon) {
    return [];
  }

  const queue = [{ coord: summon.tile, steps: 0 }];
  const seen = new Set<string>([coordKey(summon.tile)]);
  const results: Coord[] = [];
  const maxSteps = Math.floor(state.players[summon.ownerId].crests.MOVEMENT / movementCostPerTile(summon));

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const dir of DIRS) {
      const next = { x: current.coord.x + dir.x, y: current.coord.y + dir.y };
      const key = coordKey(next);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      if (!canTraverse(state, summon, next, true)) {
        continue;
      }
      results.push(next);
      if (current.steps + 1 < maxSteps) {
        queue.push({ coord: next, steps: current.steps + 1 });
      }
    }
  }

  return results;
}

export function shortestPath(state: MatchState, summonId: string, destination: Coord): Coord[] | null {
  const summon = state.summons[summonId];
  if (!summon) {
    return null;
  }

  const queue = [summon.tile];
  const parent = new Map<string, Coord | null>();
  parent.set(coordKey(summon.tile), null);

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (coordKey(current) === coordKey(destination)) {
      const path: Coord[] = [];
      let cursor: Coord | null = current;
      while (cursor) {
        path.unshift(cursor);
        cursor = parent.get(coordKey(cursor)) ?? null;
      }
      return path;
    }
    for (const dir of DIRS) {
      const next = { x: current.x + dir.x, y: current.y + dir.y };
      const key = coordKey(next);
      if (parent.has(key)) {
        continue;
      }
      const isFinal = coordKey(next) === coordKey(destination);
      if (!canTraverse(state, summon, next, isFinal)) {
        continue;
      }
      parent.set(key, current);
      queue.push(next);
    }
  }

  return null;
}

export function attackTargets(state: MatchState, summonId: string): string[] {
  const summon = state.summons[summonId];
  if (!summon) {
    return [];
  }
  return Object.values(state.summons)
    .filter((other) => other.ownerId !== summon.ownerId)
    .filter(
      (other) =>
        (other.tile.x === summon.tile.x && Math.abs(other.tile.y - summon.tile.y) <= summon.attackRange) ||
        (other.tile.y === summon.tile.y && Math.abs(other.tile.x - summon.tile.x) <= summon.attackRange)
    )
    .map((other) => other.id);
}

export function previewNet(type: NetType, rotation: number, orientation: 1 | -1, anchor: Coord | null): Coord[] {
  return applyNetTransform(type, rotation, orientation, anchor);
}
