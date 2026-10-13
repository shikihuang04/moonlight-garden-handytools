import assert from "node:assert/strict";
import test from "node:test";

import { runFarmBrief } from "../src/tools/farm-brief.js";
import { FakeGateway, raw } from "./helpers.js";

const HOME_BEES = {
  hive: [{
    bee_id: "abc123",
    index: 1,
    name: "样例蜂",
    label: "霜白·斑点·逐月",
    color: "frostwhite",
    pattern: "spot",
    preference: "moon",
    prefers_crops: ["幻光蘑菇", "落叶菇"],
  }],
  count: "1/4",
  slots: 4,
  codex: "2/224",
  trips_left_today: 1,
  waiting: [{
    bee_id: "def456",
    index: null,
    name: null,
    label: "蜜金·斑点·醉果",
    color: "honeygold",
    pattern: "spot",
    preference: "sweet",
    prefers_crops: ["草莓", "西瓜"],
  }],
};

function gatewayWithBees(results: Record<string, ReturnType<typeof raw> | Error>, bees: ReturnType<typeof raw> | Error = raw(HOME_BEES)): FakeGateway {
  return new FakeGateway({
    "pet status": raw({ pets: [], slots_free: 2, hint: "尚无已核对提示" }),
    "kitchen status": raw({ jars: [], jars_free: 3, brews: [] }),
    "festival status": raw({ festival: null }),
    "park status": raw({ plays_left_today: 5, tickets: 0 }),
    "fish status": raw({ casts_remaining: 10, bait: [] }),
    "fish shop": raw({ moon_balance: 100, bait: ["bread", "moonworm", "stardust", "moonhalo", "fullmoon"].map((key) => ({ item: `bait_${key}`, name: key, price: 5 })) }),
    ...results, "bee status": bees,
  });
}

test("farm_brief returns UTC status, cumulative windows, watering data and a configurable cabbage gap", async () => {
  const gateway = gatewayWithBees({
    "farm status": raw({
      plots: [
        { plot: 1, state: "growing", crop: "phantom_shroom", matures_in_seconds: 1800 },
        { plot: 2, state: "house" },
        { plot: 3, state: "mature", crop: "cabbage" },
        { plot: 4, state: "empty" },
      ],
      house: { plot: 2 },
      inventory: { crop_cabbage: 1 },
      water_cooldown_seconds: 90.2,
    }),
    "coop status": raw({ chickens: [
      { index: 1, state: "laying", status: "正在下蛋，还要 2 分" },
      { index: 2, state: "hungry" },
    ] }),
  });

  const result = await runFarmBrief({
    gateway,
    cabbageFormula: "chickenCount * 3 - cabbageInInventory",
    now: () => new Date("2026-09-11T01:02:03.400Z"),
  });
  const payload = result.structuredContent;
  assert.equal(result.isError, undefined);
  assert.equal(payload.checkedAt, "2026-09-11T01:02:03.400Z");
  assert.deepEqual(payload.plots, [
    { plotId: 1, cropId: "phantom_shroom", maturesInSeconds: 1800 },
    { plotId: 3, cropId: "cabbage", maturesInSeconds: 0 },
    { plotId: 4, cropId: null, maturesInSeconds: null },
  ]);
  assert.deepEqual(payload.maturingWithinHours, { "1": [1], "2": [1], "4": [1] });
  assert.deepEqual(payload.maturesIfWateredPlotIds, [1]);
  assert.equal(payload.waterCooldownSeconds, 91);
  assert.equal(payload.waterAvailableAt, "2026-09-11T01:03:34.400Z");
  assert.equal(payload.cabbagePlantGap, 5);
  assert.deepEqual(payload.bees, {
    hiveCount: 1,
    hiveSlots: 4,
    tripsLeftToday: 1,
    tripState: "home",
    backAt: null,
    backInText: null,
    codexCount: 2,
    codexTotal: 224,
    hive: [{
      beeId: "abc123",
      index: 1,
      name: "样例蜂",
      label: "霜白·斑点·逐月",
      colorId: "frostwhite",
      patternId: "spot",
      preferenceId: "moon",
      preferredCrops: ["幻光蘑菇", "落叶菇"],
    }],
    waitingYoung: [{
      beeId: "def456",
      label: "蜜金·斑点·醉果",
      colorId: "honeygold",
      patternId: "spot",
      preferenceId: "sweet",
      preferredCrops: ["草莓", "西瓜"],
    }],
  });
  assert.deepEqual(gateway.calls, [
    { name: "farm", arguments: { command: "status" } },
    { name: "coop", arguments: { command: "status" } },
    { name: "bee", arguments: { command: "status" } },
    { name: "pet", arguments: { command: "status" } },
    { name: "kitchen", arguments: { command: "status" } },
    { name: "festival", arguments: { command: "status" } },
    { name: "park", arguments: { command: "status" } },
    { name: "fish", arguments: { command: "status" } },
    { name: "fish", arguments: { command: "shop" } },
  ]);
});

