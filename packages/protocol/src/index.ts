import { z } from "zod";

export const BOARD_WIDTH = 13;
export const BOARD_HEIGHT = 19;
export const DECK_SIZE = 15;
export const MAX_ROLL_SELECTION = 3;

export const playerIdSchema = z.enum(["p1", "p2"]);
export type PlayerId = z.infer<typeof playerIdSchema>;

export const crestTypeSchema = z.enum([
  "ATTACK",
  "DEFENSE",
  "MOVEMENT",
  "MAGIC",
  "TRAP"
]);
export type CrestType = z.infer<typeof crestTypeSchema>;

export const netTypeSchema = z.enum(["T", "Y", "Z", "V", "X", "N", "M", "E", "P", "R", "L"]);
export type NetType = z.infer<typeof netTypeSchema>;

export const phaseSchema = z.enum([
  "lobby",
  "roll",
  "dimension",
  "action",
  "reply",
  "game_over"
]);
export type MatchPhase = z.infer<typeof phaseSchema>;

export const summonKindSchema = z.enum(["monster", "monster_lord"]);
export type SummonKind = z.infer<typeof summonKindSchema>;

export const abilitySpecSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("FLY")
  }),
  z.object({
    kind: z.literal("TUNNEL")
  }),
  z.object({
    kind: z.literal("HOOK"),
    hook: z.enum(["summon", "move", "attack", "defend", "damage", "turn_end"]),
    name: z.string()
  })
]);
export type AbilitySpec = z.infer<typeof abilitySpecSchema>;

export const coordSchema = z.object({
  x: z.number().int().min(0).max(BOARD_WIDTH - 1),
  y: z.number().int().min(0).max(BOARD_HEIGHT - 1)
});
export type Coord = z.infer<typeof coordSchema>;

export const monsterDefinitionSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(["DRAGON", "SPELLCASTER", "UNDEAD", "BEAST", "WARRIOR", "ITEM", "LORD"]),
  level: z.number().int().min(0).max(5),
  attack: z.number().int().min(0),
  defense: z.number().int().min(0),
  health: z.number().int().min(1),
  movement: z.number().int().min(1),
  attackRange: z.number().int().min(1),
  abilities: z.array(abilitySpecSchema)
});
export type MonsterDefinition = z.infer<typeof monsterDefinitionSchema>;

export const dieFaceSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("summon"),
    level: z.number().int().min(1).max(5)
  }),
  z.object({
    kind: z.literal("crest"),
    crestType: crestTypeSchema,
    amount: z.number().int().min(1).max(9)
  })
]);
export type DieFace = z.infer<typeof dieFaceSchema>;

export const dieDefinitionSchema = z.object({
  id: z.string(),
  monsterId: z.string(),
  netType: netTypeSchema,
  faces: z.array(dieFaceSchema).length(6)
});
export type DieDefinition = z.infer<typeof dieDefinitionSchema>;

export const deckDefinitionSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  dieIds: z.array(z.string()).length(DECK_SIZE)
});
export type DeckDefinition = z.infer<typeof deckDefinitionSchema>;

export const tileStateSchema = z.enum(["empty", "path", "block", "lord"]);
export type TileState = z.infer<typeof tileStateSchema>;

export const boardTileSchema = z.object({
  coord: coordSchema,
  state: tileStateSchema,
  ownerId: playerIdSchema.or(z.literal("neutral")).nullable(),
  occupantId: z.string().nullable()
});
export type BoardTile = z.infer<typeof boardTileSchema>;

export const summonStateSchema = z.object({
  id: z.string(),
  ownerId: playerIdSchema,
  definitionId: z.string(),
  kind: summonKindSchema,
  tile: coordSchema,
  health: z.number().int(),
  attack: z.number().int(),
  defense: z.number().int(),
  movement: z.number().int(),
  attackRange: z.number().int(),
  abilities: z.array(abilitySpecSchema),
  hasMoved: z.boolean(),
  hasAttacked: z.boolean(),
  guarding: z.boolean()
});
export type SummonState = z.infer<typeof summonStateSchema>;

export const dieInstanceSchema = z.object({
  dieId: z.string(),
  instanceId: z.string(),
  used: z.boolean(),
  lastRoll: dieFaceSchema.nullable()
});
export type DieInstance = z.infer<typeof dieInstanceSchema>;

