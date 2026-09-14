import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

function runServer(env: NodeJS.ProcessEnv, args: string[] = []): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, ["--import", "tsx", "src/index.ts", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    env,
  });
}

test("startup identifies a missing endpoint without dumping environment data", () => {
  const env = { ...process.env };
  delete env.MOONLIGHT_GARDEN_MCP_URL;
  const child = runServer(env);
  assert.notEqual(child.status, 0);
  assert.match(child.stderr, /MOONLIGHT_GARDEN_MCP_URL is required/u);
});

test("startup identifies an invalid endpoint without echoing credentials", () => {
  const sentinel = "FAKE_REVIEW_SENTINEL";
  const child = runServer({ ...process.env, MOONLIGHT_GARDEN_MCP_URL: `not-a-url?token=${sentinel}` });
  assert.notEqual(child.status, 0);
  assert.equal(child.stderr.includes(sentinel), false);
  assert.match(child.stderr, /MOONLIGHT_GARDEN_MCP_URL must be a valid absolute URL/u);
});

test("startup reports a missing config file without printing its requested path", () => {
  const sentinel = path.join(os.tmpdir(), "FAKE_PRIVATE_CONFIG_PATH.json");
  const child = runServer(
    { ...process.env, MOONLIGHT_GARDEN_MCP_URL: "http://127.0.0.1:65535/mcp" },
    ["--config", sentinel],
  );
  assert.notEqual(child.status, 0);
  assert.equal(child.stderr.includes(sentinel), false);
  assert.match(child.stderr, /Invalid configuration: the requested config file does not exist/u);
});

test("startup reports invalid config JSON without echoing file contents", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "handytools-startup-"));
  const config = path.join(directory, "config.json");
  const sentinel = "FAKE_PRIVATE_CONFIG_CONTENT";
  writeFileSync(config, `{ invalid: ${sentinel} }`, "utf8");
  try {
    const child = runServer(
      { ...process.env, MOONLIGHT_GARDEN_MCP_URL: "http://127.0.0.1:65535/mcp" },
      ["--config", config],
    );
    assert.notEqual(child.status, 0);
    assert.equal(child.stderr.includes(sentinel), false);
    assert.match(child.stderr, /Invalid configuration: the file is not valid JSON/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("startup reports invalid config fields without echoing their values", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "handytools-startup-"));
  const config = path.join(directory, "config.json");
  const sentinel = "FAKE_PRIVATE_PROFILE_VALUE!";
  writeFileSync(config, JSON.stringify({ profileId: sentinel }), "utf8");
  try {
    const child = runServer(
      { ...process.env, MOONLIGHT_GARDEN_MCP_URL: "http://127.0.0.1:65535/mcp" },
      ["--config", config],
    );
    assert.notEqual(child.status, 0);
    assert.equal(child.stderr.includes(sentinel), false);
    assert.match(child.stderr, /Invalid configuration: profileId:/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
