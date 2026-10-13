import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runDailyRoutine } from "../src/tools/daily-routine.js";
import { FakeGateway, raw } from "./helpers.js";

function routineGateway(): FakeGateway {
  return new FakeGateway({
    garden_work: raw({ ok: true }),
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
  assert.deepEqual(gateway.calls.map((call) => call.name), ["garden_work", "garden_work", "garden_work"]);
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
  assert.equal(result.structuredContent.steps.length, 5);
  assert.ok(result.structuredContent.steps.every((step) => "result" in step));
  assert.equal(gateway.calls.some((call) => call.name === "fish"), false);
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
    "garden_work",
  ]);
});

test("daily_routine persists an unknown mutating outcome and never retries it implicitly", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "handytools-routine-"));
  let jobs = 0;
  const gateway = new FakeGateway({
    garden_work: new Error("response lost after work may have completed"),
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
    if (name === "garden_work") jobs += 1;
    return originalCall(name, args);
  };

  const first = await runDailyRoutine(options);
  assert.equal(first.structuredContent.status, "needs_resolution");
  assert.equal(first.structuredContent.failedStep, "garden_work_1");
  assert.equal(first.structuredContent.steps[0]?.status, "outcome_unknown");
  assert.match(first.structuredContent.error ?? "", /ask the user.*explicit choice/iu);
  assert.equal(jobs, 1);

  gateway.calls.length = 0;
  const second = await runDailyRoutine(options);
  assert.equal(second.structuredContent.status, "needs_resolution");
  assert.equal(gateway.calls.length, 0);
  assert.equal(jobs, 1);
});

test("daily_routine requires an explicit choice before resolving an unknown step", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "handytools-routine-"));
  const gateway = routineGateway();
  gateway.set("garden_work", new Error("response lost"));
  const options = {
    gateway,
    stateFile: path.join(directory, "state.json"),
    ledgerFile: path.join(directory, "recipes.md"),
    recipeLedgerEnabled: false,
    now: () => new Date("2026-09-12T12:00:00Z"),
  };
  await runDailyRoutine(options);
  gateway.set("garden_work", raw({ ok: true }));
  gateway.calls.length = 0;

  const assumed = await runDailyRoutine({ ...options, resolveUnknown: "assume_completed" });
  assert.equal(assumed.structuredContent.status, "completed");
  assert.equal(assumed.structuredContent.steps[0]?.status, "completed_by_user");
  assert.equal(gateway.calls.filter((call) => call.name === "garden_work").length, 2);
  assert.equal(gateway.calls.some((call) => call.name === "fish"), false);
});

test("daily_routine retries an unknown step only after the explicit retry choice", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "handytools-routine-"));
  const gateway = routineGateway();
  gateway.set("garden_work", new Error("response lost"));
  const options = {
    gateway,
    stateFile: path.join(directory, "state.json"),
    ledgerFile: path.join(directory, "recipes.md"),
    recipeLedgerEnabled: false,
    now: () => new Date("2026-09-12T12:00:00Z"),
  };
  await runDailyRoutine(options);
  gateway.set("garden_work", raw({ ok: true }));
  gateway.calls.length = 0;

  const retried = await runDailyRoutine({ ...options, resolveUnknown: "retry" });
  assert.equal(retried.structuredContent.status, "completed");
  assert.equal(retried.structuredContent.steps[0]?.resolution, "retry_requested");
  assert.equal(gateway.calls.filter((call) => call.name === "garden_work").length, 3);
});

test("old daily state retains completed jobs/recipes and drops obsolete unknown fishing without blocking ledger writes", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "handytools-routine-"));
  const stateFile = path.join(directory, "state.json");
  await writeFile(stateFile, JSON.stringify({ version: 1, gardenDay: "2026-10-13", steps: [
    ...[1, 2, 3].map((index) => ({ id: `garden_work_${index}`, status: "completed", result: raw({ ok: true }) })),
    { id: "buy_bread_10", status: "outcome_unknown" },
    { id: "fish_cast_10", status: "not_run" },
    { id: "recipes_top_5", status: "completed", result: raw({ recipes: [] }), topRecipes: [{ item: "dish_saved", name: "已取到", ingredients: ["鸡蛋"], sell_value: 10 }] },
    { id: "update_recipe_ledger", status: "not_run" },
  ] }));
  const gateway = new FakeGateway({});
  const result = await runDailyRoutine({ gateway, stateFile, ledgerFile: path.join(directory, "recipes.md"), recipeLedgerEnabled: true, now: () => new Date("2026-10-13T12:00:00Z") });
  assert.equal(result.structuredContent.status, "completed");
  assert.equal(gateway.calls.length, 0);
  assert.equal(result.structuredContent.steps.length, 5);
  assert.match(await readFile(path.join(directory, "recipes.md"), "utf8"), /dish_saved/u);
  assert.doesNotMatch(await readFile(stateFile, "utf8"), /buy_bread|fish_cast/u);
});

test("daily ledger write failure is separate from a successful recipe fetch and retried without more game actions", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "handytools-routine-"));
  const blocker = path.join(directory, "not-a-directory");
  await writeFile(blocker, "block");
  const gateway = routineGateway();
  const options = { gateway, stateFile: path.join(directory, "state.json"), ledgerFile: path.join(blocker, "ledger.md"), recipeLedgerEnabled: true };
  const first = await runDailyRoutine(options);
  assert.equal(first.structuredContent.failedStep, "update_recipe_ledger");
  assert.equal(first.structuredContent.steps[3]?.status, "completed");
  gateway.calls.length = 0;
  const second = await runDailyRoutine({ ...options, ledgerFile: path.join(directory, "ledger.md") });
  assert.equal(second.structuredContent.status, "completed");
  assert.equal(gateway.calls.length, 0);
});
