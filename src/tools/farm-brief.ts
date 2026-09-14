import { evaluateCabbageFormula } from "../formula.js";
import { parseToolData, resultFromPayload, type GardenGateway, type HandyToolResult } from "../types.js";

interface PlotBrief {
  plotId: number;
  cropId: string | null;
  maturesInSeconds: number | null;
}

interface ChickenBrief {
  chickenId: number;
  status: "hungry" | "normal";
  eggReadyInSeconds: number | null;
}

interface BeeTraits {
  beeId: string;
  label: string;
  colorId: string;
  patternId: string;
  preferenceId: string;
  preferredCrops: string[];
}

interface HiveBeeBrief extends BeeTraits {
  index: number;
  name: string | null;
}

interface BeesBrief {
  hiveCount: number;
  hiveSlots: number;
  tripsLeftToday: number;
  tripState: "home" | "away" | "ready_to_settle";
  backAt: string | null;
  backInText: string | null;
  codexCount: number;
  codexTotal: number;
  hive: HiveBeeBrief[];
  waitingYoung: BeeTraits[];
}

export interface FarmBriefPayload extends Record<string, unknown> {
  checkedAt: string;
  plots?: PlotBrief[];
  maturesIfWateredPlotIds?: number[];
  maturingWithinHours?: Record<"1" | "2" | "4", number[]>;
  waterCooldownSeconds?: number;
  waterAvailableAt?: string;
  chickens?: ChickenBrief[];
  chickenCount?: number;
  cabbageInInventory?: number;
  cabbagePlantGap?: number;
  bees?: BeesBrief;
  errors?: Record<string, string>;
}

export async function runFarmBrief({
  gateway,
  cabbageFormula,
  now = () => new Date(),
}: {
  gateway: GardenGateway;
  cabbageFormula: string;
  now?: () => Date;
}): Promise<HandyToolResult<FarmBriefPayload>> {
  const [farmResult, coopResult, beeResult] = await Promise.allSettled([
    gateway.callTool("farm", { command: "status" }),
    gateway.callTool("coop", { command: "status" }),
    gateway.callTool("bee", { command: "status" }),
  ]);
  const checkedAt = now();
  const payload: FarmBriefPayload = { checkedAt: checkedAt.toISOString() };
  const errors: Record<string, string> = {};

  if (farmResult.status === "fulfilled") {
    try {
      const farm = parseToolData(farmResult.value);
      readFarm(farm, checkedAt, payload, errors);
    } catch {
      errors.farm = "Farm status query failed or returned invalid data.";
    }
  } else {
    errors.farm = "Farm status query failed or returned invalid data.";
  }

  if (coopResult.status === "fulfilled") {
    try {
      const coop = parseToolData(coopResult.value);
      const chickens = readChickens(coop);
      payload.chickens = chickens;
      payload.chickenCount = chickens.length;
    } catch {
      errors.coop = "Coop status query failed or returned invalid chicken data.";
    }
  } else {
    errors.coop = "Coop status query failed or returned invalid chicken data.";
  }

  if (beeResult.status === "fulfilled") {
    try {
      payload.bees = readBees(parseToolData(beeResult.value));
    } catch {
      errors.bee = "Bee status query failed or returned invalid hive, trip, codex, or waiting-young data.";
    }
  } else {
    errors.bee = "Bee status query failed or returned invalid hive, trip, codex, or waiting-young data.";
  }

  if (payload.chickenCount !== undefined && payload.cabbageInInventory !== undefined) {
    try {
      payload.cabbagePlantGap = evaluateCabbageFormula(cabbageFormula, payload.chickenCount, payload.cabbageInInventory);
    } catch {
      errors.cabbagePlantGapFormula = "Configured cabbagePlantGapFormula is invalid or produced a non-finite result.";
    }
  }
  if (Object.keys(errors).length > 0) payload.errors = errors;
  return resultFromPayload(payload, Object.keys(errors).length > 0);
}

