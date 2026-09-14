import { readRecipeLedger, recipeFromUpstream, updateRecipeLedger, type LedgerRecipe } from "../ledger.js";
import { isMissing, readJsonFile, withFileLock, writeJsonAtomic } from "../storage.js";
import { parseToolData, resultFromPayload, type GardenGateway, type HandyToolResult, type RawToolResult } from "../types.js";

type StepStatus = "completed" | "completed_by_daily_limit" | "completed_by_user" | "disabled" | "failed" | "not_run" | "outcome_unknown";
type UnknownResolution = "assume_completed" | "retry";

interface RoutineStep {
  id: string;
  status: StepStatus;
  result?: RawToolResult;
  topRecipes?: Array<Record<string, unknown>>;
  resolution?: "assumed_completed" | "retry_requested";
  error?: string;
}

interface RoutineState {
  version: 1;
  gardenDay: string;
  steps: RoutineStep[];
}

export interface DailyRoutinePayload extends Record<string, unknown> {
  gardenDay: string;
  resetAt: string;
  nextResetAt: string;
  status: "completed" | "needs_resolution" | "partial_failure";
  steps: RoutineStep[];
  failedStep?: string;
  error?: string;
  resolutionRequired?: { stepId: string; choices: UnknownResolution[]; retryMayDuplicate: true };
}

const STEP_IDS = ["garden_work_1", "garden_work_2", "garden_work_3", "buy_bread_10", "fish_cast_10", "recipes_top_5", "update_recipe_ledger"] as const;

export async function runDailyRoutine({
  gateway,
  stateFile,
  ledgerFile,
  recipeLedgerEnabled,
  resolveUnknown,
  now = () => new Date(),
}: {
  gateway: GardenGateway;
  stateFile: string;
  ledgerFile: string;
  recipeLedgerEnabled: boolean;
  resolveUnknown?: UnknownResolution;
  now?: () => Date;
}): Promise<HandyToolResult<DailyRoutinePayload>> {
  const clock = now();
  const gardenDay = clock.toISOString().slice(0, 10);
  const resetAt = `${gardenDay}T00:00:00.000Z`;
  const nextResetAt = new Date(`${gardenDay}T00:00:00.000Z`).getTime() + 86_400_000;
  let observedSteps = initialSteps(recipeLedgerEnabled);
  try {
    return await withFileLock(stateFile, async () => runLocked({
      gateway,
      stateFile,
      ledgerFile,
      recipeLedgerEnabled,
      ...(resolveUnknown ? { resolveUnknown } : {}),
      gardenDay,
      resetAt,
      nextResetAt: new Date(nextResetAt).toISOString(),
      onState: (steps) => { observedSteps = steps; },
    }));
  } catch (error) {
    return resultFromPayload({
      gardenDay,
      resetAt,
      nextResetAt: new Date(nextResetAt).toISOString(),
      status: "partial_failure",
      steps: observedSteps,
      failedStep: "idempotency_state",
      error: publicError(error, "Unable to lock or persist daily routine state."),
    }, true);
  }
}

