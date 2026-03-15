import { describe, expect, it } from "vitest";
import type { DeckDefinition, DieDefinition, MonsterDefinition } from "@ddm/protocol";
import { createMatchState, reduceMatchState, type RulesCatalog } from "../src/index.js";

const monsters: MonsterDefinition[] = [
  {
    id: "walker",
    name: "Walker",
    type: "WARRIOR",
    level: 1,
    attack: 10,
    defense: 5,
    health: 20,
    movement: 1,
    attackRange: 1,
    abilities: []
  },
  {
    id: "sky-drake",
    name: "Sky Drake",
    type: "DRAGON",
    level: 1,
    attack: 20,
    defense: 10,
    health: 20,
    movement: 2,
    attackRange: 1,
    abilities: [{ kind: "FLY" }]
  },
  {
    id: "burrower",
    name: "Burrower",
    type: "BEAST",
    level: 1,
    attack: 10,
    defense: 10,
    health: 20,
    movement: 2,
    attackRange: 1,
    abilities: [{ kind: "TUNNEL" }]
  }
];

const dice: DieDefinition[] = [
  {
    id: "walker-die",
    monsterId: "walker",
    netType: "T",
    faces: [
      { kind: "summon", level: 1 },
      { kind: "summon", level: 1 },
      { kind: "crest", crestType: "MOVEMENT", amount: 1 },
      { kind: "crest", crestType: "ATTACK", amount: 1 },
      { kind: "crest", crestType: "DEFENSE", amount: 1 },
      { kind: "crest", crestType: "MAGIC", amount: 1 }
    ]
  },
  {
    id: "sky-drake-die",
    monsterId: "sky-drake",
    netType: "T",
    faces: [
      { kind: "summon", level: 1 },
      { kind: "summon", level: 1 },
      { kind: "crest", crestType: "MOVEMENT", amount: 1 },
      { kind: "crest", crestType: "ATTACK", amount: 1 },
      { kind: "crest", crestType: "DEFENSE", amount: 1 },
      { kind: "crest", crestType: "MAGIC", amount: 1 }
    ]
  },
  {
    id: "burrower-die",
    monsterId: "burrower",
    netType: "T",
    faces: [
      { kind: "summon", level: 1 },
      { kind: "summon", level: 1 },
      { kind: "crest", crestType: "MOVEMENT", amount: 1 },
      { kind: "crest", crestType: "ATTACK", amount: 1 },
      { kind: "crest", crestType: "DEFENSE", amount: 1 },
      { kind: "crest", crestType: "MAGIC", amount: 1 }
    ]
  }
];

const catalog: RulesCatalog = {
  monstersById: Object.fromEntries(monsters.map((monster) => [monster.id, monster])),
  diceById: Object.fromEntries(dice.map((die) => [die.id, die]))
};

function deck(id: string, dieId: string): DeckDefinition {
  return {
    id,
    name: id,
    dieIds: Array.from({ length: 15 }, () => dieId)
  };
}

function sequenceRng(...values: number[]) {
  let index = 0;
  return () => {
    const value = values[index] ?? values[values.length - 1] ?? 0;
    index += 1;
    return value;
  };
}