export const playerStateSchema = z.object({
  id: playerIdSchema,
  name: z.string(),
  hearts: z.number().int().min(0).max(3),
  crests: z.record(crestTypeSchema, z.number().int().min(0).max(99)),
  deck: deckDefinitionSchema,
  dicePool: z.array(dieInstanceSchema).length(DECK_SIZE),
  summonIds: z.array(z.string()),
  monsterLordId: z.string()
});
export type PlayerState = z.infer<typeof playerStateSchema>;

export const rolledDieSchema = z.object({
  instanceId: z.string(),
  dieId: z.string(),
  monsterId: z.string(),
  face: dieFaceSchema
});
export type RolledDie = z.infer<typeof rolledDieSchema>;

export const netStateSchema = z.object({
  type: netTypeSchema,
  rotation: z.number().int().min(0).max(3),
  orientation: z.union([z.literal(1), z.literal(-1)]),
  anchor: coordSchema.nullable(),
  coordinates: z.array(coordSchema).length(6)
});
export type NetState = z.infer<typeof netStateSchema>;

export const pendingRollSchema = z.object({
  selectedInstanceIds: z.array(z.string()).length(MAX_ROLL_SELECTION),
  rolledDice: z.array(rolledDieSchema),
  availableDimensionInstanceIds: z.array(z.string())
});
export type PendingRoll = z.infer<typeof pendingRollSchema>;

export const pendingDimensionSchema = z.object({
  instanceId: z.string(),
  monsterId: z.string(),
  net: netStateSchema
});
export type PendingDimension = z.infer<typeof pendingDimensionSchema>;

export const actionWindowSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("defense"),
    attackerId: z.string(),
    targetId: z.string(),
    defenderId: playerIdSchema
  })
]);
export type ActionWindow = z.infer<typeof actionWindowSchema>;

export const logEntrySchema = z.object({
  id: z.string(),
  timestamp: z.number().int(),
  type: z.string(),
  message: z.string()
});
export type LogEntry = z.infer<typeof logEntrySchema>;

export const matchStateSchema = z.object({
  id: z.string(),
  roomCode: z.string(),
  phase: phaseSchema,
  activePlayerId: playerIdSchema,
  players: z.record(playerIdSchema, playerStateSchema),
  board: z.array(boardTileSchema).length(BOARD_WIDTH * BOARD_HEIGHT),
  summons: z.record(z.string(), summonStateSchema),
  pendingRoll: pendingRollSchema.nullable(),
  pendingDimension: pendingDimensionSchema.nullable(),
  actionWindow: actionWindowSchema.nullable(),
  winnerId: playerIdSchema.nullable(),
  turn: z.number().int().min(1),
  log: z.array(logEntrySchema)
});
export type MatchState = z.infer<typeof matchStateSchema>;

export const lobbyPlayerSchema = z.object({
  sessionId: z.string(),
  playerId: playerIdSchema,
  name: z.string(),
  ready: z.boolean(),
  connected: z.boolean(),
  deck: deckDefinitionSchema.nullable()
});
export type LobbyPlayer = z.infer<typeof lobbyPlayerSchema>;

export const lobbyStateSchema = z.object({
  roomCode: z.string(),
  players: z.array(lobbyPlayerSchema),
  rematchVotes: z.array(playerIdSchema),
  matchStarted: z.boolean()
});
export type LobbyState = z.infer<typeof lobbyStateSchema>;

export const clientCommandSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("create_lobby"),
    name: z.string().min(1)
  }),
  z.object({
    type: z.literal("join_lobby"),
    roomCode: z.string().length(6),
    name: z.string().min(1),
    sessionId: z.string().optional()
  }),
  z.object({
    type: z.literal("choose_deck"),
    deck: deckDefinitionSchema
  }),
  z.object({
    type: z.literal("ready_player")
  }),
  z.object({
    type: z.literal("request_resync")
  }),
  z.object({
    type: z.literal("submit_roll"),
    instanceIds: z.array(z.string()).length(MAX_ROLL_SELECTION)
  }),
  z.object({
    type: z.literal("choose_dimension"),
    instanceId: z.string()
  }),
  z.object({
    type: z.literal("set_dimension_net"),
    netType: netTypeSchema
  }),
  z.object({
    type: z.literal("rotate_dimension_net"),
    direction: z.enum(["cw", "ccw"])
  }),
  z.object({
    type: z.literal("flip_dimension_net")
  }),
  z.object({
    type: z.literal("set_dimension_anchor"),
    anchor: coordSchema
  }),
  z.object({
    type: z.literal("confirm_dimension")
  }),
  z.object({
    type: z.literal("cancel_dimension")
  }),
  z.object({
    type: z.literal("move_summon"),
    summonId: z.string(),
    path: z.array(coordSchema).min(2)
  }),
  z.object({
    type: z.literal("start_attack"),
    attackerId: z.string(),
    targetId: z.string()
  }),
  z.object({
    type: z.literal("reply_defense"),
    mode: z.enum(["guard", "take_hit"])
  }),
  z.object({
    type: z.literal("end_turn")
  }),
  z.object({
    type: z.literal("rematch_vote")
  })
]);
export type ClientCommand = z.infer<typeof clientCommandSchema>;

