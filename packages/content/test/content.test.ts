import { describe, expect, it } from "vitest";
import { importLibrary } from "../src/normalize.js";

describe("content importer", () => {
  it("normalizes supported dice and skips unsupported abilities", () => {
    const catalog = importLibrary({
      "1": {
        NAME: "Winged Dragon #1",
        TYPE: "DRAGON",
        LEVEL: 2,
        ATTACK: 10,
        DEFENSE: 10,
        HEALTH: 10,
        ABILITY: [{ NAME: "FLY" }],
        CRESTS: "SSSSM2A2"
      },
      "2": {
        NAME: "Unsupported Mage",
        TYPE: "SPELLCASTER",
        LEVEL: 1,
        ATTACK: 10,
        DEFENSE: 10,
        HEALTH: 10,
        ABILITY: [{ NAME: "BLACKHOLE" }],
        CRESTS: "SSSSAG"
      }
    });

    expect(catalog.monsters).toHaveLength(1);
    expect(catalog.monsters[0]?.abilities).toEqual([{ kind: "FLY" }]);
    expect(catalog.dice[0]?.faces).toHaveLength(6);
    expect(catalog.unsupportedMonsterIds).toContain("2-unsupported-mage");
  });
});