describe("engine", () => {
  it("resolves rolls and opens dimension when two summon faces match", () => {
    const state = createMatchState(
      {
        matchId: "m1",
        roomCode: "ABC123",
        players: {
          p1: { name: "P1", deck: deck("d1", "walker-die") },
          p2: { name: "P2", deck: deck("d2", "walker-die") }
        }
      },
      catalog
    );

    const result = reduceMatchState(state, "p1", { type: "submit_roll", instanceIds: ["p1-1", "p1-2", "p1-3"] }, catalog, sequenceRng(0, 0, 0.6));
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.state.phase).toBe("dimension");
    expect(result.state.pendingRoll?.availableDimensionInstanceIds).toEqual(["p1-1", "p1-2"]);
  });

  it("rejects rolls that do not use exactly three dice", () => {
    const state = createMatchState(
      {
        matchId: "m-roll-count",
        roomCode: "ABC123",
        players: {
          p1: { name: "P1", deck: deck("d1", "walker-die") },
          p2: { name: "P2", deck: deck("d2", "walker-die") }
        }
      },
      catalog
    );

    const result = reduceMatchState(state, "p1", { type: "submit_roll", instanceIds: ["p1-1", "p1-2"] as [string, string] & string[] }, catalog, () => 0);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.reason).toContain("exactly 3 dice");
  });

  it("dimensions a summon and applies movement costs", () => {
    let state = createMatchState(
      {
        matchId: "m2",
        roomCode: "ABC123",
        players: {
          p1: { name: "P1", deck: deck("d1", "walker-die") },
          p2: { name: "P2", deck: deck("d2", "walker-die") }
        }
      },
      catalog
    );

    let result = reduceMatchState(state, "p1", { type: "submit_roll", instanceIds: ["p1-1", "p1-2", "p1-3"] }, catalog, sequenceRng(0, 0, 0.6));
    expect(result.ok).toBe(true);
    state = result.state;
    result = reduceMatchState(state, "p1", { type: "choose_dimension", instanceId: "p1-1" }, catalog);
    expect(result.ok).toBe(true);
    state = result.state;
    result = reduceMatchState(state, "p1", { type: "set_dimension_anchor", anchor: { x: 6, y: 16 } }, catalog);
    expect(result.ok).toBe(true);
    state = result.state;
    result = reduceMatchState(state, "p1", { type: "confirm_dimension" }, catalog);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    state = result.state;
    const summonId = state.players.p1.summonIds.find((id) => id !== "p1-lord")!;
    state.players.p1.crests.MOVEMENT = 2;
    const move = reduceMatchState(
      state,
      "p1",
      { type: "move_summon", summonId, path: [{ x: 6, y: 16 }, { x: 6, y: 17 }] },
      catalog
    );
    expect(move.ok).toBe(true);
    if (!move.ok) {
      return;
    }
    expect(move.state.summons[summonId]?.tile).toEqual({ x: 6, y: 17 });
    expect(move.state.players.p1.crests.MOVEMENT).toBe(1);
  });

  it("allows multiple moves in the same turn while movement crests remain", () => {
    const state = createMatchState(
      {
        matchId: "m-multi-move",
        roomCode: "ABC123",
        players: {
          p1: { name: "P1", deck: deck("d1", "walker-die") },
          p2: { name: "P2", deck: deck("d2", "walker-die") }
        }
      },
      catalog
    );

    state.phase = "action";
    state.players.p1.crests.MOVEMENT = 2;
    state.summons["walker-1"] = {
      id: "walker-1",
      ownerId: "p1",
      definitionId: "walker",
      kind: "monster",
      tile: { x: 5, y: 10 },
      health: 20,
      attack: 10,
      defense: 5,
      movement: 1,
      attackRange: 1,
      abilities: [],
      hasMoved: false,
      hasAttacked: false,
      guarding: false
    };
    state.players.p1.summonIds.push("walker-1");
    state.board.find((tile) => tile.coord.x === 5 && tile.coord.y === 10)!.occupantId = "walker-1";
    state.board.find((tile) => tile.coord.x === 5 && tile.coord.y === 10)!.state = "path";
    state.board.find((tile) => tile.coord.x === 6 && tile.coord.y === 10)!.state = "path";
    state.board.find((tile) => tile.coord.x === 7 && tile.coord.y === 10)!.state = "path";

    let result = reduceMatchState(
      state,
      "p1",
      { type: "move_summon", summonId: "walker-1", path: [{ x: 5, y: 10 }, { x: 6, y: 10 }] },
      catalog
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    result = reduceMatchState(
      result.state,
      "p1",
      { type: "move_summon", summonId: "walker-1", path: [{ x: 6, y: 10 }, { x: 7, y: 10 }] },
      catalog
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.state.summons["walker-1"]?.tile).toEqual({ x: 7, y: 10 });
    expect(result.state.players.p1.crests.MOVEMENT).toBe(0);
  });

  it("recomputes net coordinates when rotating and flipping during dimension", () => {
    let state = createMatchState(
      {
        matchId: "m-rotate",
        roomCode: "ABC123",
        players: {
          p1: { name: "P1", deck: deck("d1", "walker-die") },
          p2: { name: "P2", deck: deck("d2", "walker-die") }
        }
      },
      catalog
    );

    let result = reduceMatchState(state, "p1", { type: "submit_roll", instanceIds: ["p1-1", "p1-2", "p1-3"] }, catalog, sequenceRng(0, 0, 0.6));
    expect(result.ok).toBe(true);
    state = result.state;
    result = reduceMatchState(state, "p1", { type: "choose_dimension", instanceId: "p1-1" }, catalog);
    expect(result.ok).toBe(true);
    state = result.state;
    result = reduceMatchState(state, "p1", { type: "set_dimension_anchor", anchor: { x: 6, y: 16 } }, catalog);
    expect(result.ok).toBe(true);
    state = result.state;
    const initial = state.pendingDimension?.net.coordinates ?? [];

    result = reduceMatchState(state, "p1", { type: "rotate_dimension_net", direction: "cw" }, catalog);
    expect(result.ok).toBe(true);
    state = result.state;
    const rotated = state.pendingDimension?.net.coordinates ?? [];

    result = reduceMatchState(state, "p1", { type: "flip_dimension_net" }, catalog);
    expect(result.ok).toBe(true);
    const flipped = result.state.pendingDimension?.net.coordinates ?? [];

    expect(rotated).not.toEqual(initial);
    expect(flipped).not.toEqual(rotated);
    expect(flipped).toHaveLength(6);
  });

  it("allows dimensioning adjacent to an allied occupied summon tile", () => {
    let state = createMatchState(
      {
        matchId: "m-adjacent",
        roomCode: "ABC123",
        players: {
          p1: { name: "P1", deck: deck("d1", "walker-die") },
          p2: { name: "P2", deck: deck("d2", "walker-die") }
        }
      },
      catalog
    );

    state.phase = "dimension";
    state.pendingRoll = {
      selectedInstanceIds: ["p1-1", "p1-2", "p1-3"],
      rolledDice: [],
      availableDimensionInstanceIds: ["p1-1"]
    };
    state.summons["ally"] = {
      id: "ally",
      ownerId: "p1",
      definitionId: "walker",
      kind: "monster",
      tile: { x: 6, y: 16 },
      health: 20,
      attack: 10,
      defense: 5,
      movement: 1,
      attackRange: 1,
      abilities: [],
      hasMoved: false,
      hasAttacked: false,
      guarding: false
    };
    state.players.p1.summonIds.push("ally");
    state.board.find((tile) => tile.coord.x === 6 && tile.coord.y === 16)!.occupantId = "ally";

    let result = reduceMatchState(state, "p1", { type: "choose_dimension", instanceId: "p1-1" }, catalog);
    expect(result.ok).toBe(true);
    state = result.state;
    result = reduceMatchState(state, "p1", { type: "set_dimension_anchor", anchor: { x: 4, y: 15 } }, catalog);
    expect(result.ok).toBe(true);
    state = result.state;
    result = reduceMatchState(state, "p1", { type: "confirm_dimension" }, catalog);
    expect(result.ok).toBe(true);
  });

  it("uses defense reply to reduce damage", () => {
    let state = createMatchState(
      {
        matchId: "m3",
        roomCode: "ABC123",
        players: {
          p1: { name: "P1", deck: deck("d1", "sky-drake-die") },
          p2: { name: "P2", deck: deck("d2", "walker-die") }
        }
      },
      catalog
    );

    state.phase = "action";
    state.players.p1.crests.ATTACK = 1;
    state.players.p2.crests.DEFENSE = 1;
    state.summons["a"] = {
      id: "a",
      ownerId: "p1",
      definitionId: "sky-drake",
      kind: "monster",
      tile: { x: 6, y: 10 },
      health: 20,
      attack: 20,
      defense: 10,
      movement: 2,
      attackRange: 1,
      abilities: [{ kind: "FLY" }],
      hasMoved: false,
      hasAttacked: false,
      guarding: false
    };
    state.summons["b"] = {
      id: "b",
      ownerId: "p2",
      definitionId: "walker",
      kind: "monster",
      tile: { x: 6, y: 9 },
      health: 20,
      attack: 10,
      defense: 5,
      movement: 1,
      attackRange: 1,
      abilities: [],
      hasMoved: false,
      hasAttacked: false,
      guarding: false
    };
    state.players.p1.summonIds.push("a");
    state.players.p2.summonIds.push("b");
    state.board.find((tile) => tile.coord.x === 6 && tile.coord.y === 10)!.occupantId = "a";
    state.board.find((tile) => tile.coord.x === 6 && tile.coord.y === 10)!.state = "path";
    state.board.find((tile) => tile.coord.x === 6 && tile.coord.y === 9)!.occupantId = "b";
    state.board.find((tile) => tile.coord.x === 6 && tile.coord.y === 9)!.state = "path";

    let result = reduceMatchState(state, "p1", { type: "start_attack", attackerId: "a", targetId: "b" }, catalog);
    expect(result.ok).toBe(true);
    state = result.state;
    result = reduceMatchState(state, "p2", { type: "reply_defense", mode: "guard" }, catalog);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.state.summons.b?.health).toBe(5);
    expect(result.state.players.p1.crests.ATTACK).toBe(0);
    expect(result.state.players.p2.crests.DEFENSE).toBe(0);
  });

  it("allows only one attack per summon each turn", () => {
    let state = createMatchState(
      {
        matchId: "m-attack-once",
        roomCode: "ABC123",
        players: {
          p1: { name: "P1", deck: deck("d1", "walker-die") },
          p2: { name: "P2", deck: deck("d2", "walker-die") }
        }
      },
      catalog
    );

    state.phase = "action";
    state.players.p1.crests.ATTACK = 2;
    state.summons["a"] = {
      id: "a",
      ownerId: "p1",
      definitionId: "walker",
      kind: "monster",
      tile: { x: 6, y: 10 },
      health: 20,
      attack: 10,
      defense: 5,
      movement: 1,
      attackRange: 1,
      abilities: [],
      hasMoved: false,
      hasAttacked: false,
      guarding: false
    };
    state.summons["b"] = {
      id: "b",
      ownerId: "p2",
      definitionId: "walker",
      kind: "monster",
      tile: { x: 6, y: 9 },
      health: 20,
      attack: 10,
      defense: 5,
      movement: 1,
      attackRange: 1,
      abilities: [],
      hasMoved: false,
      hasAttacked: false,
      guarding: false
    };
    state.summons["c"] = {
      id: "c",
      ownerId: "p2",
      definitionId: "walker",
      kind: "monster",
      tile: { x: 7, y: 10 },
      health: 20,
      attack: 10,
      defense: 5,
      movement: 1,
      attackRange: 1,
      abilities: [],
      hasMoved: false,
      hasAttacked: false,
      guarding: false
    };
    state.players.p1.summonIds.push("a");
    state.players.p2.summonIds.push("b", "c");
    state.board.find((tile) => tile.coord.x === 6 && tile.coord.y === 10)!.occupantId = "a";
    state.board.find((tile) => tile.coord.x === 6 && tile.coord.y === 10)!.state = "path";
    state.board.find((tile) => tile.coord.x === 6 && tile.coord.y === 9)!.occupantId = "b";
    state.board.find((tile) => tile.coord.x === 6 && tile.coord.y === 9)!.state = "path";
    state.board.find((tile) => tile.coord.x === 7 && tile.coord.y === 10)!.occupantId = "c";
    state.board.find((tile) => tile.coord.x === 7 && tile.coord.y === 10)!.state = "path";

    let result = reduceMatchState(state, "p1", { type: "start_attack", attackerId: "a", targetId: "b" }, catalog);
    expect(result.ok).toBe(true);
    state = result.state;
    result = reduceMatchState(state, "p2", { type: "reply_defense", mode: "take_hit" }, catalog);
    expect(result.ok).toBe(true);
    state = result.state;

    result = reduceMatchState(state, "p1", { type: "start_attack", attackerId: "a", targetId: "c" }, catalog);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.reason).toContain("already attacked");
  });

  it("always deals exactly one heart of damage when attacking a Monster Lord", () => {
    let state = createMatchState(
      {
        matchId: "m-lord-damage",
        roomCode: "ABC123",
        players: {
          p1: { name: "P1", deck: deck("d1", "sky-drake-die") },
          p2: { name: "P2", deck: deck("d2", "walker-die") }
        }
      },
      catalog
    );

    state.phase = "action";
    state.players.p1.crests.ATTACK = 1;
    state.players.p2.crests.DEFENSE = 1;
    state.summons["a"] = {
      id: "a",
      ownerId: "p1",
      definitionId: "sky-drake",
      kind: "monster",
      tile: { x: 6, y: 1 },
      health: 20,
      attack: 20,
      defense: 10,
      movement: 2,
      attackRange: 1,
      abilities: [{ kind: "FLY" }],
      hasMoved: false,
      hasAttacked: false,
      guarding: false
    };
    state.players.p1.summonIds.push("a");
    state.board.find((tile) => tile.coord.x === 6 && tile.coord.y === 1)!.occupantId = "a";
    state.board.find((tile) => tile.coord.x === 6 && tile.coord.y === 1)!.state = "path";

    let result = reduceMatchState(state, "p1", { type: "start_attack", attackerId: "a", targetId: "p2-lord" }, catalog);
    expect(result.ok).toBe(true);
    state = result.state;
    result = reduceMatchState(state, "p2", { type: "reply_defense", mode: "guard" }, catalog);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.state.summons["p2-lord"]?.health).toBe(20);
    expect(result.state.players.p2.hearts).toBe(2);
    expect(result.state.players.p1.crests.ATTACK).toBe(0);
    expect(result.state.players.p2.crests.DEFENSE).toBe(0);
  });

  it("lets tunneling summons move through blocked intermediate tiles", () => {
    const state = createMatchState(
      {
        matchId: "m4",
        roomCode: "ABC123",
        players: {
          p1: { name: "P1", deck: deck("d1", "burrower-die") },
          p2: { name: "P2", deck: deck("d2", "walker-die") }
        }
      },
      catalog
    );

    state.phase = "action";
    state.players.p1.crests.MOVEMENT = 2;
    state.summons["t"] = {
      id: "t",
      ownerId: "p1",
      definitionId: "burrower",
      kind: "monster",
      tile: { x: 5, y: 10 },
      health: 20,
      attack: 10,
      defense: 10,
      movement: 2,
      attackRange: 1,
      abilities: [{ kind: "TUNNEL" }],
      hasMoved: false,
      hasAttacked: false,
      guarding: false
    };
    state.players.p1.summonIds.push("t");
    state.board.find((tile) => tile.coord.x === 5 && tile.coord.y === 10)!.occupantId = "t";
    state.board.find((tile) => tile.coord.x === 5 && tile.coord.y === 10)!.state = "path";
    state.board.find((tile) => tile.coord.x === 6 && tile.coord.y === 10)!.state = "block";
    state.board.find((tile) => tile.coord.x === 7 && tile.coord.y === 10)!.state = "path";

    const result = reduceMatchState(
      state,
      "p1",
      { type: "move_summon", summonId: "t", path: [{ x: 5, y: 10 }, { x: 6, y: 10 }, { x: 7, y: 10 }] },
      catalog
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.state.summons.t?.tile).toEqual({ x: 7, y: 10 });
  });

  it("charges flying summons two movement crests per tile", () => {
    const state = createMatchState(
      {
        matchId: "m-fly-cost",
        roomCode: "ABC123",
        players: {
          p1: { name: "P1", deck: deck("d1", "sky-drake-die") },
          p2: { name: "P2", deck: deck("d2", "walker-die") }
        }
      },
      catalog
    );

    state.phase = "action";
    state.players.p1.crests.MOVEMENT = 2;
    state.summons["flyer"] = {
      id: "flyer",
      ownerId: "p1",
      definitionId: "sky-drake",
      kind: "monster",
      tile: { x: 5, y: 10 },
      health: 20,
      attack: 20,
      defense: 10,
      movement: 2,
      attackRange: 1,
      abilities: [{ kind: "FLY" }],
      hasMoved: false,
      hasAttacked: false,
      guarding: false
    };
    state.players.p1.summonIds.push("flyer");
    state.board.find((tile) => tile.coord.x === 5 && tile.coord.y === 10)!.occupantId = "flyer";
    state.board.find((tile) => tile.coord.x === 5 && tile.coord.y === 10)!.state = "path";

    const result = reduceMatchState(
      state,
      "p1",
      { type: "move_summon", summonId: "flyer", path: [{ x: 5, y: 10 }, { x: 6, y: 10 }] },
      catalog
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.state.players.p1.crests.MOVEMENT).toBe(0);
  });
});