async function runLocked({ gateway, stateFile, ledgerFile, recipeLedgerEnabled, resolveUnknown, gardenDay, resetAt, nextResetAt, onState }: {
  gateway: GardenGateway;
  stateFile: string;
  ledgerFile: string;
  recipeLedgerEnabled: boolean;
  resolveUnknown?: UnknownResolution;
  gardenDay: string;
  resetAt: string;
  nextResetAt: string;
  onState: (steps: RoutineStep[]) => void;
}): Promise<HandyToolResult<DailyRoutinePayload>> {
  let state = await loadState(stateFile, gardenDay, recipeLedgerEnabled);
  onState(state.steps);
  const payload = (): DailyRoutinePayload => ({
    gardenDay,
    resetAt,
    nextResetAt,
    status: state.steps.some((step) => step.status === "outcome_unknown") ? "needs_resolution" : state.steps.every(done) ? "completed" : "partial_failure",
    steps: state.steps,
  });

  const persist = async (): Promise<void> => writeJsonAtomic(stateFile, state);
  const unknown = state.steps.find((step) => step.status === "outcome_unknown");
  if (unknown) {
    if (!resolveUnknown) return needsResolution(payload(), unknown.id);
    if (resolveUnknown === "assume_completed") {
      unknown.status = "completed_by_user";
      unknown.resolution = "assumed_completed";
      delete unknown.error;
    } else {
      unknown.resolution = "retry_requested";
      delete unknown.error;
    }
    await persist();
  } else if (resolveUnknown) {
    const result = payload();
    result.status = "partial_failure";
    result.failedStep = "resolve_unknown";
    result.error = "resolveUnknown was provided, but no step has an unknown outcome.";
    return resultFromPayload(result, true);
  }
  await persist();

  for (let index = 0; index < 3; index += 1) {
    const step = state.steps[index] as RoutineStep;
    if (done(step)) continue;
    const result = await callMutatingStep(gateway, "garden_work", {}, step, persist, (data) => isWorkLimit(data));
    if (step.status === "outcome_unknown") return needsResolution(payload(), step.id);
    if (step.status === "completed_by_daily_limit") {
      if (!result) throw new Error("Daily limit result was not preserved.");
      for (let remaining = index + 1; remaining < 3; remaining += 1) {
        state.steps[remaining] = { id: STEP_IDS[remaining] as string, status: "completed_by_daily_limit", result };
      }
      await persist();
      break;
    }
    if (step.status === "failed") return failed(payload(), step.id);
  }

  const buy = state.steps[3] as RoutineStep;
  if (!done(buy)) {
    await callMutatingStep(gateway, "fish", { command: "buy bread 10" }, buy, persist);
    if (buy.status === "outcome_unknown") return needsResolution(payload(), buy.id);
    if (buy.status === "failed") return failed(payload(), buy.id);
  }

  const cast = state.steps[4] as RoutineStep;
  if (!done(cast)) {
    await callMutatingStep(gateway, "fish", { command: "cast 10" }, cast, persist, (data) => data.casts_remaining === 0);
    if (cast.status === "outcome_unknown") return needsResolution(payload(), cast.id);
    if (cast.status === "failed") return failed(payload(), cast.id);
  }

  if (recipeLedgerEnabled) {
    const recipes = state.steps[5] as RoutineStep;
    if (!done(recipes)) {
      try {
        const raw = await gateway.callTool("kitchen", { command: "recipes 50" });
        const rows = parseRecipes(parseToolData(raw)).sort((left, right) => right.sellValue - left.sellValue).slice(0, 5);
        recipes.status = "completed";
        recipes.result = raw;
        recipes.topRecipes = rows.map(toUpstreamShape);
        await persist();
      } catch {
        recipes.status = "failed";
        recipes.error = "Fetching or parsing the latest 50 recipes failed.";
        await persist();
        return failed(payload(), recipes.id);
      }
    }

    const ledger = state.steps[6] as RoutineStep;
    if (!done(ledger)) {
      try {
        const rows = state.steps[5]?.topRecipes ?? [];
        const merged = await updateRecipeLedger(ledgerFile, rows.map(recipeFromUpstream));
        ledger.status = "completed";
        ledger.result = { content: [{ type: "text", text: JSON.stringify({ ledgerFile, recipeCount: merged.length }) }] };
        await persist();
      } catch {
        ledger.status = "failed";
        ledger.error = "The top five recipes were fetched, but updating the local recipe ledger failed.";
        await persist();
        return failed(payload(), ledger.id);
      }
    }
  }

  const final = payload();
  final.status = "completed";
  return resultFromPayload(final);
}

