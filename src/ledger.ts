import { readFile } from "node:fs/promises";

import { writeTextAtomic } from "./storage.js";

export interface LedgerRecipe {
  dishItemId: string;
  name: string;
  ingredientNames: string[];
  sellValue: number;
}

export async function readRecipeLedger(file: string): Promise<LedgerRecipe[]> {
  const markdown = await readFile(file, "utf8");
  const match = markdown.match(/```json\s*([\s\S]*?)\s*```/u);
  if (!match?.[1]) throw new Error("Recipe ledger does not contain a JSON code block.");
  const parsed: unknown = JSON.parse(match[1]);
  if (!Array.isArray(parsed)) throw new Error("Recipe ledger JSON must be an array.");
  return parsed.map(parseLedgerRecipe);
}

export async function updateRecipeLedger(file: string, additions: LedgerRecipe[]): Promise<LedgerRecipe[]> {
  let current: LedgerRecipe[] = [];
  try {
    current = await readRecipeLedger(file);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  const recipes = new Map(current.map((recipe) => [recipe.dishItemId, recipe]));
  for (const recipe of additions) recipes.set(recipe.dishItemId, recipe);
  const sorted = [...recipes.values()].sort((left, right) => right.sellValue - left.sellValue || left.dishItemId.localeCompare(right.dishItemId));
  const markdown = `# Moonlight Garden expensive recipes\n\nThis file is managed by moonlight-garden-handytools.\n\n\`\`\`json\n${JSON.stringify(sorted, null, 2)}\n\`\`\`\n`;
  await writeTextAtomic(file, markdown, current.length > 0);
  return sorted;
}

export function recipeFromUpstream(value: unknown): LedgerRecipe {
  const row = asObject(value);
  if (!row || typeof row.item !== "string" || typeof row.name !== "string" || !Array.isArray(row.ingredients) ||
      !row.ingredients.every((ingredient) => typeof ingredient === "string") ||
      typeof row.sell_value !== "number" || !Number.isFinite(row.sell_value)) {
    throw new Error("Recipe data is missing item, name, ingredients, or sell_value.");
  }
  return {
    dishItemId: row.item,
    name: row.name,
    ingredientNames: row.ingredients as string[],
    sellValue: row.sell_value,
  };
}

function parseLedgerRecipe(value: unknown): LedgerRecipe {
  const row = asObject(value);
  if (!row || typeof row.dishItemId !== "string" || typeof row.name !== "string" ||
      !Array.isArray(row.ingredientNames) || !row.ingredientNames.every((ingredient) => typeof ingredient === "string") ||
      typeof row.sellValue !== "number" || !Number.isFinite(row.sellValue)) {
    throw new Error("Recipe ledger contains an invalid row.");
  }
  return {
    dishItemId: row.dishItemId,
    name: row.name,
    ingredientNames: row.ingredientNames as string[],
    sellValue: row.sellValue,
  };
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
