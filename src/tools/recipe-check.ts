import { readRecipeLedger, recipeFromUpstream, type LedgerRecipe } from "../ledger.js";
import { parseToolData, resultFromPayload, type GardenGateway, type HandyToolResult } from "../types.js";

type CandidateSource = "ledger" | "latest50Fallback";

interface Candidate {
  dishItemId: string;
  name: string;
  ingredientIds: string[];
  sellValue: number;
  ingredientSellValue: number | null;
  valueAdded: number | null;
  valueAddedStatus: "calculated" | "missingIngredientSellValueUnavailable";
  source: CandidateSource;
  missingIngredientId?: string;
}

interface GiftReceipt {
  fromName: string;
  receivedAt: string;
  itemId: string;
  itemName: string;
  quantity: number;
}

export interface RecipeCheckPayload extends Record<string, unknown> {
  remainingCookCount?: number;
  canCookAnyNow?: boolean;
  cookableNow?: Candidate[];
  missingOne?: Candidate[];
  usedLatest50Fallback?: boolean;
  unresolvedRecipeCount?: number;
  unresolvedIngredientSummary?: Array<{ name: string; recipeCount: number }>;
  receivedGifts?: GiftReceipt[];
  errors?: Record<string, string>;
}

interface ItemReference {
  itemId: string;
  name: string;
  sellValue: number | null;
}

interface InventoryItem extends ItemReference {
  quantity: number;
}

export async function runRecipeCheck({
  gateway,
  ledgerFile,
  now = () => new Date(),
}: {
  gateway: GardenGateway;
  ledgerFile: string;
  now?: () => Date;
}): Promise<HandyToolResult<RecipeCheckPayload>> {
  let ledger: LedgerRecipe[];
  try {
    ledger = await readRecipeLedger(ledgerFile);
  } catch {
    return resultFromPayload({ errors: { ledger: "The local recipe ledger could not be read or validated." } }, true);
  }

  const errors: Record<string, string> = {};
  const [kitchenResult, inventoryResult] = await Promise.allSettled([
    gateway.callTool("kitchen", { command: "status" }),
    gateway.callTool("inventory", { command: "list" }).then((result) => ({ result, receivedAt: now().toISOString() })),
  ]);
  let remainingCookCount: number | undefined;
  let inventory: InventoryItem[] | undefined;
  let receivedGifts: GiftReceipt[] | undefined;

  if (kitchenResult.status === "fulfilled") {
    try { remainingCookCount = readRemainingCooks(parseToolData(kitchenResult.value)); }
    catch { errors.kitchen = "Kitchen quota query failed or returned invalid data."; }
  } else errors.kitchen = "Kitchen quota query failed or returned invalid data.";

  if (inventoryResult.status === "fulfilled") {
    try {
      const inventoryData = parseToolData(inventoryResult.value.result);
      try { receivedGifts = readReceivedGifts(inventoryData, inventoryResult.value.receivedAt); }
      catch { errors.receivedGifts = "Inventory was read, but received gift details were invalid."; }
      try { inventory = readInventory(inventoryData); }
      catch { errors.inventory = "Inventory query returned invalid item data."; }
    } catch {
      errors.inventory = "Inventory query failed or returned invalid data.";
    }
  } else errors.inventory = "Inventory query failed or returned invalid data.";

  if (remainingCookCount === undefined || inventory === undefined) {
    return resultFromPayload({ ...(receivedGifts?.length ? { receivedGifts } : {}), errors }, true);
  }

  const payload: RecipeCheckPayload = { remainingCookCount, ...(receivedGifts?.length ? { receivedGifts } : {}) };
  const references = new Map<string, ItemReference[]>();
  addReferences(references, inventory);

  const [farmShopResult, fishCollectionResult] = await Promise.allSettled([
    gateway.callTool("farm", { command: "shop" }),
    gateway.callTool("fish", { command: "collection 50" }),
  ]);
  if (farmShopResult.status === "fulfilled") {
    try { addReferences(references, readFarmShop(parseToolData(farmShopResult.value))); }
    catch { errors.farmShop = "Farm shop query failed or returned invalid crop sale values."; }
  } else errors.farmShop = "Farm shop query failed or returned invalid crop sale values.";
  if (fishCollectionResult.status === "fulfilled") {
    try { addReferences(references, readFishCollection(parseToolData(fishCollectionResult.value))); }
    catch { errors.fishCollection = "Fish collection query failed or returned invalid fish sale values."; }
  } else errors.fishCollection = "Fish collection query failed or returned invalid fish sale values.";

  const inventoryById = new Map(inventory.map((item) => [item.itemId, item]));
  const ledgerEvaluation = evaluateRecipes(ledger, "ledger", references, inventoryById);
  let evaluation = ledgerEvaluation;
  let usedLatest50Fallback = false;

  if (ledgerEvaluation.cookable.length === 0) {
    usedLatest50Fallback = true;
    try {
      const latestData = parseToolData(await gateway.callTool("kitchen", { command: "recipes 50" }));
      if (!Array.isArray(latestData.recipes)) throw new Error();
      const latest = latestData.recipes.map(recipeFromUpstream);
      const ledgerIds = new Set(ledger.map((recipe) => recipe.dishItemId));
      const combined = [
        ...ledger.map((recipe) => ({ recipe, source: "ledger" as const })),
        ...latest.filter((recipe) => !ledgerIds.has(recipe.dishItemId)).map((recipe) => ({ recipe, source: "latest50Fallback" as const })),
      ];
      evaluation = evaluateRecipes(combined, undefined, references, inventoryById);
    } catch {
      errors.latest50Fallback = "The latest 50 recipes could not be fetched or validated.";
    }
  }

  payload.usedLatest50Fallback = usedLatest50Fallback;
  payload.cookableNow = sortCandidates(evaluation.cookable).slice(0, 5);
  payload.missingOne = sortCandidates(evaluation.missingOne).slice(0, 5);
  payload.canCookAnyNow = remainingCookCount > 0 && payload.cookableNow.length > 0;
  payload.unresolvedRecipeCount = evaluation.unresolved.length;
  payload.unresolvedIngredientSummary = summarizeUnresolved(evaluation.unresolved);
  if (Object.keys(errors).length > 0) payload.errors = errors;
  return resultFromPayload(payload, Object.keys(errors).length > 0);
}

