import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runDailyRoutine } from "../src/tools/daily-routine.js";
import { FakeGateway, raw } from "./helpers.js";

function routineGateway(): FakeGateway {
  return new FakeGateway({
    garden_work: raw({ ok: true }),
    "fish buy bread 10": raw({ bought: 10 }),
    "fish cast 10": raw({ catches: ["fish"] }),
    "kitchen recipes 50": raw({ recipes: [
      { item: "dish_low", name: "低价菜", ingredients: ["白菜"], sell_value: 10 },
      { item: "dish_high", name: "高价菜", ingredients: ["鱼", "鸡蛋"], sell_value: 500 },
    ] }),
  });
}

test("daily_routine uses a UTC garden day, runs manually once, and disables both recipe steps together", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "handytools-routine-"));
  const gateway = routineGateway();
  const options = {
    gateway,
    stateFile: path.join(directory, "state.json"),
    ledgerFile: path.join(directory, "recipes.md"),
    recipeLedgerEnabled: false,
    now: () => new Date("2026-09-11T23:59:59Z"),
  };
  const first = await runDailyRoutine(options);
  assert.equal(first.structuredContent.gardenDay, "2026-09-11");
  assert.equal(first.structuredContent.nextResetAt, "2026-09-12T00:00:00.000Z");
  assert.deepEqual(gateway.calls.map((call) => call.name), ["garden_work", "garden_work", "garden_work", "fish", "fish"]);
  assert.deepEqual(first.structuredContent.steps.slice(-2).map((step) => step.status), ["disabled", "disabled"]);

  gateway.calls.length = 0;
  const second = await runDailyRoutine(options);
  assert.equal(second.structuredContent.status, "completed");
  assert.equal(gateway.calls.length, 0);
});

test("daily_routine sorts latest recipes, writes the ledger, and returns every successful raw result", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "handytools-routine-"));
  const gateway = routineGateway();
  const result = await runDailyRoutine({
    gateway,
    stateFile: path.join(directory, "state.json"),
    ledgerFile: path.join(directory, "recipes.md"),
    recipeLedgerEnabled: true,
    now: () => new Date("2026-09-12T00:00:00Z"),
  });
  assert.equal(result.structuredContent.status, "completed");
  assert.ok(result.structuredContent.steps.slice(0, 6).every((step) => "result" in step));
  const top = result.structuredContent.steps.find((step) => step.id === "recipes_top_5");
  assert.equal(top?.result?.content[0]?.type, "text");
  const rawRows = JSON.parse(top?.result?.content[0]?.text ?? "{}") as { recipes: Array<{ item: string }> };
  assert.equal(rawRows.recipes.length, 2);
  const topRows = top?.topRecipes as Array<{ item: string }>;
  assert.equal(topRows[0]?.item, "dish_high");
  const ledger = await readFile(path.join(directory, "recipes.md"), "utf8");
  assert.match(ledger, /"dishItemId": "dish_high"/u);
  assert.ok(result.structuredContent.steps.find((step) => step.id === "update_recipe_ledger")?.result);
});

test("daily_routine reports the exact failed step, keeps successes and marks the rest not_run", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "handytools-routine-"));
  const gateway = new FakeGateway({ garden_work: raw({ code: "down" }, true) });
  const result = await runDailyRoutine({
    gateway,
    stateFile: path.join(directory, "state.json"),
    ledgerFile: path.join(directory, "recipes.md"),
    recipeLedgerEnabled: true,
  });
  assert.equal(result.structuredContent.status, "partial_failure");
  assert.equal(result.structuredContent.failedStep, "garden_work_1");
  assert.equal(result.structuredContent.steps[0]?.status, "failed");
  assert.ok(result.structuredContent.steps.slice(1).every((step) => step.status === "not_run"));
});

