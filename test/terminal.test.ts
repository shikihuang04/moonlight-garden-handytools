import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const project = process.cwd();
const script = path.join(project, "scripts/call-tool.mjs");

function run(args: string[], env: NodeJS.ProcessEnv, cwd: string, nodeArgs: string[] = []) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, [...nodeArgs, script, ...args], { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => { child.kill("SIGTERM"); reject(new Error("Terminal test timed out")); }, 20_000);
    child.stdout.on("data", (data) => { stdout += String(data); });
    child.stderr.on("data", (data) => { stderr += String(data); });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}

test("terminal caller uses the real stdio server with a local fake Garden, never real credentials", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "handytools-terminal-"));
  const calls: Array<{ name: string; arguments: Record<string, unknown> }> = [];
  let requests = 0;
  let failBee = false;
  const garden = createServer(async (req, res) => {
    if (req.method !== "POST") { res.writeHead(405).end(); return; }
    let body = "";
    for await (const chunk of req) body += String(chunk);
    const message = JSON.parse(body);
    requests++;
    if (message.id === undefined) { res.writeHead(202).end(); return; }
    let result: unknown;
    if (message.method === "initialize") {
      result = { protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "fake-garden", version: "1" } };
    } else if (message.method === "tools/list") {
      result = { tools: ["farm", "coop", "bee", "pet", "kitchen", "festival", "park", "fish"].map((name) => ({ name, inputSchema: { type: "object" } })) };
    } else if (message.method === "tools/call") {
      calls.push(message.params);
      const data: Record<string, unknown> = {
        farm: { plots: [{ plot: 1, state: "mature", crop: "cabbage" }], inventory: { crop_cabbage: 2 }, water_cooldown_seconds: 0 },
        coop: { chickens: [{ index: 1, state: "hungry" }] },
        bee: { hive: [], count: "0/4", slots: 4, codex: "0/224", trips_left_today: 1, waiting: [] },
        pet: { pets: [], slots_free: 2 },
        kitchen: { jars: [], jars_free: 3, brews: [] },
        festival: { festival: null },
        park: { plays_left_today: 5, tickets: 0 },
        fish: message.params.arguments.command === "shop"
          ? { moon_balance: 100, bait: ["bread", "moonworm", "stardust", "moonhalo", "fullmoon"].map((key) => ({ item: `bait_${key}`, name: key, price: 5 })) }
          : { casts_remaining: 10, bait: [] },
      };
      result = { content: [{ type: "text", text: JSON.stringify(data[message.params.name]) }], ...(failBee && message.params.name === "bee" ? { isError: true } : {}) };
    } else {
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Unexpected test request" } }));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
  });
  await new Promise<void>((resolve) => garden.listen(0, "127.0.0.1", resolve));
  const address = garden.address();
  assert.ok(address && typeof address !== "string");
  const env = { ...process.env, MOONLIGHT_GARDEN_MCP_URL: `http://127.0.0.1:${address.port}/mcp`, MOONLIGHT_GARDEN_MCP_TOKEN: "FAKE_TERMINAL_TOKEN", XDG_DATA_HOME: directory };
  const config = path.join(directory, "config.json");
  await writeFile(config, JSON.stringify({ profileId: "terminal-test", enabledTools: ["farm_brief", "recipe_check"], recipeLedger: { directory } }));
  try {
    await t.test("list respects config and works outside the project without upstream calls", async () => {
      const result = await run(["list", "--config", "config.json"], env, directory);
      assert.equal(result.code, 0, result.stderr);
      assert.deepEqual(JSON.parse(result.stdout).tools.map((tool: { name: string }) => tool.name).sort(), ["farm_brief", "recipe_check"]);
      assert.equal(requests, 0);
    });
    await t.test("documented env-file startup supplies the child credentials", async () => {
      const envFile = path.join(directory, ".env");
      await writeFile(envFile, `MOONLIGHT_GARDEN_MCP_URL="${env.MOONLIGHT_GARDEN_MCP_URL}"\nMOONLIGHT_GARDEN_MCP_TOKEN="${env.MOONLIGHT_GARDEN_MCP_TOKEN}"\n`, { mode: 0o600 });
      const noCredentials: NodeJS.ProcessEnv = { ...env };
      delete noCredentials.MOONLIGHT_GARDEN_MCP_URL;
      delete noCredentials.MOONLIGHT_GARDEN_MCP_TOKEN;
      const result = await run(["list", "--config", "config.json"], noCredentials, directory, ["--env-file=.env"]);
      assert.equal(result.code, 0, result.stderr);
      assert.equal(requests, 0);
      assert.equal(result.stdout.includes(env.MOONLIGHT_GARDEN_MCP_TOKEN), false);
    });
    await t.test("farm_brief preserves real tool output and reads each of the nine sources once", async () => {
      const result = await run(["farm_brief", "--config", config], env, directory);
      assert.equal(result.code, 0, result.stderr);
      const output = JSON.parse(result.stdout);
      assert.equal(output.structuredContent.waterCooldownSeconds, 0);
      assert.equal(output.structuredContent.chickens[0].status, "hungry");
      assert.equal(output.structuredContent.plots[0].maturesInSeconds, 0);
      assert.deepEqual(JSON.parse(output.content[0].text), output.structuredContent);
      assert.deepEqual(calls.map((call) => `${call.name} ${call.arguments.command}`).sort(), ["bee status", "coop status", "farm status", "festival status", "fish shop", "fish status", "kitchen status", "park status", "pet status"]);
    });
    await t.test("partial failure retains successful sources and exits nonzero without retry", async () => {
      calls.length = 0;
      failBee = true;
      const result = await run(["farm_brief", "--config", config], env, directory);
      assert.equal(result.code, 1);
      const output = JSON.parse(result.stdout);
      assert.equal(output.isError, true);
      assert.ok(output.structuredContent.errors.bee);
      assert.equal(output.structuredContent.waterCooldownSeconds, 0);
      assert.equal(calls.length, 9);
    });
    await t.test("disabled daily_routine never reaches Garden", async () => {
      calls.length = 0;
      const result = await run(["daily_routine", "--config", config], env, directory);
      assert.equal(result.code, 1);
      assert.match(result.stderr, /not enabled/);
      assert.equal(calls.length, 0);
    });
    await t.test("recipe_check ledger error is returned unchanged without upstream calls", async () => {
      const result = await run(["recipe_check", "--config", config], env, directory);
      assert.equal(result.code, 1);
      assert.ok(JSON.parse(result.stdout).structuredContent.errors.ledger);
      assert.equal(calls.length, 0);
    });
    await t.test("terminal fishing_trip accepts arguments and zero casts without contacting Garden", async () => {
      const fishConfig = path.join(directory, "fish.json");
      await writeFile(fishConfig, JSON.stringify({ enabledTools: ["fishing_trip"], recipeLedger: { directory } }));
      const result = await run(["fishing_trip", "--config", fishConfig, "--args", '{"fullmoon":0,"bread":0}'], env, directory);
      assert.equal(result.code, 0, result.stderr);
      assert.equal(JSON.parse(result.stdout).structuredContent.status, "noop");
      assert.equal(calls.length, 0);
    });
    await t.test("explicit recovery arguments reach daily_routine without silently running a fresh routine", async () => {
      const dailyConfig = path.join(directory, "daily.json");
      await writeFile(dailyConfig, JSON.stringify({ enabledTools: ["daily_routine"], recipeLedger: { directory } }));
      const result = await run(["daily_routine", "--config", dailyConfig, "--args", '{"resolveUnknown":"assume_completed"}'], env, directory);
      assert.equal(result.code, 1);
      const output = JSON.parse(result.stdout);
      assert.match(output.structuredContent.error, /no step has an unknown outcome/);
      assert.equal(calls.length, 0);
    });
    await t.test("invalid arguments and missing credentials fail without secret leakage", async () => {
      for (const args of [["farm_brief", "--args", "[]"], ["not-a-tool"], ["list", "--args", "{}"]]) {
        const result = await run(args, env, directory);
        assert.equal(result.code, 1);
        assert.equal(result.stdout, "");
      }
      const noUrl = { ...env };
      delete (noUrl as NodeJS.ProcessEnv).MOONLIGHT_GARDEN_MCP_URL;
      const result = await run(["list"], noUrl, directory);
      assert.equal(result.code, 1);
      assert.match(result.stderr, /MOONLIGHT_GARDEN_MCP_URL is required/);
      assert.equal(result.stderr.includes(env.MOONLIGHT_GARDEN_MCP_TOKEN), false);
      assert.equal(calls.length, 0);
    });
  } finally {
    garden.closeAllConnections();
    await new Promise<void>((resolve, reject) => garden.close((error) => error ? reject(error) : resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
