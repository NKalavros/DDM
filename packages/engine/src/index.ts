import type {
  BoardTile,
  ClientCommand,
  Coord,
  CrestType,
  DeckDefinition,
  DieDefinition,
  DieFace,
  MatchState,
  MonsterDefinition,
  NetState,
  PlayerId,
  SummonState
} from "@ddm/protocol";
import {
  applyNetTransform,
  BOARD_HEIGHT,
  BOARD_WIDTH,
  coordKey,
  emptyCrests,
  matchStateSchema
} from "@ddm/protocol";

export type RulesCatalog = {
  monstersById: Record<string, MonsterDefinition>;
  diceById: Record<string, DieDefinition>;
};

export type EngineResult =
  | { ok: true; state: MatchState }
  | { ok: false; reason: string; state: MatchState };

type MatchSetup = {
  matchId: string;
  roomCode: string;
  players: Record<PlayerId, { name: string; deck: DeckDefinition }>;
};

const LORD_DEFINITION: MonsterDefinition = {
  id: "monster-lord",
  name: "Monster Lord",
  type: "LORD",
  level: 0,
  attack: 10,
  defense: 0,
  health: 30,
  movement: 1,
  attackRange: 1,
  abilities: []
};

const STARTING_LORD_COORDS: Record<PlayerId, Coord> = {
  p1: { x: 6, y: 18 },
  p2: { x: 6, y: 0 }
};

const DIRS: Coord[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 }
];

function makeBoard(): BoardTile[] {
  const tiles: BoardTile[] = [];
  for (let y = 0; y < BOARD_HEIGHT; y += 1) {
    for (let x = 0; x < BOARD_WIDTH; x += 1) {
      tiles.push({
        coord: { x, y },
        state: "empty",
        ownerId: null,
        occupantId: null
      });
    }
  }
  return tiles;
}

function getTile(board: BoardTile[], coord: Coord): BoardTile | undefined {
  if (coord.x < 0 || coord.x >= BOARD_WIDTH || coord.y < 0 || coord.y >= BOARD_HEIGHT) {
    return undefined;
  }
  return board[coord.y * BOARD_WIDTH + coord.x];
}

function getNeighbors(coord: Coord): Coord[] {
  return DIRS.map((dir) => ({ x: coord.x + dir.x, y: coord.y + dir.y }));
}

function addLog(state: MatchState, type: string, message: string): void {
  state.log.push({
    id: `${state.id}:${state.log.length + 1}`,
    timestamp: Date.now(),
    type,
    message
  });
}

function rollFace(die: DieDefinition, rng: () => number): DieFace {
  const index = Math.max(0, Math.min(die.faces.length - 1, Math.floor(rng() * die.faces.length)));
  return die.faces[index]!;
}

function updateLordHearts(state: MatchState, playerId: PlayerId): void {
  const lordId = state.players[playerId].monsterLordId;
  const lord = state.summons[lordId];
  state.players[playerId].hearts = Math.max(0, Math.min(3, Math.ceil(lord.health / 10)));
}

function currentPlayerOwns(state: MatchState, playerId: PlayerId, summonId: string): boolean {
  return state.summons[summonId]?.ownerId === playerId;
}

function findDieInstanceIndex(state: MatchState, playerId: PlayerId, instanceId: string): number {
  return state.players[playerId].dicePool.findIndex((instance) => instance.instanceId === instanceId);
}

function assertActivePlayer(state: MatchState, playerId: PlayerId): string | null {
  if (state.activePlayerId !== playerId) {
    return "It is not your turn.";
  }
  return null;
}

function spendCrest(state: MatchState, playerId: PlayerId, crest: CrestType, amount: number): boolean {
  const pool = state.players[playerId].crests;
  if (pool[crest] < amount) {
    return false;
  }
  pool[crest] -= amount;
  return true;
}