test("daily_routine treats an upstream work_limit as completed outside the tool and continues", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "handytools-routine-"));
  const gateway = routineGateway();
  gateway.set("garden_work", raw({ code: "work_limit" }, true));
  const result = await runDailyRoutine({
    gateway,
    stateFile: path.join(directory, "state.json"),
    ledgerFile: path.join(directory, "recipes.md"),
    recipeLedgerEnabled: false,
  });
  assert.equal(result.structuredContent.status, "completed");
  assert.deepEqual(result.structuredContent.steps.slice(0, 3).map((step) => step.status), [
    "completed_by_daily_limit", "completed_by_daily_limit", "completed_by_daily_limit",
  ]);
  assert.deepEqual(gateway.calls.map((call) => `${call.name} ${String(call.arguments.command ?? "")}`.trim()), [
    "garden_work", "fish buy bread 10", "fish cast 10",
  ]);
});

test("daily_routine persists an unknown mutating outcome and never retries it implicitly", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "handytools-routine-"));
  let purchases = 0;
  const gateway = new FakeGateway({
    garden_work: raw({ ok: true }),
    "fish buy bread 10": new Error("response lost after purchase may have completed"),
  });
  const options = {
    gateway,
    stateFile: path.join(directory, "state.json"),
    ledgerFile: path.join(directory, "recipes.md"),
    recipeLedgerEnabled: false,
    now: () => new Date("2026-09-12T12:00:00Z"),
  };
  const originalCall = gateway.callTool.bind(gateway);
  gateway.callTool = async (name, args) => {
    if (name === "fish" && args.command === "buy bread 10") purchases += 1;
    return originalCall(name, args);
  };

  const first = await runDailyRoutine(options);
  assert.equal(first.structuredContent.status, "needs_resolution");
  assert.equal(first.structuredContent.failedStep, "buy_bread_10");
  assert.equal(first.structuredContent.steps[3]?.status, "outcome_unknown");
  assert.match(first.structuredContent.error ?? "", /ask the user.*explicit choice/iu);
  assert.equal(purchases, 1);

  gateway.calls.length = 0;
  const second = await runDailyRoutine(options);
  assert.equal(second.structuredContent.status, "needs_resolution");
  assert.equal(gateway.calls.length, 0);
  assert.equal(purchases, 1);
});

test("daily_routine requires an explicit choice before resolving an unknown step", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "handytools-routine-"));
  const gateway = routineGateway();
  gateway.set("fish buy bread 10", new Error("response lost"));
  const options = {
    gateway,
    stateFile: path.join(directory, "state.json"),
    ledgerFile: path.join(directory, "recipes.md"),
    recipeLedgerEnabled: false,
    now: () => new Date("2026-09-12T12:00:00Z"),
  };
  await runDailyRoutine(options);
  gateway.set("fish buy bread 10", raw({ bought: 10 }));
  gateway.calls.length = 0;

  const assumed = await runDailyRoutine({ ...options, resolveUnknown: "assume_completed" });
  assert.equal(assumed.structuredContent.status, "completed");
  assert.equal(assumed.structuredContent.steps[3]?.status, "completed_by_user");
  assert.equal(gateway.calls.some((call) => call.arguments.command === "buy bread 10"), false);
  assert.equal(gateway.calls.some((call) => call.arguments.command === "cast 10"), true);
});

test("daily_routine retries an unknown step only after the explicit retry choice", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "handytools-routine-"));
  const gateway = routineGateway();
  gateway.set("fish buy bread 10", new Error("response lost"));
  const options = {
    gateway,
    stateFile: path.join(directory, "state.json"),
    ledgerFile: path.join(directory, "recipes.md"),
    recipeLedgerEnabled: false,
    now: () => new Date("2026-09-12T12:00:00Z"),
  };
  await runDailyRoutine(options);
  gateway.set("fish buy bread 10", raw({ bought: 10 }));
  gateway.calls.length = 0;

  const retried = await runDailyRoutine({ ...options, resolveUnknown: "retry" });
  assert.equal(retried.structuredContent.status, "completed");
  assert.equal(retried.structuredContent.steps[3]?.resolution, "retry_requested");
  assert.equal(gateway.calls.filter((call) => call.arguments.command === "buy bread 10").length, 1);
});