function readRemainingCooks(data: Record<string, unknown>): number {
  const value = data.cooks_remaining ?? data.remaining_cook_count ?? data.remainingCookCount;
  if (!Number.isInteger(value) || (value as number) < 0) throw new Error();
  return value as number;
}

function readInventory(data: Record<string, unknown>): InventoryItem[] {
  if (!Array.isArray(data.items)) throw new Error();
  return data.items.map((value) => {
    const row = asObject(value);
    if (!row || typeof row.item !== "string" || typeof row.name !== "string" ||
        !Number.isInteger(row.quantity) || (row.quantity as number) < 0 ||
        typeof row.sell_value !== "number" || !Number.isFinite(row.sell_value)) throw new Error();
    return { itemId: row.item, name: row.name, quantity: row.quantity as number, sellValue: row.sell_value };
  });
}

function readReceivedGifts(data: Record<string, unknown>, receivedAt: string): GiftReceipt[] {
  if (data.received_gifts === undefined) return [];
  if (!Array.isArray(data.received_gifts)) throw new Error();
  return data.received_gifts.map((value) => {
    const row = asObject(value);
    if (!row || typeof row.from !== "string" || typeof row.item !== "string" || typeof row.item_name !== "string" ||
        !Number.isInteger(row.quantity) || (row.quantity as number) <= 0) throw new Error();
    return { fromName: row.from, receivedAt, itemId: row.item, itemName: row.item_name, quantity: row.quantity as number };
  });
}

function readFarmShop(data: Record<string, unknown>): ItemReference[] {
  if (!Array.isArray(data.seeds)) throw new Error();
  return data.seeds.map((value) => {
    const row = asObject(value);
    if (!row || typeof row.item !== "string" || !row.item.startsWith("seed_") || typeof row.name !== "string" ||
        (row.sell_value !== undefined && (typeof row.sell_value !== "number" || !Number.isFinite(row.sell_value)))) throw new Error();
    const name = row.name.endsWith("种子") ? row.name.slice(0, -2) : row.name;
    return { itemId: `crop_${row.item.slice(5)}`, name, sellValue: row.sell_value as number | undefined ?? null };
  });
}