async function callMutatingStep(
  gateway: GardenGateway,
  name: string,
  args: Record<string, unknown>,
  step: RoutineStep,
  persist: () => Promise<void>,
  acceptLimit?: (data: Record<string, unknown>) => boolean,
): Promise<RawToolResult | undefined> {
  step.status = "outcome_unknown";
  step.error = "This action is in progress; if the process stops now, its outcome must be resolved explicitly.";
  await persist();
  try {
    const raw = await gateway.callTool(name, args);
    const data = raw.isError ? parseErrorData(raw) : parseToolData(raw);
    if (raw.isError) {
      if (data && acceptLimit?.(data)) {
        step.status = "completed_by_daily_limit";
        step.result = raw;
        delete step.error;
        await persist();
        return raw;
      }
      step.status = "failed";
      step.result = raw;
      step.error = "Moonlight Garden returned an error for this step.";
      await persist();
      return raw;
    }
    if (data && acceptLimit?.(data)) step.status = "completed_by_daily_limit";
    else step.status = "completed";
    step.result = raw;
    delete step.error;
    await persist();
    return raw;
  } catch {
    step.status = "outcome_unknown";
    step.error = "No authoritative response was received. The action may or may not have completed; it will not be retried automatically.";
    await persist();
    return undefined;
  }
}

function parseErrorData(raw: RawToolResult): Record<string, unknown> | undefined {
  if (raw.structuredContent && typeof raw.structuredContent === "object") return raw.structuredContent;
  const text = raw.content.find((entry) => entry.type === "text")?.text;
  if (!text) return undefined;
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

function isWorkLimit(data: Record<string, unknown>): boolean {
  return data.code === "work_limit" || data.work_remaining === 0 || data.works_remaining === 0;
}

function parseRecipes(data: Record<string, unknown>): LedgerRecipe[] {
  if (!Array.isArray(data.recipes)) throw new Error();
  return data.recipes.map(recipeFromUpstream);
}

function toUpstreamShape(recipe: LedgerRecipe): Record<string, unknown> {
  return { item: recipe.dishItemId, name: recipe.name, ingredients: recipe.ingredientNames, sell_value: recipe.sellValue };
}

async function loadState(file: string, gardenDay: string, recipeEnabled: boolean): Promise<RoutineState> {
  try {
    const state = await readJsonFile<RoutineState>(file);
    if (state.version === 1 && state.gardenDay === gardenDay && Array.isArray(state.steps)) return normalizeState(state, recipeEnabled);
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
  return { version: 1, gardenDay, steps: initialSteps(recipeEnabled) };
}

function normalizeState(state: RoutineState, recipeEnabled: boolean): RoutineState {
  const saved = new Map(state.steps.map((step) => [step.id, step]));
  return {
    version: 1,
    gardenDay: state.gardenDay,
    steps: STEP_IDS.map((id, index) => {
      if (!recipeEnabled && index >= 5) return { id, status: "disabled" };
      const existing = saved.get(id);
      return existing?.status === "completed" || existing?.status === "completed_by_daily_limit" || existing?.status === "completed_by_user" || existing?.status === "outcome_unknown" ? existing : { id, status: "not_run" };
    }),
  };
}

function initialSteps(recipeEnabled: boolean): RoutineStep[] {
  return STEP_IDS.map((id, index) => ({ id, status: !recipeEnabled && index >= 5 ? "disabled" : "not_run" }));
}

function done(step: RoutineStep): boolean {
  return step.status === "completed" || step.status === "completed_by_daily_limit" || step.status === "completed_by_user" || step.status === "disabled";
}

function failed(payload: DailyRoutinePayload, id: string): HandyToolResult<DailyRoutinePayload> {
  payload.status = "partial_failure";
  payload.failedStep = id;
  return resultFromPayload(payload, true);
}

function needsResolution(payload: DailyRoutinePayload, id: string): HandyToolResult<DailyRoutinePayload> {
  payload.status = "needs_resolution";
  payload.failedStep = id;
  payload.error = "This step has an unknown outcome and will not be retried automatically. The Agent must ask the user for an explicit choice after explaining both recovery risks, then call daily_routine with resolveUnknown set to assume_completed or retry.";
  payload.resolutionRequired = { stepId: id, choices: ["assume_completed", "retry"], retryMayDuplicate: true };
  return resultFromPayload(payload, true);
}

function publicError(error: unknown, fallback: string): string {
  return error instanceof Error && error.message === "daily_routine is already running in another process." ? error.message : fallback;
}
