import assert from "node:assert/strict";
import { access, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { BAIT_KEYS } from "../src/tools/fish-state.js";
import { runFishingTrip } from "../src/tools/fishing-trip.js";
import { FakeGateway, raw } from "./helpers.js";

async function setup({ stock = {}, balance = 1000, remaining = 10 }: { stock?: Record<string, number>; balance?: number; remaining?: number } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "handytools-fishing-"));
  const lockFile = path.join(directory, "fishing-trip.lock");
  const gateway = new FakeGateway({
    "fish status": raw({ casts_remaining: remaining, bait: Object.entries(stock).map(([key, quantity]) => ({ key, quantity })) }),
    "fish shop": raw({ moon_balance: balance, bait: BAIT_KEYS.map((key, index) => ({ item: `bait_${key}`, name: key, price: (index + 1) * 5 })) }),
  });
  for (const [index, key] of BAIT_KEYS.entries()) {
    for (let count = 1; count <= 10; count += 1) gateway.set(`fish buy ${key} ${count}`, raw({ item: `bait_${key}`, quantity: count, cost: count * (index + 1) * 5 }));
    gateway.set(`fish cast 1 ${key}`, raw({ fish: `fish_sample_${key}`, sold: false }));
  }
  return { gateway, lockFile };
}

const commands = (gateway: FakeGateway) => gateway.calls.map((call) => String(call.arguments.command));

test("omitted/all-zero casts are no-op without querying or creating a lock", async () => {
  const options = await setup();
  for (const args of [{}, Object.fromEntries(BAIT_KEYS.map((key) => [key, 0]))]) {
    const payload = (await runFishingTrip({ ...options, args })).structuredContent;
    assert.equal(payload.status, "noop");
    assert.equal(payload.message, "未购买、未钓鱼。");
    assert.equal(payload.remainingSteps, "none");
  }
  assert.equal(options.gateway.calls.length, 0);
  await assert.rejects(access(options.lockFile));
});

test("invalid counts, unknown keys and unsafe totals stop without upstream calls", async () => {
  for (const args of [{ bread: -1 }, { bread: 1.5 }, { bread: null }, { bread: "1" }, { other: 1 }, { bread: Number.MAX_SAFE_INTEGER, fullmoon: 1 }]) {
    const options = await setup();
    const result = await runFishingTrip({ ...options, args });
    assert.equal(result.structuredContent.failedStep?.stage, "validation");
    assert.equal(result.isError, true);
    assert.equal(options.gateway.calls.length, 0);
  }
});

test("insufficient quota reports today's remaining count before querying the shop or making purchases", async () => {
  const options = await setup({ remaining: 1 });
  const payload = (await runFishingTrip({ ...options, args: { fullmoon: 2 } })).structuredContent;
  assert.equal(payload.failedStep?.code, "insufficient_casts");
  assert.equal(payload.remainingCastCountBefore, 1);
  assert.deepEqual(commands(options.gateway), ["status"]);
  assert.equal(payload.notRunCastCount, 2);
});

test("wallet must cover ALL shortages after stock subtraction, never buying one affordable bait first", async () => {
  const options = await setup({ stock: { fullmoon: 1, bread: 1 }, balance: 28 });
  const payload = (await runFishingTrip({ ...options, args: { fullmoon: 2, bread: 2 } })).structuredContent;
  assert.equal(payload.requiredMoon, 30);
  assert.equal(payload.failedStep?.code, "insufficient_moon");
  assert.deepEqual(commands(options.gateway), ["status", "shop"]);
  assert.equal(payload.spentMoon, 0);
  assert.deepEqual(payload.notRunPurchaseKeys, ["fullmoon", "bread"]);
  assert.equal(payload.notRunCastCount, 4);
});

test("buys only shortages, then casts individually in fixed five-bait order and returns all raw receipts", async () => {
  const options = await setup({ stock: { fullmoon: 1 } });
  const payload = (await runFishingTrip({ ...options, args: { bread: 1, moonworm: 1, stardust: 1, moonhalo: 1, fullmoon: 2 } })).structuredContent;
  assert.equal(payload.status, "completed");
  assert.equal(payload.requiredMoon, 75);
  assert.equal(payload.spentMoon, 75);
  assert.equal(payload.purchasedBaitCounts.fullmoon, 1);
  assert.deepEqual(commands(options.gateway), ["status", "shop",
    "buy fullmoon 1", "buy moonhalo 1", "buy stardust 1", "buy moonworm 1", "buy bread 1",
    "cast 1 fullmoon", "cast 1 fullmoon", "cast 1 moonhalo", "cast 1 stardust", "cast 1 moonworm", "cast 1 bread"]);
  assert.equal(payload.remainingCastCountBefore, 10);
  assert.equal(payload.purchaseTotalsComplete, true);
  assert.equal(payload.purchases.length, 5);
  assert.equal(payload.casts.length, 6);
  assert.ok([...payload.purchases, ...payload.casts].every((receipt) => receipt.state === "completed" && receipt.result?.content[0]?.text));
  assert.equal(payload.remainingSteps, "none");
  assert.equal(payload.notRunCastCount, 0);
  await assert.rejects(access(options.lockFile));
});

test("held bait costs nothing and a later invocation is not daily-blocked", async () => {
  const options = await setup({ stock: { bread: 2 }, balance: 0 });
  for (let invocation = 0; invocation < 2; invocation += 1) {
    const payload = (await runFishingTrip({ ...options, args: { bread: 1 } })).structuredContent;
    assert.equal(payload.status, "completed");
    assert.equal(payload.requiredMoon, 0);
    assert.equal(payload.spentMoon, 0);
  }
  assert.deepEqual(commands(options.gateway), ["status", "shop", "cast 1 bread", "status", "shop", "cast 1 bread"]);
});

