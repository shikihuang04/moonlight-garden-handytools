import path from "node:path";
import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import type { HandyToolsConfig } from "./config.js";
import { runDailyRoutine } from "./tools/daily-routine.js";
import { runFarmBrief } from "./tools/farm-brief.js";
import { runRecipeCheck } from "./tools/recipe-check.js";
import { runFishingTrip } from "./tools/fishing-trip.js";
import { BAIT_KEYS } from "./tools/fish-state.js";
import type { GardenGateway, ToolName } from "./types.js";

export function enabledToolNames(config: Pick<HandyToolsConfig, "enabledTools">): ToolName[] {
  return [...config.enabledTools];
}

export function createServer(config: HandyToolsConfig, gateway: GardenGateway): McpServer {
  const server = new McpServer({ name: "moonlight-garden-handytools", version: "0.2.0" }, { capabilities: { tools: {} } });
  const directory = config.storageDirectory;
  const ledgerFile = path.join(directory, config.recipeLedger.fileName);
  const stateFile = path.join(directory, "daily-routine-state.json");

  if (config.enabledTools.includes("daily_routine")) {
    server.registerTool("daily_routine", {
      title: "Moonlight Garden Daily Routine",
      description: "On invocation only, run three garden jobs and optionally fetch the latest 50 recipes, select the five highest sell_value recipes and update the local ledger. No bait purchase or fishing. The recipe fetch and ledger update share one configuration switch. UTC 00:00 daily idempotency preserves completed raw results; work_limit counts as already completed and continues to recipes. Any failure stops remaining steps and retains successes. Unknown action outcomes stop safely. The Agent must not choose a recovery option without the user's explicit decision.",
      inputSchema: z.object({
        resolveUnknown: z.enum(["assume_completed", "retry"]).optional().describe("Only use when a prior result reports needs_resolution. Ask the user for an explicit choice after explaining that assume_completed may skip an action that did not finish, while retry may duplicate an action that did finish."),
      }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    }, async ({ resolveUnknown }) => runDailyRoutine({ gateway, stateFile, ledgerFile, recipeLedgerEnabled: config.recipeLedger.enabledInDailyRoutine, ...(resolveUnknown ? { resolveUnknown } : {}) }));
  }

  if (config.enabledTools.includes("farm_brief")) {
    server.registerTool("farm_brief", {
      title: "Moonlight Garden Farm Brief",
      description: "Read and compress farm, watering, chicken, configurable cabbage-gap, bee-hive, bee-trip, and waiting-young state; pets/doorstep, all three kitchen jars (including empty IDs), brews, current festival, park plays/tickets and fish remaining casts/wallet/five bait IDs, names, unit prices and inventory. Queries farm/coop/bee/pet/kitchen/festival/park/fish status and fish shop only; never buys bait, fishes, tends pets, opens jars, plays park games or performs garden/bee actions, and never calls inventory list. pet status implicit overnight settlement is not yet confirmed. UTC checkedAt is an aggregation basis, not a simultaneous upstream snapshot; textual countdowns are approximate. maturesIfWateredPlotIds contains only 1–1800-second plots; also check watering cooldown. Bee backAt is null if upstream lacks an absolute time; backInText retains its countdown. Unknown jar scent stays unknown. Source failures omit the affected block and report errors, retaining other blocks. No action recommendations.",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    }, async () => runFarmBrief({ gateway, cabbageFormula: config.farmBrief.cabbagePlantGapFormula }));
  }

  if (config.enabledTools.includes("recipe_check")) {
    server.registerTool("recipe_check", {
      title: "Moonlight Garden Recipe Check",
      description: "Validate ledger recipes against live inventory and today's cooking quota; rank cookableNow and missingOne by valueAdded, max five each. Cooking wine brew_cooking_* and vinegar brew_sour_* count as ingredients; ordinary drinking wine does not. Upstream ingredient IDs match literally; Chinese names require unique authoritative name/ID mappings, never guessed meat IDs. Value added subtracts one unit's inventory sell_value per ingredient, not stock quantities or seed price. Missing prices return null and missingIngredientSellValueUnavailable status. Only if the ledger has no material-complete recipe, inspect the latest 50 with usedLatest50Fallback and per-candidate sources. Unresolved recipes return counts/name summaries, not long lists. canCookAnyNow also requires quota>0. Missing/invalid ledger, inventory or quota returns source errors, not fake empty candidates. It never cooks or sells, but the upstream inventory list may auto-claim pending gifts; claimed gifts are returned with a UTC receipt time.",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    }, async () => runRecipeCheck({ gateway, ledgerFile }));
  }

  if (config.enabledTools.includes("fishing_trip")) {
    const counts = Object.fromEntries(BAIT_KEYS.map((key) => [key, z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional()
      .describe(`Casts using ${key} bait; omitted means 0. Missing bait will be automatically bought from the shop, spending moon.`)]));
    server.registerTool("fishing_trip", {
      title: "Moonlight Garden Fishing Trip",
      description: "ACTION TOOL: automatically spends moon to buy missing bait from the shop, then fishes. Five optional nonnegative integer cast counts: bread (小面包虫), moonworm (月光虫), stardust (星纹蚯蚓), moonhalo (月华饵), fullmoon (满月秘饵); omitted=0. All zero succeeds without queries, purchases or casts. Check live daily quota, bait stock, shop prices and wallet first; subtract held stock for each bait, SUM ALL missing-bait costs, and buy NOTHING/cast NOTHING if quota or the entire bill is insufficient. No separate purchase confirmation inside this tool. Complete all necessary purchases before casting, in fixed order fullmoon→moonhalo→stardust→moonworm→bread, one cast 1 <key> per rod. Return confirmed quantities/costs and EVERY purchase/cast raw result (including empty casts or automatic fish sales when inventory is full). Empty casts also consume bait/quota. remainingCastCountBefore is PRE-execution quota, not remaining afterwards. purchaseTotalsComplete:false means totals include only confirmed purchases; unknown purchases may have spent moon. Any purchase or cast failure stops ALL remaining steps, retains successes, and identifies the failed bait/castNumber. Timeout/disconnect/unconfirmable response means outcome UNKNOWN, never automatic retry; inspect fish status/log before deciding a new invocation. No daily-once restriction; each invocation rechecks quota, with a local per-profile concurrency lock. No automatic scheduling or refunds.",
      inputSchema: z.object(counts).strict(),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    }, async (args) => runFishingTrip({ gateway, lockFile: path.join(directory, "fishing-trip.lock"), args }));
  }

  return server;
}