function hasAbility(summon: SummonState, kind: "FLY" | "TUNNEL"): boolean {
  return summon.abilities.some((ability) => ability.kind === kind);
}

function movementCostPerTile(summon: SummonState): number {
  return hasAbility(summon, "FLY") ? 2 : 1;
}

function isStraightLineInRange(a: Coord, b: Coord, range: number): boolean {
  if (a.x === b.x) {
    return Math.abs(a.y - b.y) <= range;
  }
  if (a.y === b.y) {
    return Math.abs(a.x - b.x) <= range;
  }
  return false;
}

function validatePath(path: Coord[]): boolean {
  for (let i = 1; i < path.length; i += 1) {
    const dx = Math.abs(path[i]!.x - path[i - 1]!.x);
    const dy = Math.abs(path[i]!.y - path[i - 1]!.y);
    if (dx + dy !== 1) {
      return false;
    }
  }
  return true;
}

function canTraverseTile(state: MatchState, mover: SummonState, coord: Coord, isFinal: boolean): boolean {
  const tile = getTile(state.board, coord);
  if (!tile) {
    return false;
  }

  const canFly = hasAbility(mover, "FLY");
  const canTunnel = hasAbility(mover, "TUNNEL");
  const canIgnoreTerrain = canFly || canTunnel;

  if (tile.occupantId && tile.occupantId !== mover.id) {
    return canIgnoreTerrain && !isFinal;
  }

  if (tile.state === "block") {
    return canIgnoreTerrain && !isFinal;
  }

  if (tile.state === "empty" && !canIgnoreTerrain) {
    return false;
  }

  return !(isFinal && tile.occupantId && tile.occupantId !== mover.id);
}

function removeSummon(state: MatchState, summonId: string): void {
  const summon = state.summons[summonId];
  if (!summon) {
    return;
  }

  const tile = getTile(state.board, summon.tile);
  if (tile) {
    tile.occupantId = null;
  }
  state.players[summon.ownerId].summonIds = state.players[summon.ownerId].summonIds.filter((id) => id !== summonId);
  delete state.summons[summonId];
}

function resolveDamage(state: MatchState, summonId: string, damage: number, attackerOwnerId: PlayerId): void {
  const target = state.summons[summonId];
  if (!target) {
    return;
  }

  target.health -= damage;
  if (target.kind === "monster_lord") {
    updateLordHearts(state, target.ownerId);
  }

  if (target.health > 0) {
    return;
  }

  if (target.kind === "monster_lord") {
    state.winnerId = attackerOwnerId;
    state.phase = "game_over";
    addLog(state, "game_over", `${attackerOwnerId} defeated the enemy Monster Lord.`);
    return;
  }

  removeSummon(state, summonId);
  addLog(state, "summon_destroyed", `${target.definitionId} was destroyed.`);
}

function ensureNetCoordinates(pending: NetState): NetState {
  return {
    ...pending,
    coordinates: applyNetTransform(pending.type, pending.rotation, pending.orientation, pending.anchor)
  };
}

function canDimension(state: MatchState, playerId: PlayerId, net: NetState): boolean {
  if (!net.anchor) {
    return false;
  }

  const coords = net.coordinates;
  for (const coord of coords) {
    const tile = getTile(state.board, coord);
    if (!tile || tile.state !== "empty" || tile.occupantId) {
      return false;
    }
  }

  return coords.some((coord) =>
    getNeighbors(coord).some((neighbor) => {
      const tile = getTile(state.board, neighbor);
      if (!tile) {
        return false;
      }
      if (tile.ownerId === playerId && (tile.state === "path" || tile.state === "lord")) {
        return true;
      }
      if (!tile.occupantId) {
        return false;
      }
      return state.summons[tile.occupantId]?.ownerId === playerId;
    })
  );
}

function setTilePath(state: MatchState, coord: Coord, ownerId: PlayerId): void {
  const tile = getTile(state.board, coord);
  if (!tile) {
    return;
  }
  tile.state = "path";
  tile.ownerId = ownerId;
}

