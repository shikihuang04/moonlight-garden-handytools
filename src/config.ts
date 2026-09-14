import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as z from "zod/v4";

import type { ToolName } from "./types.js";

const ToolNameSchema = z.enum(["daily_routine", "farm_brief", "recipe_check"]);
const ConfigInputSchema = z.object({
  profileId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u).refine((value) => value !== "." && value !== "..").optional(),
  enabledTools: z.array(ToolNameSchema).min(1).optional(),
  recipeLedger: z.object({
    enabledInDailyRoutine: z.boolean().optional(),
    directory: z.string().min(1).nullable().optional(),
    fileName: z.string().min(1).max(180).optional(),
  }).strict().optional(),
  farmBrief: z.object({
    cabbagePlantGapFormula: z.string().min(1).max(200).optional(),
  }).strict().optional(),
}).strict();

export interface HandyToolsConfig {
  profileId: string;
  storageDirectory: string;
  enabledTools: ToolName[];
  recipeLedger: { enabledInDailyRoutine: boolean; directory: string; fileName: string };
  farmBrief: { cabbagePlantGapFormula: string };
}

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(`Invalid configuration: ${message}`);
    this.name = "ConfigurationError";
  }
}

export async function loadConfig(configPath?: string): Promise<HandyToolsConfig> {
  let input: z.infer<typeof ConfigInputSchema> = {};
  if (configPath) {
    try {
      input = ConfigInputSchema.parse(JSON.parse(await readFile(configPath, "utf8")));
    } catch (error) {
      throw new ConfigurationError(safeIssue(error));
    }
  }
  const fileName = input.recipeLedger?.fileName ?? "moonlight-garden-expensive-recipes.md";
  if (fileName !== path.basename(fileName) || fileName === "." || fileName === "..") {
    throw new ConfigurationError("recipeLedger.fileName must be a plain file name.");
  }
  if (input.recipeLedger?.directory && !path.isAbsolute(input.recipeLedger.directory)) {
    throw new ConfigurationError("recipeLedger.directory must be an absolute path or null.");
  }
  const profileId = input.profileId ?? "default";
  const directory = input.recipeLedger?.directory ?? resolveDataDirectory(process.platform, os.homedir(), process.env);
  return {
    profileId,
    storageDirectory: path.join(directory, "profiles", profileId),
    enabledTools: [...new Set<ToolName>(input.enabledTools ?? ["daily_routine", "farm_brief", "recipe_check"])],
    recipeLedger: {
      enabledInDailyRoutine: input.recipeLedger?.enabledInDailyRoutine ?? true,
      directory,
      fileName,
    },
    farmBrief: {
      cabbagePlantGapFormula: input.farmBrief?.cabbagePlantGapFormula ?? "chickenCount * 2 - cabbageInInventory",
    },
  };
}

export function resolveDataDirectory(platform: NodeJS.Platform, home: string, env: NodeJS.ProcessEnv): string {
  if (platform === "darwin") return path.join(home, "Library", "Application Support", "moonlight-garden-handytools");
  if (platform === "win32") return path.join(env.LOCALAPPDATA || path.join(home, "AppData", "Local"), "moonlight-garden-handytools");
  return path.join(env.XDG_DATA_HOME || path.join(home, ".local", "share"), "moonlight-garden-handytools");
}

function safeIssue(error: unknown): string {
  if (error instanceof z.ZodError) return error.issues.map((issue) => `${issue.path.join(".") || "config"}: ${issue.message}`).join("; ");
  if (error instanceof SyntaxError) return "the file is not valid JSON";
  if (error instanceof Error && "code" in error && error.code === "ENOENT") return "the requested config file does not exist";
  return "unable to read or validate the config file";
}
