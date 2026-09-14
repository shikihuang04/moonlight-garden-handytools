import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { loadConfig, resolveDataDirectory } from "../src/config.js";

test("loads defaults and lets users independently select tools", async () => {
  const defaults = await loadConfig();
  assert.deepEqual(defaults.enabledTools, ["daily_routine", "farm_brief", "recipe_check"]);
  assert.equal(defaults.recipeLedger.enabledInDailyRoutine, true);
  assert.equal(defaults.profileId, "default");

  const directory = await mkdtemp(path.join(os.tmpdir(), "handytools-config-"));
  const configPath = path.join(directory, "config.json");
  await writeFile(configPath, JSON.stringify({ enabledTools: ["farm_brief"] }), "utf8");
  const selected = await loadConfig(configPath);
  assert.deepEqual(selected.enabledTools, ["farm_brief"]);
});

test("rejects unknown tools and unsafe ledger file names", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "handytools-config-"));
  for (const value of [
    { enabledTools: ["unknown"] },
    { recipeLedger: { fileName: "../private.md" } },
    { profileId: "../other-account" },
    { recipeLedger: { directory: "relative/data" } },
  ]) {
    const configPath = path.join(directory, `${Math.random()}.json`);
    await writeFile(configPath, JSON.stringify(value), "utf8");
    await assert.rejects(loadConfig(configPath), /Invalid configuration/u);
  }
});

test("uses profileId as a local storage namespace", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "handytools-config-"));
  const configPath = path.join(directory, "config.json");
  await writeFile(configPath, JSON.stringify({
    profileId: "second-account",
    recipeLedger: { directory },
  }), "utf8");
  const config = await loadConfig(configPath);
  assert.equal(config.profileId, "second-account");
  assert.equal(config.storageDirectory, path.join(directory, "profiles", "second-account"));
});

test("uses cross-platform application data directories", () => {
  assert.equal(resolveDataDirectory("darwin", "/Users/test", {}), "/Users/test/Library/Application Support/moonlight-garden-handytools");
  assert.equal(resolveDataDirectory("win32", "C:\\Users\\test", { LOCALAPPDATA: "D:\\Local" }), "D:\\Local/moonlight-garden-handytools");
  assert.equal(resolveDataDirectory("linux", "/home/test", { XDG_DATA_HOME: "/data" }), "/data/moonlight-garden-handytools");
});