export function createMatchState(setup: MatchSetup, catalog: RulesCatalog): MatchState {
  const board = makeBoard();
  const summons: Record<string, SummonState> = {};
  const players = {
    p1: {
      id: "p1" as const,
      name: setup.players.p1.name,
      hearts: 3,
      crests: emptyCrests(),
      deck: setup.players.p1.deck,
      dicePool: setup.players.p1.deck.dieIds.map((dieId, index) => ({
        dieId,
        instanceId: `p1-${index + 1}`,
        used: false,
        lastRoll: null
      })),
      summonIds: [] as string[],
      monsterLordId: "p1-lord"
    },
    p2: {
      id: "p2" as const,
      name: setup.players.p2.name,
      hearts: 3,
      crests: emptyCrests(),
      deck: setup.players.p2.deck,
      dicePool: setup.players.p2.deck.dieIds.map((dieId, index) => ({
        dieId,
        instanceId: `p2-${index + 1}`,
        used: false,
        lastRoll: null
      })),
      summonIds: [] as string[],
      monsterLordId: "p2-lord"
    }
  };

  (["p1", "p2"] as PlayerId[]).forEach((playerId) => {
    const summonId = `${playerId}-lord`;
    const tile = getTile(board, STARTING_LORD_COORDS[playerId]);
    if (!tile) {
      return;
    }

    tile.state = "lord";
    tile.ownerId = playerId;
    tile.occupantId = summonId;

    summons[summonId] = {
      id: summonId,
      ownerId: playerId,
      definitionId: LORD_DEFINITION.id,
      kind: "monster_lord",
      tile: STARTING_LORD_COORDS[playerId],
      health: LORD_DEFINITION.health,
      attack: LORD_DEFINITION.attack,
      defense: LORD_DEFINITION.defense,
      movement: LORD_DEFINITION.movement,
      attackRange: LORD_DEFINITION.attackRange,
      abilities: [],
      hasMoved: false,
      hasAttacked: false,
      guarding: false
    };
    players[playerId].summonIds.push(summonId);
  });

  const state: MatchState = {
    id: setup.matchId,
    roomCode: setup.roomCode,
    phase: "roll",
    activePlayerId: "p1",
    players,
    board,
    summons,
    pendingRoll: null,
    pendingDimension: null,
    actionWindow: null,
    winnerId: null,
    turn: 1,
    log: []
  };

  addLog(state, "match_started", "Match started.");
  return matchStateSchema.parse(state);
}

