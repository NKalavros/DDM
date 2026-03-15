import type { DeckDefinition, DieDefinition, MonsterDefinition } from "@ddm/protocol";
import { generatedCatalog } from "../generated/catalog.generated.js";

export type GameCatalog = {
  monsters: MonsterDefinition[];
  dice: DieDefinition[];
  starterDecks: DeckDefinition[];
  unsupportedMonsterIds: string[];
};

export const catalog: GameCatalog = generatedCatalog;

export const monstersById = Object.fromEntries(catalog.monsters.map((monster) => [monster.id, monster]));
export const diceById = Object.fromEntries(catalog.dice.map((die) => [die.id, die]));

export function createDeck(name: string, dieIds: string[]): DeckDefinition {
  return {
    id: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    name,
    dieIds: dieIds.slice(0, 15)
  };
}
