import test from "node:test";
import assert from "node:assert/strict";
import { runFarmBrief } from "../src/tools/farm-brief.js";
import { FakeGateway, raw } from "./helpers.js";

const cow = { index: 1, name: null, label: "样例牛", state: "making", status: "正在反刍，还要 2 小时 57 分" };
function gateway(farm: object = {}, coop: object = {}, kitchen: object = {}) {
  return new FakeGateway({
    "farm status": raw({ sky: { weather: "rain" }, plots: [], inventory: {}, water_cooldown_seconds: 0, ...farm }),
    "coop status": raw({ chickens: [], cows: [cow], ...coop }),
    "bee status": raw({ hive: [], count: "0/4", slots: 4, codex: "0/224", trips_left_today: 1 }),
    "pet status": raw({ pets: [], slots_free: 2 }), "festival status": raw({ festival: null }),
    "park status": raw({ plays_left_today: 5, tickets: 0 }),
    "fish status": raw({ casts_remaining: 10, bait: [] }),
    "fish shop": raw({ moon_balance: 100, bait: ["bread","moonworm","stardust","moonhalo","fullmoon"].map(key => ({item:"bait_"+key,name:key,price:5})) }),
    "kitchen status": raw({ jars: [], jars_free: 6, brews: [], ...kitchen }),
  });
}
const run = (g: FakeGateway, enabled = true) => runFarmBrief({ gateway:g, cabbageFormula:"chickenCount * 3 - cabbageInInventory", cabbageHintEnabled:enabled });

test("rain prediction uses current weather and boundaries; missing weather preserves plots", async () => {
  const plots = [1,1800,1801,2943,3600,3601].map((n,i)=>({plot:i+3,state:"growing",crop:"phantom_shroom",matures_in_seconds:n}));
  for (const [weather, expected] of [["rain",[3,4,5,6,7]],["clear",[3,4]],["fog",[3,4]]] as const) {
    const r=await run(gateway({plots,sky:{weather,tomorrow:{weather:"rain"}},water_cooldown_seconds:200}));
    assert.equal(r.isError,undefined); assert.deepEqual(r.structuredContent.maturesIfWateredPlotIds,expected);
    assert.equal(r.structuredContent.waterCooldownSeconds,200);
  }
  const r=await run(gateway({plots,sky:null}));
  assert.ok(r.structuredContent.errors?.waterPrediction);
  assert.equal(r.structuredContent.maturesIfWateredPlotIds,undefined);
  assert.equal(r.structuredContent.plots?.length,6);
});

test("cows preserve unknown states and IDs independently of chickens; missing differs from empty", async () => {
  for (const state of ["making","ready","hungry","future"]) {
    const r=await run(gateway({}, { cows:[{...cow,state}], count:"5/5" }));
    assert.deepEqual(r.structuredContent.cows,{count:1,animals:[{cowId:1,name:null,label:cow.label,rawState:state,statusText:cow.status}]});
  }
  for (const cows of [undefined,null,[cow,cow]]) {
    const r=await run(gateway({}, { cows }));
    assert.ok(r.structuredContent.errors?.cows); assert.equal(r.structuredContent.cows,undefined); assert.deepEqual(r.structuredContent.chickens,[]);
  }
  assert.deepEqual((await run(gateway({}, {cows:[]}))).structuredContent.cows,{count:0,animals:[]});
  assert.equal((await run(gateway({}, {chickens:null}))).structuredContent.cows?.count,1);
});

test("disabled cabbage omits inventory, gap and formula errors while retaining animals", async () => {
  const g=gateway({inventory:null});
  const r=await runFarmBrief({gateway:g,cabbageHintEnabled:false,cabbageFormula:"invalid"});
  assert.equal(r.isError,undefined); assert.equal(r.structuredContent.cabbageInInventory,undefined);
  assert.equal(r.structuredContent.cabbagePlantGap,undefined); assert.equal(r.structuredContent.chickenCount,0);
  assert.equal(r.structuredContent.cows?.count,1); assert.equal(g.calls.length,9);
});

test("expanded jars and verified scents do not invent products or prices", async () => {
  for(const [smell,stage] of [["已经是醋味了，开吧，醋也能下锅","sour"],["结成块了，一股新鲜的奶味——现在开是鲜的，也可以再放放","fresh_cheese"],["陌生气味","unknown"]]) {
    const r=await run(gateway({}, {}, {jars_free:5,jars:[{jar:4,brewing:"上游名称",ingredients:["上游材料"],sealed_days_ago:1,smell}]}));
    assert.equal(r.isError,undefined); assert.equal(r.structuredContent.kitchen?.jars.length,6);
    assert.deepEqual(r.structuredContent.kitchen?.jars[3],{jarId:4,brewing:"上游名称",ingredients:["上游材料"],sealedDaysAgo:1,scentText:smell,stage});
    assert.deepEqual(r.structuredContent.kitchen?.brews,[]);
  }
  assert.equal((await run(gateway())).structuredContent.kitchen?.jars.length,6);
  assert.ok((await run(gateway({}, {}, {jars_free:-1}))).structuredContent.errors?.kitchen);
});