function readFarm(farm: Record<string, unknown>, checkedAt: Date, payload: FarmBriefPayload, errors: Record<string, string>): void {
  try {
    const plots = readPlots(farm);
    payload.plots = plots;
    payload.maturesIfWateredPlotIds = plots
      .filter((plot) => plot.maturesInSeconds !== null && plot.maturesInSeconds >= 1 && plot.maturesInSeconds <= 1800)
      .map((plot) => plot.plotId);
    payload.maturingWithinHours = {
      "1": futurePlots(plots, 3600),
      "2": futurePlots(plots, 7200),
      "4": futurePlots(plots, 14400),
    };
  } catch {
    errors.farm = "Farm status contains invalid plot data.";
  }

  const cooldown = farm.water_cooldown_seconds;
  if (typeof cooldown === "number" && Number.isFinite(cooldown) && cooldown >= 0) {
    payload.waterCooldownSeconds = Math.ceil(cooldown);
    payload.waterAvailableAt = new Date(checkedAt.getTime() + payload.waterCooldownSeconds * 1000).toISOString();
  } else {
    errors.water = "Farm status is missing a valid watering cooldown.";
  }

  const inventory = asObject(farm.inventory);
  if (inventory) {
    const cabbage = Object.hasOwn(inventory, "crop_cabbage") ? inventory.crop_cabbage : 0;
    if (Number.isInteger(cabbage) && (cabbage as number) >= 0) payload.cabbageInInventory = cabbage as number;
    else errors.inventory = "Farm status contains an invalid cabbage inventory quantity.";
  } else {
    errors.inventory = "Farm status is missing inventory data.";
  }
}

function readPlots(farm: Record<string, unknown>): PlotBrief[] {
  if (!Array.isArray(farm.plots)) throw new Error();
  const house = asObject(farm.house);
  const housePlot = house?.plot;
  return farm.plots.flatMap((entry): PlotBrief[] => {
    const plot = asObject(entry);
    if (!plot) throw new Error();
    if (plot.state === "house" || plot.plot === housePlot) return [];
    if (!Number.isInteger(plot.plot) || (plot.plot as number) < 1) throw new Error();
    const plotId = plot.plot as number;
    if (plot.state === "empty") return [{ plotId, cropId: null, maturesInSeconds: null }];
    if (typeof plot.crop !== "string" || plot.crop.length === 0) throw new Error();
    if (plot.state === "mature" || plot.state === "ready") return [{ plotId, cropId: plot.crop, maturesInSeconds: 0 }];
    if (plot.state === "growing" && typeof plot.matures_in_seconds === "number" && Number.isFinite(plot.matures_in_seconds) && plot.matures_in_seconds >= 0) {
      return [{ plotId, cropId: plot.crop, maturesInSeconds: Math.ceil(plot.matures_in_seconds) }];
    }
    throw new Error();
  });
}

function futurePlots(plots: PlotBrief[], limit: number): number[] {
  return plots.filter((plot) => plot.maturesInSeconds !== null && plot.maturesInSeconds > 0 && plot.maturesInSeconds <= limit).map((plot) => plot.plotId);
}

function readChickens(coop: Record<string, unknown>): ChickenBrief[] {
  if (!Array.isArray(coop.chickens)) throw new Error();
  return coop.chickens.map((entry) => {
    const chicken = asObject(entry);
    if (!chicken || !Number.isInteger(chicken.index) || (chicken.index as number) < 1) throw new Error();
    const chickenId = chicken.index as number;
    if (chicken.state === "hungry") return { chickenId, status: "hungry", eggReadyInSeconds: null };
    if (chicken.state === "ready" || chicken.state === "egg_ready") return { chickenId, status: "normal", eggReadyInSeconds: 0 };
    if (chicken.state === "laying") return { chickenId, status: "normal", eggReadyInSeconds: parseEggDuration(chicken.status) };
    throw new Error();
  });
}