export const serverEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("connected"),
    sessionId: z.string()
  }),
  z.object({
    type: z.literal("room_created"),
    roomCode: z.string(),
    playerId: playerIdSchema
  }),
  z.object({
    type: z.literal("room_joined"),
    roomCode: z.string(),
    playerId: playerIdSchema
  }),
  z.object({
    type: z.literal("lobby_updated"),
    lobby: lobbyStateSchema
  }),
  z.object({
    type: z.literal("match_state"),
    state: matchStateSchema
  }),
  z.object({
    type: z.literal("command_rejected"),
    reason: z.string()
  }),
  z.object({
    type: z.literal("resynced"),
    lobby: lobbyStateSchema.nullable(),
    state: matchStateSchema.nullable()
  })
]);
export type ServerEvent = z.infer<typeof serverEventSchema>;

export const emptyCrests = (): Record<CrestType, number> => ({
  ATTACK: 0,
  DEFENSE: 0,
  MOVEMENT: 0,
  MAGIC: 0,
  TRAP: 0
});

export const NET_COORDS: Record<NetType, Coord[]> = {
  T: [{ x: -1, y: 1 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 0, y: 0 }, { x: 0, y: -1 }, { x: 0, y: -2 }],
  Y: [{ x: -1, y: 1 }, { x: 0, y: 1 }, { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: -1 }, { x: 0, y: -2 }],
  Z: [{ x: -1, y: 1 }, { x: 0, y: 1 }, { x: 0, y: 0 }, { x: 0, y: -1 }, { x: 0, y: -2 }, { x: 1, y: -2 }],
  V: [{ x: -1, y: 1 }, { x: 0, y: 1 }, { x: 0, y: 0 }, { x: 0, y: -1 }, { x: 1, y: -1 }, { x: 0, y: -2 }],
  X: [{ x: 0, y: 1 }, { x: -1, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: -1 }, { x: 0, y: -2 }],
  N: [{ x: 0, y: 1 }, { x: -1, y: 0 }, { x: 0, y: 0 }, { x: 0, y: -1 }, { x: 1, y: -1 }, { x: 0, y: -2 }],
  M: [{ x: -1, y: 1 }, { x: 0, y: 1 }, { x: 0, y: 0 }, { x: 0, y: -1 }, { x: 1, y: -1 }, { x: 1, y: -2 }],
  E: [{ x: -1, y: 1 }, { x: -1, y: 0 }, { x: 0, y: 0 }, { x: 0, y: -1 }, { x: 1, y: -1 }, { x: 1, y: -2 }],
  P: [{ x: -1, y: 1 }, { x: -1, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: -1 }, { x: 0, y: -2 }],
  R: [{ x: -1, y: 1 }, { x: -1, y: 0 }, { x: 0, y: 0 }, { x: 0, y: -1 }, { x: 1, y: -1 }, { x: 0, y: -2 }],
  L: [{ x: 0, y: 2 }, { x: 0, y: 1 }, { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: -1 }, { x: 1, y: -2 }]
};

export function rotateCoord(coord: Coord): Coord {
  return { x: coord.y, y: -coord.x };
}

export function applyNetTransform(
  type: NetType,
  rotation: number,
  orientation: 1 | -1,
  anchor: Coord | null
): Coord[] {
  let coords = NET_COORDS[type].map((coord) => ({ ...coord }));
  for (let i = 0; i < rotation; i += 1) {
    coords = coords.map(rotateCoord);
  }
  if (orientation === -1) {
    coords = coords.map((coord) => ({ x: coord.x, y: -coord.y }));
  }
  if (!anchor) {
    return coords;
  }
  return coords.map((coord) => ({
    x: coord.x + anchor.x,
    y: coord.y + anchor.y
  }));
}

export function coordKey(coord: Coord): string {
  return `${coord.x},${coord.y}`;
}
