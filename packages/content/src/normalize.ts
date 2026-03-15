import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AbilitySpec, DeckDefinition, DieDefinition, DieFace, MonsterDefinition, NetType } from "@ddm/protocol";

export type CatalogData = {
  monsters: MonsterDefinition[];
  dice: DieDefinition[];
  starterDecks: DeckDefinition[];
  unsupportedMonsterIds: string[];
};

type RawAbility = {
  NAME: string;
};

type RawEntry = {
  NAME: string;
  TYPE: "DRAGON" | "SPELLCASTER" | "UNDEAD" | "BEAST" | "WARRIOR" | "ITEM";
  LEVEL: number;
  ATTACK?: number;
  DEFENSE?: number;
  HEALTH?: number;
  ABILITY?: RawAbility[];
  CRESTS: string;
};

const CREST_MAP = {
  A: "ATTACK",
  D: "DEFENSE",
  M: "MOVEMENT",
  G: "MAGIC",
  T: "TRAP"
} as const;

const DEFAULT_NETS: NetType[] = ["T", "Y", "Z", "V", "X", "N", "M", "E", "P", "R", "L"];

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function parseCrests(raw: string, level: number): DieFace[] {
  const tokens = Array.from(raw.matchAll(/([SMADGT])(\d)?/g), (match) => ({
    kind: match[1],
    amount: match[2] ? Number.parseInt(match[2], 10) : 1
  }));

  if (tokens.length !== 6) {
    throw new Error(`Expected 6 die faces, got ${tokens.length} for ${raw}`);
  }

  return tokens.map((token) => {
    if (token.kind === "S") {
      return { kind: "summon", level } as DieFace;
    }
    return {
      kind: "crest",
      crestType: CREST_MAP[token.kind as keyof typeof CREST_MAP],
      amount: token.amount
    } as DieFace;
  });
}

function mapAbilities(rawAbilities: RawAbility[] | undefined): { abilities: AbilitySpec[]; supported: boolean } {
  if (!rawAbilities || rawAbilities.length === 0) {
    return { abilities: [], supported: true };
  }

  const abilities: AbilitySpec[] = [];
  let supported = true;
  for (const ability of rawAbilities) {
    if (ability.NAME === "FLY" || ability.NAME === "TUNNEL") {
      abilities.push({ kind: ability.NAME });
    } else {
      supported = false;
    }
  }

  return { abilities, supported };
}

function buildStarterDecks(dice: DieDefinition[]): DeckDefinition[] {
  const chunks = [dice.slice(0, DECK_SIZE), dice.slice(DECK_SIZE, DECK_SIZE * 2)];

  return chunks
    .filter((chunk) => chunk.length === DECK_SIZE)
    .map((chunk, index) => ({
      id: `starter-${index + 1}`,
      name: `Starter ${index + 1}`,
      dieIds: chunk.map((die) => die.id)
    }));
}

export function importLibrary(rawLibrary: Record<string, RawEntry>): CatalogData {
  const monsters: MonsterDefinition[] = [];
  const dice: DieDefinition[] = [];
  const unsupportedMonsterIds: string[] = [];
  let netIndex = 0;

  for (const [rawId, entry] of Object.entries(rawLibrary).sort((a, b) => Number(a[0]) - Number(b[0]))) {
    const monsterId = `${rawId}-${slugify(entry.NAME)}`;
    const { abilities, supported } = mapAbilities(entry.ABILITY);
    if (!supported) {
      unsupportedMonsterIds.push(monsterId);
      continue;
    }

    monsters.push({
      id: monsterId,
      name: entry.NAME,
      type: entry.TYPE,
      level: entry.LEVEL,
      attack: entry.ATTACK ?? 0,
      defense: entry.DEFENSE ?? 0,
      health: entry.HEALTH ?? 10,
      movement: 1,
      attackRange: 1,
      abilities
    });

    dice.push({
      id: `die-${monsterId}`,
      monsterId,
      netType: DEFAULT_NETS[netIndex % DEFAULT_NETS.length],
      faces: parseCrests(entry.CRESTS, entry.LEVEL)
    });
    netIndex += 1;
  }

  return {
    monsters,
    dice,
    starterDecks: buildStarterDecks(dice),
    unsupportedMonsterIds
  };
}

export function importLibraryFile(filePath = resolve(process.cwd(), "DDMre/source/databases/LIBRARY.json")): CatalogData {
  const raw = JSON.parse(readFileSync(filePath, "utf8")) as Record<string, RawEntry>;
  return importLibrary(raw);
}
const DECK_SIZE = 15;