test("farm_brief omits only failed sources and never invents a cabbage gap", async () => {
  const gateway = gatewayWithBees({
    "farm status": raw({ plots: [], inventory: {}, water_cooldown_seconds: 0 }),
    "coop status": new Error("private detail"),
  });
  const result = await runFarmBrief({ gateway, cabbageFormula: "chickenCount * 2 - cabbageInInventory" });
  const payload = result.structuredContent;
  assert.equal(result.isError, true);
  assert.equal(payload.cabbageInInventory, 0);
  assert.ok(payload.errors?.coop);
  assert.equal("chickens" in payload, false);
  assert.equal("cabbagePlantGap" in payload, false);
});

test("invalid custom formula is isolated as its own source error", async () => {
  const gateway = gatewayWithBees({
    "farm status": raw({ plots: [], inventory: { crop_cabbage: 1 }, water_cooldown_seconds: 0 }),
    "coop status": raw({ chickens: [] }),
  });
  const result = await runFarmBrief({ gateway, cabbageFormula: "Math.max(chickenCount, 0)" });
  assert.ok(result.structuredContent.errors?.cabbagePlantGapFormula);
  assert.equal("cabbagePlantGap" in result.structuredContent, false);
});

test("farm_brief distinguishes bees away from bees ready to settle", async () => {
  const sources = {
    "farm status": raw({ plots: [], inventory: {}, water_cooldown_seconds: 0 }),
    "coop status": raw({ chickens: [] }),
  };
  const traveling = await runFarmBrief({
    gateway: gatewayWithBees(sources, raw({
      ...HOME_BEES,
      waiting: undefined,
      trips_left_today: 0,
      out: true,
      back_at: 1789201366,
      back_in: "3 小时 59 分",
      hint: "蜂群还在外面，3 小时 59 分后回来。",
    })),
    cabbageFormula: "chickenCount * 2 - cabbageInInventory",
  });
  assert.equal(traveling.structuredContent.bees?.tripState, "away");
  assert.equal(traveling.structuredContent.bees?.backAt, "2026-09-12T08:22:46.000Z");
  assert.equal(traveling.structuredContent.bees?.backInText, "3 小时 59 分");
  assert.deepEqual(traveling.structuredContent.bees?.waitingYoung, []);

  const ready = await runFarmBrief({
    gateway: gatewayWithBees(sources, raw({
      ...HOME_BEES,
      waiting: undefined,
      trips_left_today: 0,
      out: true,
      back_in: "一会儿",
      hint: "蜂群回来了，在门口嗡嗡地等着：bee(\"settle\")",
    })),
    cabbageFormula: "chickenCount * 2 - cabbageInInventory",
  });
  assert.equal(ready.structuredContent.bees?.tripState, "ready_to_settle");
  assert.equal(ready.structuredContent.bees?.backAt, null);
  assert.equal(ready.structuredContent.bees?.backInText, null);
});

test("farm_brief omits bees on a failed source or unknown trip state while preserving other sources", async () => {
  const sources = {
    "farm status": raw({ plots: [], inventory: {}, water_cooldown_seconds: 0 }),
    "coop status": raw({ chickens: [] }),
  };
  for (const beeResult of [
    new Error("private upstream detail"),
    raw({ ...HOME_BEES, out: true, back_in: "一会儿", hint: "未知状态" }),
  ]) {
    const result = await runFarmBrief({
      gateway: gatewayWithBees(sources, beeResult),
      cabbageFormula: "chickenCount * 2 - cabbageInInventory",
    });
    assert.equal(result.isError, true);
    assert.ok(result.structuredContent.errors?.bee);
    assert.equal("bees" in result.structuredContent, false);
    assert.deepEqual(result.structuredContent.plots, []);
    assert.equal(result.structuredContent.chickenCount, 0);
  }
});

