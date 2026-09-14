import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runRecipeCheck } from "../src/tools/recipe-check.js";
import { FakeGateway, raw } from "./helpers.js";

async function writeLedger(file: string, recipes: unknown[]): Promise<void> {
  await writeFile(file, `# Moonlight Garden expensive recipes\n\n\`\`\`json\n${JSON.stringify(recipes, null, 2)}\n\`\`\`\n`, "utf8");
}

function baseGateway(latest: unknown[] = []): FakeGateway {
  return new FakeGateway({
    "kitchen status": raw({ cooks_remaining: 3 }),
    "inventory list": raw({ items: [
      { item: "crop_carrot", name: "胡萝卜", quantity: 1, sell_value: 10 },
      { item: "produce_egg", name: "鸡蛋", quantity: 1, sell_value: 18 },
    ] }),
    "farm shop": raw({ seeds: [] }),
    "fish collection 50": raw({ fish: [{ fish_id: "moon", name: "月鱼", sell_value: 30 }] }),
    "kitchen recipes 50": raw({ recipes: latest }),
  });
}

test("recipe_check errors on a missing local ledger instead of returning empty candidates", async () => {
  const gateway = baseGateway();
  const result = await runRecipeCheck({ gateway, ledgerFile: "/definitely/missing/recipes.md" });
  assert.equal(result.isError, true);
  assert.ok(result.structuredContent.errors?.ledger);
  assert.equal("cookableNow" in result.structuredContent, false);
  assert.equal(gateway.calls.length, 0);
});

test("recipe_check calculates value added, reports one missing ingredient and does not fallback when ledger is cookable", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "handytools-check-"));
  const ledgerFile = path.join(directory, "recipes.md");
  await writeLedger(ledgerFile, [
    { dishItemId: "dish_ready", name: "胡萝卜蒸蛋", ingredientNames: ["胡萝卜", "鸡蛋"], sellValue: 100 },
    { dishItemId: "dish_missing", name: "月鱼汤", ingredientNames: ["胡萝卜", "月鱼"], sellValue: 150 },
    { dishItemId: "dish_unknown", name: "神兽汤", ingredientNames: ["毕方"], sellValue: 900 },
  ]);
  const gateway = baseGateway();
  const result = await runRecipeCheck({ gateway, ledgerFile });
  const payload = result.structuredContent;
  assert.equal(payload.usedLatest50Fallback, false);
  assert.equal(payload.canCookAnyNow, true);
  assert.equal(payload.cookableNow?.[0]?.ingredientSellValue, 28);
  assert.equal(payload.cookableNow?.[0]?.valueAdded, 72);
  assert.equal(payload.missingOne?.[0]?.missingIngredientId, "fish_moon");
  assert.equal(payload.missingOne?.[0]?.valueAdded, 110);
  assert.equal(payload.unresolvedRecipeCount, 1);
  assert.deepEqual(payload.unresolvedIngredientSummary, [{ name: "毕方", recipeCount: 1 }]);
  assert.equal(gateway.calls.some((call) => call.arguments.command === "recipes 50"), false);
});

test("recipe_check falls back to latest 50 only when the ledger has no cookable recipe", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "handytools-check-"));
  const ledgerFile = path.join(directory, "recipes.md");
  await writeLedger(ledgerFile, [
    { dishItemId: "dish_old", name: "月鱼汤", ingredientNames: ["月鱼"], sellValue: 50 },
  ]);
  const gateway = baseGateway([
    { item: "dish_latest", name: "胡萝卜蒸蛋", ingredients: ["胡萝卜", "鸡蛋"], sell_value: 120 },
  ]);
  const payload = (await runRecipeCheck({ gateway, ledgerFile })).structuredContent;
  assert.equal(payload.usedLatest50Fallback, true);
  assert.equal(payload.cookableNow?.[0]?.dishItemId, "dish_latest");
  assert.equal(payload.cookableNow?.[0]?.source, "latest50Fallback");
});

test("recipe_check returns a UTC receipt when inventory list auto-claims gifts", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "handytools-check-"));
  const ledgerFile = path.join(directory, "recipes.md");
  await writeLedger(ledgerFile, [
    { dishItemId: "dish_ready", name: "胡萝卜蒸蛋", ingredientNames: ["胡萝卜", "鸡蛋"], sellValue: 100 },
  ]);
  const gateway = baseGateway();
  gateway.set("inventory list", raw({
    items: [
      { item: "crop_carrot", name: "胡萝卜", quantity: 1, sell_value: 10 },
      { item: "produce_egg", name: "鸡蛋", quantity: 1, sell_value: 18 },
    ],
    received_gifts: [
      { from: "哈迪斯", item: "fish_maple_fish", item_name: "枫月鱼", quantity: 1 },
    ],
  }));
  const payload = (await runRecipeCheck({
    gateway,
    ledgerFile,
    now: () => new Date("2026-09-11T04:05:06.789Z"),
  })).structuredContent;
  assert.deepEqual(payload.receivedGifts, [{
    fromName: "哈迪斯",
    receivedAt: "2026-09-11T04:05:06.789Z",
    itemId: "fish_maple_fish",
    itemName: "枫月鱼",
    quantity: 1,
  }]);
});

test("recipe_check maps a missing crop without inventing a sale value from seed price", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "handytools-check-"));
  const ledgerFile = path.join(directory, "recipes.md");
  await writeLedger(ledgerFile, [
    { dishItemId: "dish_missing", name: "胡萝卜蒸蛋", ingredientNames: ["胡萝卜", "鸡蛋"], sellValue: 100 },
  ]);
  const gateway = baseGateway();
  gateway.set("inventory list", raw({ items: [
    { item: "produce_egg", name: "鸡蛋", quantity: 1, sell_value: 18 },
  ] }));
  gateway.set("farm shop", raw({ seeds: [
    { item: "seed_carrot", name: "胡萝卜种子", price: 9999 },
  ] }));
  const payload = (await runRecipeCheck({ gateway, ledgerFile })).structuredContent;
  assert.equal(payload.missingOne?.[0]?.missingIngredientId, "crop_carrot");
  assert.equal(payload.missingOne?.[0]?.ingredientSellValue, null);
  assert.equal(payload.missingOne?.[0]?.valueAdded, null);
  assert.equal(payload.missingOne?.[0]?.valueAddedStatus, "missingIngredientSellValueUnavailable");
});

test("recipe_check preserves an auto-claimed gift receipt when inventory items are invalid", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "handytools-check-"));
  const ledgerFile = path.join(directory, "recipes.md");
  await writeLedger(ledgerFile, []);
  const gateway = baseGateway();
  gateway.set("inventory list", raw({
    items: [{ item: "broken" }],
    received_gifts: [{ from: "朋友", item: "crop_cabbage", item_name: "白菜", quantity: 2 }],
  }));
  const result = await runRecipeCheck({ gateway, ledgerFile, now: () => new Date("2026-09-11T07:08:09Z") });
  assert.equal(result.isError, true);
  assert.ok(result.structuredContent.errors?.inventory);
  assert.deepEqual(result.structuredContent.receivedGifts, [{
    fromName: "朋友",
    receivedAt: "2026-09-11T07:08:09.000Z",
    itemId: "crop_cabbage",
    itemName: "白菜",
    quantity: 2,
  }]);
});