test("explicit purchase failure retains prior purchase costs and stops all casting", async () => {
  const options = await setup();
  options.gateway.set("fish buy bread 1", raw({ code: "down" }, true));
  const payload = (await runFishingTrip({ ...options, args: { fullmoon: 1, bread: 1 } })).structuredContent;
  assert.equal(payload.status, "partial_failure");
  assert.equal(payload.failedStep?.baitKey, "bread");
  assert.equal(payload.failedStep?.state, "failed");
  assert.equal(payload.spentMoon, 25);
  assert.equal(payload.purchasedBaitCounts.fullmoon, 1);
  assert.equal(payload.purchases[1]?.result?.isError, true);
  assert.equal(payload.casts.length, 0);
  assert.equal(payload.notRunCastCount, 2);
});

test("purchase timeout or invalid acknowledgement is unknown, confirmed-only totals are explicitly incomplete", async () => {
  for (const badResult of [new Error("timeout"), raw({ item: "bait_bread", quantity: 1 }), raw({ item: "wrong", quantity: 1, cost: 5 })]) {
    const options = await setup();
    options.gateway.set("fish buy bread 1", badResult);
    const payload = (await runFishingTrip({ ...options, args: { fullmoon: 1, bread: 1 } })).structuredContent;
    assert.equal(payload.failedStep?.code, "purchase_result_unknown");
    assert.equal(payload.purchaseTotalsComplete, false);
    assert.equal(payload.purchases[1]?.state, "unknown");
    assert.equal(payload.purchases[1]?.cost, null);
    assert.equal(payload.spentMoon, 25);
    assert.equal(payload.casts.length, 0);
    assert.equal(commands(options.gateway).filter((command) => command === "buy bread 1").length, 1);
  }
});

test("confirmed purchase quantity mismatch retains actual costs, stops later purchases and casts", async () => {
  const options = await setup();
  options.gateway.set("fish buy fullmoon 2", raw({ item: "bait_fullmoon", quantity: 1, cost: 24 }));
  const payload = (await runFishingTrip({ ...options, args: { fullmoon: 2, bread: 1 } })).structuredContent;
  assert.equal(payload.failedStep?.code, "purchase_quantity_mismatch");
  assert.equal(payload.spentMoon, 24);
  assert.equal(payload.purchasedBaitCounts.fullmoon, 1);
  assert.deepEqual(payload.notRunPurchaseKeys, ["bread"]);
  assert.equal(payload.casts.length, 0);
});

test("mid-cast disconnect identifies the unknown rod, retains successful catch and does not retry", async () => {
  const options = await setup({ stock: { bread: 3 } });
  const original = options.gateway.callTool.bind(options.gateway);
  let casts = 0;
  options.gateway.callTool = async (name, args) => {
    if (args.command === "cast 1 bread" && ++casts === 2) {
      options.gateway.calls.push({ name, arguments: args });
      throw new Error("timeout");
    }
    return original(name, args);
  };
  const payload = (await runFishingTrip({ ...options, args: { bread: 3 } })).structuredContent;
  assert.equal(payload.failedStep?.castNumber, 2);
  assert.equal(payload.failedStep?.state, "unknown");
  assert.equal(payload.casts[0]?.state, "completed");
  assert.ok(payload.casts[0]?.result);
  assert.equal(payload.casts[1]?.state, "unknown");
  assert.equal(payload.notRunCastCount, 1);
  assert.equal(casts, 2);
});

test("empty casts and auto-sold fish are retained; explicit cast rejection stops", async () => {
  const options = await setup({ stock: { bread: 3 } });
  const responses = [raw({ catches: [], empty: true }), raw({ fish: "sample", sold: true }), raw({ code: "limit" }, true)];
  const original = options.gateway.callTool.bind(options.gateway);
  options.gateway.callTool = async (name, args) => {
    if (args.command === "cast 1 bread") {
      options.gateway.calls.push({ name, arguments: args });
      return responses.shift()!;
    }
    return original(name, args);
  };
  const payload = (await runFishingTrip({ ...options, args: { bread: 3 } })).structuredContent;
  assert.equal(payload.failedStep?.code, "cast_failed");
  assert.equal(payload.failedStep?.castNumber, 3);
  assert.equal(payload.casts[0]?.state, "completed");
  assert.equal(payload.casts[1]?.state, "completed");
  assert.equal(payload.casts[2]?.state, "failed");
  assert.match(payload.casts[1]?.result?.content[0]?.text ?? "", /"sold":true/u);
});

test("source errors and an existing lock cause no game actions and never delete another run's lock", async () => {
  for (const source of ["fish status", "fish shop"]) {
    const options = await setup();
    options.gateway.set(source, new Error("offline"));
    const payload = (await runFishingTrip({ ...options, args: { bread: 1 } })).structuredContent;
    assert.equal(payload.failedStep?.code, "source_error");
    assert.equal(commands(options.gateway).some((command) => /buy|cast/u.test(command)), false);
  }
  const options = await setup();
  await writeFile(options.lockFile, "another run");
  const payload = (await runFishingTrip({ ...options, args: { bread: 1 } })).structuredContent;
  assert.equal(payload.failedStep?.stage, "lock");
  assert.equal(options.gateway.calls.length, 0);
  await access(options.lockFile);
});
