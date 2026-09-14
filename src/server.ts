import path from "node:path";
import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import type { HandyToolsConfig } from "./config.js";
import { runDailyRoutine } from "./tools/daily-routine.js";
import { runFarmBrief } from "./tools/farm-brief.js";
import { runRecipeCheck } from "./tools/recipe-check.js";
import type { GardenGateway, ToolName } from "./types.js";

export function enabledToolNames(config: Pick<HandyToolsConfig, "enabledTools">): ToolName[] {
  return [...config.enabledTools];
}

export function createServer(config: HandyToolsConfig, gateway: GardenGateway): McpServer {
  const server = new McpServer({ name: "moonlight-garden-handytools", version: "0.1.0" }, { capabilities: { tools: {} } });
  const directory = config.storageDirectory;
  const ledgerFile = path.join(directory, config.recipeLedger.fileName);
  const stateFile = path.join(directory, "daily-routine-state.json");

  if (config.enabledTools.includes("daily_routine")) {
    server.registerTool("daily_routine", {
      title: "Moonlight Garden Daily Routine",
      description: "Manually run three garden jobs, buy 10 bread worms, cast 10 times, and optionally fetch the latest recipe top five plus update the local ledger. Unknown action outcomes stop safely. The Agent must not choose a recovery option without the user's explicit decision.",
      inputSchema: z.object({
        resolveUnknown: z.enum(["assume_completed", "retry"]).optional().describe("Only use when a prior result reports needs_resolution. Ask the user for an explicit choice after explaining that assume_completed may skip an action that did not finish, while retry may duplicate an action that did finish."),
      }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    }, async ({ resolveUnknown }) => runDailyRoutine({ gateway, stateFile, ledgerFile, recipeLedgerEnabled: config.recipeLedger.enabledInDailyRoutine, ...(resolveUnknown ? { resolveUnknown } : {}) }));
  }

  if (config.enabledTools.includes("farm_brief")) {
    server.registerTool("farm_brief", {
      title: "Moonlight Garden Farm Brief",
      description: "Read and compress farm, watering, chicken, cabbage-gap, bee-hive, bee-trip, and waiting-young state. It performs no garden or bee actions and returns UTC timestamps.",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    }, async () => runFarmBrief({ gateway, cabbageFormula: config.farmBrief.cabbagePlantGapFormula }));
  }

  if (config.enabledTools.includes("recipe_check")) {
    server.registerTool("recipe_check", {
      title: "Moonlight Garden Recipe Check",
      description: "Validate and rank cookable ledger recipes using live inventory and quota. It never cooks or sells, but the upstream inventory list may auto-claim pending gifts; claimed gifts are returned with a UTC receipt time.",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    }, async () => runRecipeCheck({ gateway, ledgerFile }));
  }

  return server;
}
