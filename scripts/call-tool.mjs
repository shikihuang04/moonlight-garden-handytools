#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const usage = "Usage: node scripts/call-tool.mjs <list|farm_brief|recipe_check|daily_routine|fishing_trip> [--config /path/config.json] [--args '{}']";
const projectDirectory = fileURLToPath(new URL("../", import.meta.url));
class UsageError extends Error {}

let stage = "startup";

async function main() {
  let parsed;
  try {
    parsed = parseArgs({
      options: { config: { type: "string" }, args: { type: "string" }, help: { type: "boolean" } },
      allowPositionals: true,
    });
  } catch {
    throw new UsageError(usage);
  }
  if (parsed.values.help) {
    console.log(usage);
    return;
  }
  const [tool] = parsed.positionals;
  if (parsed.positionals.length !== 1 || !["list", "farm_brief", "recipe_check", "daily_routine", "fishing_trip"].includes(tool)) {
    throw new UsageError(usage);
  }
  let toolArguments;
  try {
    toolArguments = JSON.parse(parsed.values.args ?? "{}");
    if (!toolArguments || typeof toolArguments !== "object" || Array.isArray(toolArguments)) throw new Error();
    if (tool === "list" && parsed.values.args !== undefined) throw new Error();
  } catch {
    throw new UsageError("--args must be a JSON object and cannot be used with list.");
  }

  const serverArgs = [path.join(projectDirectory, "dist/index.js")];
  if (parsed.values.config) serverArgs.push("--config", path.resolve(parsed.values.config));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: serverArgs,
    cwd: projectDirectory,
    // Include credentials and platform data-directory settings; never print them.
    env: Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== undefined)),
    stderr: "inherit",
  });
  const client = new Client({ name: "handytools-terminal", version: "0.2.0" });
  try {
    await client.connect(transport);
    stage = "tool discovery";
    const listing = await client.listTools();
    if (tool === "list") {
      console.log(JSON.stringify(listing, null, 2));
      return;
    }
    if (!listing.tools.some((entry) => entry.name === tool)) {
      throw new UsageError("The requested tool is not enabled. Check enabledTools in the selected config.");
    }
    stage = "tool call";
    // One request only. Retrying a timed-out daily routine could repeat real actions.
    const result = await client.callTool({ name: tool, arguments: toolArguments }, { timeout: 300_000 });
    console.log(JSON.stringify(result, null, 2));
    if (result.isError) process.exitCode = 1;
  } finally {
    await client.close();
    await transport.close();
  }
}

void main().catch((error) => {
  console.error(error instanceof UsageError
    ? error.message
    : `Terminal MCP ${stage} failed. Check the server error above, build, config and connection settings. No automatic retry was made. If a game action was in flight, its outcome may be unknown.`);
  process.exitCode = 1;
});