function parseEggDuration(value: unknown): number {
  const match = typeof value === "string" && value.match(/^正在下蛋，还要\s*(?:(\d+)\s*天\s*)?(?:(\d+)\s*小时\s*)?(?:(\d+)\s*分(?:钟)?\s*)?(?:(\d+)\s*秒\s*)?$/u);
  if (!match || !match.slice(1).some((part) => part !== undefined)) throw new Error();
  return Math.max(1, Number(match[1] ?? 0) * 86400 + Number(match[2] ?? 0) * 3600 + Number(match[3] ?? 0) * 60 + Number(match[4] ?? 0));
}

function readBees(data: Record<string, unknown>): BeesBrief {
  if (!Array.isArray(data.hive)) throw new Error();
  const hive = data.hive.map(readHiveBee);
  const [hiveCount, countSlots] = readFraction(data.count);
  if (!Number.isInteger(data.slots) || (data.slots as number) < 0 || countSlots !== data.slots || hiveCount !== hive.length || hiveCount > (data.slots as number)) throw new Error();
  const [codexCount, codexTotal] = readFraction(data.codex);
  if (codexCount > codexTotal) throw new Error();
  if (!Number.isInteger(data.trips_left_today) || (data.trips_left_today as number) < 0) throw new Error();
  const waiting = data.waiting === undefined ? [] : data.waiting;
  if (!Array.isArray(waiting)) throw new Error();
  const trip = readBeeTrip(data);
  return {
    hiveCount,
    hiveSlots: data.slots as number,
    tripsLeftToday: data.trips_left_today as number,
    ...trip,
    codexCount,
    codexTotal,
    hive,
    waitingYoung: waiting.map(readBeeTraits),
  };
}

function readHiveBee(value: unknown): HiveBeeBrief {
  const bee = asObject(value);
  if (!bee || !Number.isInteger(bee.index) || (bee.index as number) < 1) throw new Error();
  if (bee.name !== null && (typeof bee.name !== "string" || bee.name.trim().length === 0)) throw new Error();
  return {
    ...readBeeTraits(bee),
    index: bee.index as number,
    name: bee.name as string | null,
  };
}

function readBeeTraits(value: unknown): BeeTraits {
  const bee = asObject(value);
  if (!bee) throw new Error();
  return {
    beeId: requiredText(bee.bee_id),
    label: requiredText(bee.label),
    colorId: requiredText(bee.color),
    patternId: requiredText(bee.pattern),
    preferenceId: requiredText(bee.preference),
    preferredCrops: readTextList(bee.prefers_crops),
  };
}

function readBeeTrip(data: Record<string, unknown>): Pick<BeesBrief, "tripState" | "backAt" | "backInText"> {
  if (data.out === undefined || data.out === false) return { tripState: "home", backAt: null, backInText: null };
  if (data.out !== true) throw new Error();
  const backInText = requiredText(data.back_in);
  const hint = requiredText(data.hint);
  if (backInText === "一会儿" && hint.includes("回来了") && hint.includes("settle")) {
    return { tripState: "ready_to_settle", backAt: null, backInText: null };
  }
  if (backInText !== "一会儿" && hint.includes("还在外面")) {
    return { tripState: "away", backAt: readBackAt(data.back_at), backInText };
  }
  throw new Error();
}

function readBackAt(value: unknown): string | null {
  if (value === undefined) return null;
  if (!Number.isInteger(value) || (value as number) <= 0) throw new Error();
  const date = new Date((value as number) * 1000);
  if (!Number.isFinite(date.getTime())) throw new Error();
  return date.toISOString();
}

function readFraction(value: unknown): [number, number] {
  const match = typeof value === "string" && value.match(/^(\d+)\/(\d+)$/u);
  if (!match) throw new Error();
  return [Number(match[1]), Number(match[2])];
}

function requiredText(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error();
  return value;
}

function readTextList(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error();
  return value.map(requiredText);
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
