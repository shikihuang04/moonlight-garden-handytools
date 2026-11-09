// Offline game simulation only. npm may fetch dependencies; no Garden credentials are used.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync, spawn } from "node:child_process";

const project=process.cwd();
const root=await fs.mkdtemp(path.join(os.tmpdir(),"handytools-030-upgrade-"));
const old=path.join(root,"0.2.0"), next=path.join(root,"0.3.0");
const checks=[];
const check=(s)=>{checks.push(s);console.log("PASS "+s);};
const env={PATH:process.env.PATH,HOME:root,MOONLIGHT_GARDEN_MCP_URL:"http://127.0.0.1:1/mcp",MOONLIGHT_GARDEN_MCP_TOKEN:"FAKE_ONLY"};
async function install(dir) {
  execFileSync("npm",["ci","--no-audit","--no-fund"],{cwd:dir,stdio:"pipe",timeout:120000});
  execFileSync("npm",["run","build"],{cwd:dir,stdio:"pipe",timeout:60000});
}
async function cli(dir,tool,config) {
  return new Promise((resolve,reject)=>{
    const p=spawn(process.execPath,[path.join(dir,"scripts/call-tool.mjs"),tool,"--config",config],{cwd:root,env});
    let out="",err="";const timer=setTimeout(()=>{p.kill();reject(Error("CLI timeout"));},15000);
    p.stdout.on("data",d=>out+=d);p.stderr.on("data",d=>err+=d);
    p.on("error",reject);p.on("close",code=>{clearTimeout(timer);code===0?resolve(JSON.parse(out)):reject(Error(err||out));});
  });
}
const mod=(dir,f)=>import(pathToFileURL(path.join(dir,"dist",f)).href);
const raw=d=>({content:[{type:"text",text:JSON.stringify(d)}]});
try {
  await fs.mkdir(old);await fs.mkdir(next);
  execFileSync("tar",["-x","-C",old],{input:execFileSync("git",["archive","v0.2.0"],{cwd:project})});
  const program=["src","scripts","test","package.json","package-lock.json","tsconfig.json","README.md","LICENSE","config.example.json","recipe-ledger.example.md","CHANGELOG.md","RELEASE_NOTES_0.3.0.md"];
  for(const f of program) await fs.cp(path.join(project,f),path.join(next,f),{recursive:true});
  await install(old);await install(next);
  check("Independent old tag and new candidate installs/builds");
  const data=path.join(root,"user-data"), profile="original-account";
  const config=path.join(old,"custom-config.json");
  const settings={profileId:profile,enabledTools:["daily_routine","farm_brief","recipe_check"],recipeLedger:{directory:data,fileName:"custom-recipes.md",enabledInDailyRoutine:true},farmBrief:{cabbagePlantGapFormula:"chickenCount * 3 - cabbageInInventory"}};
  await fs.writeFile(config,JSON.stringify(settings));
  await fs.writeFile(path.join(old,".env"),"FAKE_UPGRADE_SETTING=kept\n");
  await fs.writeFile(path.join(old,"run.sh"),"#!/bin/sh\n# fixture only\n");
  const storage=path.join(data,"profiles",profile),ledger=path.join(storage,"custom-recipes.md"),state=path.join(storage,"daily-routine-state.json");
  await fs.mkdir(storage,{recursive:true});
  await fs.mkdir(path.join(data,"profiles","other"),{recursive:true});
  const sentinel=path.join(data,"profiles","other","sentinel");await fs.writeFile(sentinel,"untouched");
  const oldRoutine=await mod(old,"tools/daily-routine.js");
  let calls=0;
  const fake={callTool:async(name)=>{calls++;return name==="garden_work"?raw({earned:10}):raw({recipes:[{item:"dish_sample",name:"样例菜",ingredients:["白菜","鸡蛋"],sell_value:100}]});}};
  const args={gateway:fake,stateFile:state,ledgerFile:ledger,recipeLedgerEnabled:true};
  assert.equal((await oldRoutine.runDailyRoutine(args)).structuredContent.status,"completed");
  assert.equal(calls,4);
  const before=new Map(await Promise.all([config,ledger,state,sentinel,path.join(old,".env"),path.join(old,"run.sh")].map(async f=>[f,await fs.readFile(f,"utf8")])));
  check("Real 0.2.0 module created nonempty ledger and completed daily raw records with a fake gateway");
  const loaded=await (await mod(next,"config.js")).loadConfig(config);
  assert.equal(loaded.farmBrief.cabbageHintEnabled,true);
  assert.equal(loaded.farmBrief.cabbagePlantGapFormula,settings.farmBrief.cabbagePlantGapFormula);
  assert.equal(loaded.storageDirectory,storage);assert.equal(loaded.recipeLedger.fileName,"custom-recipes.md");
  assert.deepEqual(loaded.enabledTools,settings.enabledTools);
  const listed=await cli(next,"list",config);assert.deepEqual(listed.tools.map(t=>t.name).sort(),[...settings.enabledTools].sort());
  const done=await cli(next,"daily_routine",config);assert.equal(done.structuredContent.status,"completed");
  // Port 1 is deliberately unavailable: success proves completed steps never needed upstream.
  for(const [f,bytes]of before)assert.equal(await fs.readFile(f,"utf8"),bytes);
  check("New real stdio process reused original config/state with zero upstream actions and byte-identical data");
  const newRoutine=await mod(next,"tools/daily-routine.js");
  const saved=JSON.parse(before.get(state));
  saved.steps[0].status="outcome_unknown";saved.steps[1].status="not_run";
  await fs.writeFile(state,JSON.stringify(saved));
  const unknownBytes=await fs.readFile(state,"utf8");
  const noCalls={callTool:async()=>{throw Error("Unexpected upstream call");}};
  assert.equal((await newRoutine.runDailyRoutine({...args,gateway:noCalls})).structuredContent.status,"needs_resolution");
  assert.equal(await fs.readFile(state,"utf8"),unknownBytes);
  await fs.writeFile(state,before.get(state));
  check("Unknown old action still requires resolution and is never replayed");
  const offConfig=path.join(root,"off.json");
  await fs.writeFile(offConfig,JSON.stringify({...settings,recipeLedger:{...settings.recipeLedger,enabledInDailyRoutine:false},farmBrief:{...settings.farmBrief,cabbageHintEnabled:false}}));
  const off=await (await mod(next,"config.js")).loadConfig(offConfig);
  assert.equal(off.farmBrief.cabbageHintEnabled,false);assert.equal(off.recipeLedger.enabledInDailyRoutine,false);
  assert.equal(await fs.readFile(config,"utf8"),before.get(config));
  check("Optional new switch and old recipe total switch coexist without rewriting original config");
  const overwritten=path.join(root,"overwrite");
  await fs.cp(old,overwritten,{recursive:true});
  for(const f of program)await fs.cp(path.join(next,f),path.join(overwritten,f),{recursive:true,force:true});
  await install(overwritten);
  assert.equal(await fs.readFile(path.join(overwritten,"custom-config.json"),"utf8"),before.get(config));
  assert.equal(await fs.readFile(path.join(overwritten,".env"),"utf8"),before.get(path.join(old,".env")));
  assert.equal(await fs.readFile(path.join(overwritten,"run.sh"),"utf8"),before.get(path.join(old,"run.sh")));
  assert.equal((await cli(overwritten,"daily_routine",path.join(overwritten,"custom-config.json"))).structuredContent.status,"completed");
  for(const [f,bytes]of before)assert.equal(await fs.readFile(f,"utf8"),bytes);
  check("Program-file overwrite upgrade preserves custom config, credentials fixture, launcher, ledger and daily state");
  const report={passed:true,checks,platform:process.platform,node:process.version,realGardenCalls:0,root};
  await fs.writeFile(path.join(root,"report.json"),JSON.stringify(report,null,2));
  console.log("REPORT "+path.join(root,"report.json"));
} catch(error) {console.error("FAILED "+root);throw error;}