function readFishCollection(data: Record<string, unknown>): ItemReference[] {
  if (!Array.isArray(data.fish)) throw new Error();
  return data.fish.map((value) => {
    const row = asObject(value);
    if (!row || typeof row.fish_id !== "string" || typeof row.name !== "string" ||
        (row.sell_value !== undefined && (typeof row.sell_value !== "number" || !Number.isFinite(row.sell_value)))) throw new Error();
    return { itemId: row.fish_id.startsWith("fish_") ? row.fish_id : `fish_${row.fish_id}`, name: row.name, sellValue: row.sell_value as number | undefined ?? null };
  });
}

function addReferences(target: Map<string, ItemReference[]>, items: ItemReference[]): void {
  for (const item of items) {
    const rows = target.get(item.name) ?? [];
    if (!rows.some((row) => row.itemId === item.itemId)) rows.push(item);
    target.set(item.name, rows);
  }
}

function evaluateRecipes(
  recipes: LedgerRecipe[] | Array<{ recipe: LedgerRecipe; source: CandidateSource }>,
  defaultSource: CandidateSource | undefined,
  references: Map<string, ItemReference[]>,
  inventory: Map<string, InventoryItem>,
): { cookable: Candidate[]; missingOne: Candidate[]; unresolved: Array<{ names: string[] }> } {
  const cookable: Candidate[] = [];
  const missingOne: Candidate[] = [];
  const unresolved: Array<{ names: string[] }> = [];
  for (const entry of recipes) {
    const recipe = "recipe" in entry ? entry.recipe : entry;
    const source = "recipe" in entry ? entry.source : defaultSource as CandidateSource;
    const duplicateNames = recipe.ingredientNames.filter((name, index, all) => all.indexOf(name) !== index);
    const unresolvedNames = [...new Set([...duplicateNames, ...recipe.ingredientNames.filter((name) => (references.get(name)?.length ?? 0) !== 1)])];
    if (unresolvedNames.length > 0) {
      unresolved.push({ names: unresolvedNames });
      continue;
    }
    const mapped = recipe.ingredientNames.map((name) => references.get(name)?.[0] as ItemReference);
    const missing = mapped.filter((item) => (inventory.get(item.itemId)?.quantity ?? 0) < 1);
    const ingredientSellValue = mapped.every((item) => item.sellValue !== null) ? mapped.reduce<number>((sum, item) => sum + (item.sellValue as number), 0) : null;
    const candidate: Candidate = {
      dishItemId: recipe.dishItemId,
      name: recipe.name,
      ingredientIds: mapped.map((item) => item.itemId),
      sellValue: recipe.sellValue,
      ingredientSellValue,
      valueAdded: ingredientSellValue === null ? null : recipe.sellValue - ingredientSellValue,
      valueAddedStatus: ingredientSellValue === null ? "missingIngredientSellValueUnavailable" : "calculated",
      source,
    };
    if (missing.length === 0) cookable.push(candidate);
    else if (missing.length === 1) missingOne.push({ ...candidate, missingIngredientId: missing[0]?.itemId as string });
  }
  return { cookable, missingOne, unresolved };
}

function sortCandidates(rows: Candidate[]): Candidate[] {
  return [...rows].sort((left, right) => {
    if (left.valueAdded === null && right.valueAdded !== null) return 1;
    if (left.valueAdded !== null && right.valueAdded === null) return -1;
    return (right.valueAdded ?? 0) - (left.valueAdded ?? 0) || right.sellValue - left.sellValue || left.dishItemId.localeCompare(right.dishItemId);
  });
}

function summarizeUnresolved(rows: Array<{ names: string[] }>): Array<{ name: string; recipeCount: number }> {
  const counts = new Map<string, number>();
  for (const row of rows) for (const name of row.names) counts.set(name, (counts.get(name) ?? 0) + 1);
  return [...counts].map(([name, recipeCount]) => ({ name, recipeCount })).sort((left, right) => right.recipeCount - left.recipeCount || left.name.localeCompare(right.name));
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