export function reduceMatchState(
  inputState: MatchState,
  playerId: PlayerId,
  command: Exclude<ClientCommand, { type: "create_lobby" | "join_lobby" | "choose_deck" | "ready_player" | "request_resync" | "rematch_vote" }>,
  catalog: RulesCatalog,
  rng: () => number = Math.random
): EngineResult {
  const state = structuredClone(inputState) as MatchState;

  const notTurn = assertActivePlayer(state, playerId);
  if (notTurn && command.type !== "reply_defense") {
    return { ok: false, reason: notTurn, state };
  }

  switch (command.type) {
    case "submit_roll": {
      if (state.phase !== "roll") {
        return { ok: false, reason: "Rolls can only happen during the roll phase.", state };
      }
      if (command.instanceIds.length !== 3) {
        return { ok: false, reason: "You must roll exactly 3 dice.", state };
      }

      const uniqueIds = Array.from(new Set(command.instanceIds));
      if (uniqueIds.length !== 3) {
        return { ok: false, reason: "You must choose 3 different dice.", state };
      }
      const rolledDice = uniqueIds.map((instanceId) => {
        const index = findDieInstanceIndex(state, playerId, instanceId);
        const instance = state.players[playerId].dicePool[index];
        if (index < 0 || !instance || instance.used) {
          return null;
        }
        const die = catalog.diceById[instance.dieId];
        if (!die) {
          return null;
        }
        const face = rollFace(die, rng);
        instance.lastRoll = face;
        return {
          instanceId: instance.instanceId,
          dieId: die.id,
          monsterId: die.monsterId,
          face
        };
      });

      if (rolledDice.some((value) => value === null)) {
        return { ok: false, reason: "Invalid die selection.", state };
      }

      const groupedSummons = new Map<number, string[]>();
      for (const rolledDie of rolledDice) {
        if (!rolledDie) {
          continue;
        }
        if (rolledDie.face.kind === "crest") {
          state.players[playerId].crests[rolledDie.face.crestType] += rolledDie.face.amount;
        } else {
          const list = groupedSummons.get(rolledDie.face.level) ?? [];
          list.push(rolledDie.instanceId);
          groupedSummons.set(rolledDie.face.level, list);
        }
      }

      const availableDimensionInstanceIds = Array.from(groupedSummons.values())
        .filter((group) => group.length >= 2)
        .flat();

      state.pendingRoll = {
        selectedInstanceIds: uniqueIds,
        rolledDice: rolledDice as NonNullable<typeof rolledDice[number]>[],
        availableDimensionInstanceIds
      };
      state.pendingDimension = null;
      state.phase = availableDimensionInstanceIds.length > 0 ? "dimension" : "action";
      addLog(state, "roll", `${playerId} rolled ${uniqueIds.length} dice.`);
      return { ok: true, state };
    }
    case "choose_dimension": {
      if (state.phase !== "dimension" || !state.pendingRoll) {
        return { ok: false, reason: "There is no pending dimension choice.", state };
      }
      if (!state.pendingRoll.availableDimensionInstanceIds.includes(command.instanceId)) {
        return { ok: false, reason: "That die cannot be dimensioned.", state };
      }

      const dieInstance = state.players[playerId].dicePool.find((instance) => instance.instanceId === command.instanceId);
      if (!dieInstance) {
        return { ok: false, reason: "Unknown die.", state };
      }
      const die = catalog.diceById[dieInstance.dieId];
      if (!die) {
        return { ok: false, reason: "Unknown die definition.", state };
      }

      const pendingNet: NetState = ensureNetCoordinates({
        type: die.netType,
        rotation: playerId === "p1" ? 0 : 2,
        orientation: 1,
        anchor: null,
        coordinates: []
      });

      state.pendingDimension = {
        instanceId: command.instanceId,
        monsterId: die.monsterId,
        net: pendingNet
      };
      return { ok: true, state };
    }
    case "set_dimension_net": {
      if (!state.pendingDimension) {
        return { ok: false, reason: "No pending dimension.", state };
      }
      state.pendingDimension.net = ensureNetCoordinates({
        ...state.pendingDimension.net,
        type: command.netType
      });
      return { ok: true, state };
    }
    case "rotate_dimension_net": {
      if (!state.pendingDimension) {
        return { ok: false, reason: "No pending dimension.", state };
      }
      const delta = command.direction === "cw" ? 1 : 3;
      state.pendingDimension.net = ensureNetCoordinates({
        ...state.pendingDimension.net,
        rotation: (state.pendingDimension.net.rotation + delta) % 4
      });
      return { ok: true, state };
    }
    case "flip_dimension_net": {
      if (!state.pendingDimension) {
        return { ok: false, reason: "No pending dimension.", state };
      }
      state.pendingDimension.net = ensureNetCoordinates({
        ...state.pendingDimension.net,
        orientation: state.pendingDimension.net.orientation === 1 ? -1 : 1
      });
      return { ok: true, state };
    }
    case "set_dimension_anchor": {
      if (!state.pendingDimension) {
        return { ok: false, reason: "No pending dimension.", state };
      }
      state.pendingDimension.net = ensureNetCoordinates({
        ...state.pendingDimension.net,
        anchor: command.anchor
      });
      return { ok: true, state };
    }
    case "confirm_dimension": {
      if (!state.pendingDimension) {
        return { ok: false, reason: "No pending dimension.", state };
      }
      const pending = state.pendingDimension;
      if (!canDimension(state, playerId, pending.net)) {
        return { ok: false, reason: "The current net placement is illegal.", state };
      }
      const monster = catalog.monstersById[pending.monsterId];
      if (!monster) {
        return { ok: false, reason: "Unknown monster.", state };
      }

      pending.net.coordinates.forEach((coord) => setTilePath(state, coord, playerId));
      const summonId = `${playerId}-summon-${Object.keys(state.summons).length + 1}`;
      const tile = getTile(state.board, pending.net.anchor!);
      if (!tile) {
        return { ok: false, reason: "Invalid summon anchor.", state };
      }
      tile.occupantId = summonId;

      state.summons[summonId] = {
        id: summonId,
        ownerId: playerId,
        definitionId: monster.id,
        kind: "monster",
        tile: pending.net.anchor!,
        health: monster.health,
        attack: monster.attack,
        defense: monster.defense,
        movement: monster.movement,
        attackRange: monster.attackRange,
        abilities: monster.abilities,
        hasMoved: false,
        hasAttacked: false,
        guarding: false
      };
      state.players[playerId].summonIds.push(summonId);
      const dieIndex = findDieInstanceIndex(state, playerId, pending.instanceId);
      state.players[playerId].dicePool[dieIndex]!.used = true;
      state.pendingDimension = null;
      state.pendingRoll = null;
      state.phase = "action";
      addLog(state, "dimension", `${playerId} dimensioned ${monster.name}.`);
      return { ok: true, state };
    }
    case "cancel_dimension": {
      state.pendingDimension = null;
      state.pendingRoll = null;
      state.phase = "action";
      return { ok: true, state };
    }
    case "move_summon": {
      if (state.phase !== "action") {
        return { ok: false, reason: "Movement can only happen during the action phase.", state };
      }
      const summon = state.summons[command.summonId];
      if (!summon || summon.ownerId !== playerId) {
        return { ok: false, reason: "That summon is not yours.", state };
      }
      if (summon.kind === "monster_lord") {
        return { ok: false, reason: "The Monster Lord cannot move.", state };
      }
      if (coordKey(command.path[0]!) !== coordKey(summon.tile)) {
        return { ok: false, reason: "Path must start on the summon's tile.", state };
      }
      if (!validatePath(command.path)) {
        return { ok: false, reason: "Movement path must be orthogonal.", state };
      }

      for (let i = 1; i < command.path.length; i += 1) {
        const isFinal = i === command.path.length - 1;
        if (!canTraverseTile(state, summon, command.path[i]!, isFinal)) {
          return { ok: false, reason: "That path is blocked.", state };
        }
      }

      const movementCost = (command.path.length - 1) * movementCostPerTile(summon);
      if (!spendCrest(state, playerId, "MOVEMENT", movementCost)) {
        return { ok: false, reason: "Not enough movement crests.", state };
      }

      const origin = getTile(state.board, summon.tile);
      const destination = getTile(state.board, command.path[command.path.length - 1]!);
      if (!origin || !destination) {
        return { ok: false, reason: "Invalid movement tiles.", state };
      }
      origin.occupantId = null;
      destination.occupantId = summon.id;
      summon.tile = command.path[command.path.length - 1]!;
      addLog(state, "move", `${playerId} moved ${summon.definitionId}.`);
      return { ok: true, state };
    }
    case "start_attack": {
      if (state.phase !== "action") {
        return { ok: false, reason: "Attacks can only happen during the action phase.", state };
      }
      const attacker = state.summons[command.attackerId];
      const target = state.summons[command.targetId];
      if (!attacker || !target) {
        return { ok: false, reason: "Unknown combatants.", state };
      }
      if (attacker.ownerId !== playerId) {
        return { ok: false, reason: "That attacker is not yours.", state };
      }
      if (target.ownerId === playerId) {
        return { ok: false, reason: "You cannot attack your own summon.", state };
      }
      if (attacker.hasAttacked) {
        return { ok: false, reason: "That summon already attacked this turn.", state };
      }
      if (!isStraightLineInRange(attacker.tile, target.tile, attacker.attackRange)) {
        return { ok: false, reason: "Target is out of range.", state };
      }
      state.actionWindow = {
        kind: "defense",
        attackerId: attacker.id,
        targetId: target.id,
        defenderId: target.ownerId
      };
      state.phase = "reply";
      return { ok: true, state };
    }
    case "reply_defense": {
      if (state.phase !== "reply" || !state.actionWindow || state.actionWindow.kind !== "defense") {
        return { ok: false, reason: "There is no defense window open.", state };
      }
      if (state.actionWindow.defenderId !== playerId) {
        return { ok: false, reason: "Only the defender may respond.", state };
      }
      const attacker = state.summons[state.actionWindow.attackerId];
      const target = state.summons[state.actionWindow.targetId];
      if (!attacker || !target) {
        return { ok: false, reason: "Combatant missing.", state };
      }
      if (!spendCrest(state, attacker.ownerId, "ATTACK", 1)) {
        return { ok: false, reason: "Attacker does not have enough attack crests.", state };
      }

      let damage = attacker.attack;
      if (command.mode === "guard") {
        if (!spendCrest(state, playerId, "DEFENSE", 1)) {
          return { ok: false, reason: "Not enough defense crests to guard.", state };
        }
        damage = Math.max(0, damage - target.defense);
      }

      attacker.hasAttacked = true;
      resolveDamage(state, target.id, damage, attacker.ownerId);
      state.actionWindow = null;
      if (!state.winnerId) {
        state.phase = "action";
      }
      addLog(state, "attack", `${attacker.ownerId} attacked ${target.ownerId} for ${damage}.`);
      return { ok: true, state };
    }
    case "end_turn": {
      if (state.phase !== "action") {
        return { ok: false, reason: "Turns can only end from the action phase.", state };
      }
      state.pendingRoll = null;
      state.pendingDimension = null;
      state.actionWindow = null;
      state.activePlayerId = playerId === "p1" ? "p2" : "p1";
      state.turn += 1;
      state.phase = "roll";

      Object.values(state.summons)
        .filter((summon) => summon.ownerId === state.activePlayerId)
        .forEach((summon) => {
          summon.hasMoved = false;
          summon.hasAttacked = false;
          summon.guarding = false;
        });
      addLog(state, "turn_end", `${playerId} ended their turn.`);
      return { ok: true, state };
    }
  }
}

export function listLegalMoves(state: MatchState, summonId: string): Coord[] {
  const summon = state.summons[summonId];
  if (!summon) {
    return [];
  }
  const results: Coord[] = [];
  const frontier = [{ coord: summon.tile, steps: 0 }];
  const seen = new Set<string>([coordKey(summon.tile)]);
  const maxSteps = Math.floor(state.players[summon.ownerId].crests.MOVEMENT / movementCostPerTile(summon));

  while (frontier.length > 0) {
    const current = frontier.shift()!;
    for (const next of getNeighbors(current.coord)) {
      const key = coordKey(next);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      if (!canTraverseTile(state, summon, next, true)) {
        continue;
      }
      results.push(next);
      if (current.steps + 1 < maxSteps) {
        frontier.push({ coord: next, steps: current.steps + 1 });
      }
    }
  }

  return results;
}

export function listAttackTargets(state: MatchState, summonId: string): string[] {
  const summon = state.summons[summonId];
  if (!summon) {
    return [];
  }
  return Object.values(state.summons)
    .filter((other) => other.ownerId !== summon.ownerId)
    .filter((other) => isStraightLineInRange(summon.tile, other.tile, summon.attackRange))
    .map((other) => other.id);
}
