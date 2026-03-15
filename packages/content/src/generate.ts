import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { importLibraryFile } from "./normalize.js";

const repoRoot = resolve(process.cwd(), "../..");
const outputPath = resolve(repoRoot, "packages/content/generated/catalog.generated.ts");
mkdirSync(dirname(outputPath), { recursive: true });

const catalog = importLibraryFile(resolve(repoRoot, "DDMre/source/databases/LIBRARY.json"));
const source = `import type { DeckDefinition, DieDefinition, MonsterDefinition } from "@ddm/protocol";

export type GeneratedCatalog = {
  monsters: MonsterDefinition[];
  dice: DieDefinition[];
  starterDecks: DeckDefinition[];
  unsupportedMonsterIds: string[];
};

export const generatedCatalog: GeneratedCatalog = ${JSON.stringify(catalog, null, 2)} as const;
`;

writeFileSync(outputPath, source, "utf8");
console.log(`Generated content catalog at ${outputPath}`);