test("farm_brief includes pets, empty jar IDs, scent stages, festival, park tickets and all five bait stocks without actions", async () => {
  const gateway = gatewayWithBees({
    "farm status": raw({ plots: [], inventory: {}, water_cooldown_seconds: 0 }),
    "coop status": raw({ chickens: [] }),
    "pet status": raw({ pets: [{ id: "pet_sample", name: "伙伴", named: true, species: "bird", kind: "毛羽", looks: "圆圆", stage: "young", tended_today: true, doing: "打盹" }], slots_free: 1,
      hint: "今天都陪过了。明天再来", at_the_door: { looks: "门口新访客", keep_with: "鸡蛋" } }),
    "kitchen status": raw({ jars_free: 1, jars: [
      { jar: 1, brewing: "样例酿", ingredients: ["胡萝卜"], sealed_days_ago: 2, smell: "有酒香了——可以开了" },
      { jar: 3, brewing: "另一坛", ingredients: ["白菜"], sealed_days_ago: 4, smell: "未见过的味道" },
    ], brews: [{ item: "brew_cooking_sample", name: "料酒", sell_value: 42, quantity: 2 }] }),
    "festival status": raw({ festival: { key: "sample", name: "样例节日", ends: "2026-10-20" } }),
    "park status": raw({ plays_left_today: 0, tickets: 17 }),
    "fish status": raw({ casts_remaining: 4, bait: [{ key: "bread", quantity: 3 }, { key: "fullmoon", quantity: 1 }] }),
  });
  const payload = (await runFarmBrief({ gateway, cabbageFormula: "chickenCount * 2 - cabbageInInventory" })).structuredContent;
  assert.equal(payload.errors, undefined);
  assert.equal(payload.pets?.residents[0]?.needsTend, false);
  assert.deepEqual(payload.pets?.doorstep, { state: "visitor", statusText: "门口新访客" });
  assert.equal(payload.kitchen?.jarsFree, 1);
  assert.deepEqual(payload.kitchen?.jars[1], { jarId: 2, stage: "empty" });
  assert.equal(payload.kitchen?.jars[0]?.stage, "mellow");
  assert.equal(payload.kitchen?.jars[2]?.stage, "unknown");
  assert.equal(payload.kitchen?.brews[0]?.sellValue, 42);
  assert.deepEqual(payload.festival, { active: { key: "sample", name: "样例节日", ends: "2026-10-20" } });
  assert.deepEqual(payload.park, { playsLeftToday: 0, tickets: 17 });
  assert.equal(payload.fish?.remainingCastCount, 4);
  assert.equal(payload.fish?.moonBalance, 100);
  assert.deepEqual(payload.fish?.baits.map((row) => [row.key, row.itemId, row.quantity]), [
    ["bread", "bait_bread", 3], ["moonworm", "bait_moonworm", 0], ["stardust", "bait_stardust", 0], ["moonhalo", "bait_moonhalo", 0], ["fullmoon", "bait_fullmoon", 1],
  ]);
  assert.equal(gateway.calls.some((call) => call.name === "inventory" || /buy|cast|send|settle|play/u.test(String(call.arguments.command))), false);
});

test("new brief source failures omit whole blocks without discarding successful park/farm data", async () => {
  const gateway = gatewayWithBees({
    "farm status": raw({ plots: [], inventory: {}, water_cooldown_seconds: 0 }),
    "coop status": raw({ chickens: [] }),
    "pet status": new Error("offline"),
    "kitchen status": raw({ jars_free: 3, jars: [{ jar: 1 }], brews: [] }),
    "festival status": raw({}),
    "fish shop": new Error("offline"),
  });
  const result = await runFarmBrief({ gateway, cabbageFormula: "chickenCount * 2 - cabbageInInventory" });
  for (const [source, field] of [["pet", "pets"], ["kitchen", "kitchen"], ["festival", "festival"], ["fish", "fish"]]) {
    assert.ok(result.structuredContent.errors?.[source!]);
    assert.equal(field! in result.structuredContent, false);
  }
  assert.deepEqual(result.structuredContent.park, { playsLeftToday: 5, tickets: 0 });
  assert.deepEqual(result.structuredContent.plots, []);
});
