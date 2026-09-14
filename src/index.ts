#!/usr/bin/env node

import { resolve } from "node:path";
import { serveStdio } from "@modelcontextprotocol/server/stdio";

import { ConfigurationError, loadConfig } from "./config.js";
import { MoonlightGardenGateway } from "./gateway.js";
import { createServer } from "./server.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    process.stdout.write("Usage: moonlight-garden-handytools [--config /absolute/path/config.json]\n");
    return;
  }
  const configIndex = args.indexOf("--config");
  if ((configIndex >= 0 && !args[configIndex + 1]) || args.some((arg, index) => arg.startsWith("-") && !(arg === "--config" || index === configIndex + 1))) {
    throw new SafeStartupError("Usage: moonlight-garden-handytools [--config /absolute/path/config.json]");
  }

  const configPath = configIndex >= 0 ? resolve(args[configIndex + 1] as string) : undefined;
  const endpoint = safeEndpoint(process.env.MOONLIGHT_GARDEN_MCP_URL);
  const config = await loadConfig(configPath);
  const gateway = new MoonlightGardenGateway(endpoint, process.env.MOONLIGHT_GARDEN_MCP_TOKEN);
  const handle = serveStdio(() => createServer(config, gateway), {
    onerror: () => process.stderr.write("moonlight-garden-handytools MCP transport error.\n"),
  });

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      void Promise.allSettled([handle.close(), gateway.close()]).finally(() => process.exit(0));
    });
  }
}

function safeEndpoint(value: string | undefined): URL {
  if (!value) throw new SafeStartupError("MOONLIGHT_GARDEN_MCP_URL is required.");
  let endpoint: URL;
  try { endpoint = new URL(value); }
  catch { throw new SafeStartupError("MOONLIGHT_GARDEN_MCP_URL must be a valid absolute URL."); }
  if (endpoint.protocol !== "https:" && !(endpoint.protocol === "http:" && ["localhost", "127.0.0.1"].includes(endpoint.hostname))) {
    throw new SafeStartupError("MOONLIGHT_GARDEN_MCP_URL must use HTTPS (localhost is allowed for development).");
  }
  return endpoint;
}

class SafeStartupError extends Error {}

void main().catch((error: unknown) => {
  const message = error instanceof SafeStartupError || error instanceof ConfigurationError
    ? error.message
    : "moonlight-garden-handytools failed to start. Check the config path and MCP connection settings.";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
