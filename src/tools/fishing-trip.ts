import { withFishingLock } from "../storage.js";
import { parseToolData, resultFromPayload, type GardenGateway, type HandyToolResult, type RawToolResult } from "../types.js";
import { BAIT_KEYS, nonnegativeInteger, readFishState, type BaitKey } from "./fish-state.js";

export const BAIT_ORDER: readonly BaitKey[] = ["fullmoon", "moonhalo", "stardust", "moonworm", "bread"];
type ActionState = "completed" | "failed" | "unknown";
interface PurchasePlan {
  baitKey: BaitKey;
  itemId: string;
  name: string;
  unitPrice: number;
  quantityBefore: number;
  quantityToBuy: number;
  estimatedCost: number;
}
interface PurchaseReceipt {
  baitKey: BaitKey;
  state: ActionState;
  quantity: number | null;
  cost: number | null;
  result?: RawToolResult;
}
interface CastReceipt {
  castNumber: number;
  baitKey: BaitKey;
  state: ActionState;
  result?: RawToolResult;
}
export interface FishingTripPayload extends Record<string, unknown> {
  status: "completed" | "noop" | "error" | "partial_failure";
  requestedCasts: Record<BaitKey, number>;
  purchasedBaitCounts: Record<BaitKey, number>;
  spentMoon: number;
  purchaseTotalsComplete: boolean;
  purchases: PurchaseReceipt[];
  casts: CastReceipt[];
  remainingSteps: "none" | "not_run";
  notRunPurchaseKeys: BaitKey[];
  notRunCastCount: number;
  remainingCastCountBefore?: number;
  moonBalanceBefore?: number;
  purchasePlan?: PurchasePlan[];
  requiredMoon?: number;
  failedStep?: { stage: string; state: "failed" | "unknown"; code: string; error: string; baitKey?: BaitKey; castNumber?: number; result?: RawToolResult };
  message?: string;
}

export async function runFishingTrip({ gateway, lockFile, args = {} }: {
  gateway: GardenGateway;
  lockFile: string;
  args?: unknown;
}): Promise<HandyToolResult<FishingTripPayload>> {
  const counts = (): Record<BaitKey, number> => Object.fromEntries(BAIT_KEYS.map((key) => [key, 0])) as Record<BaitKey, number>;
  const payload: FishingTripPayload = {
    status: "completed", requestedCasts: counts(), purchasedBaitCounts: counts(), spentMoon: 0,
    purchaseTotalsComplete: true, purchases: [], casts: [], remainingSteps: "not_run", notRunPurchaseKeys: [], notRunCastCount: 0,
  };
  const stop = (stage: string, state: "failed" | "unknown", code: string, error: string,
    details: { baitKey?: BaitKey; castNumber?: number; result?: RawToolResult } = {}): HandyToolResult<FishingTripPayload> => {
    if (stage === "purchase" && state === "unknown") payload.purchaseTotalsComplete = false;
    payload.status = payload.purchases.length || payload.casts.length ? "partial_failure" : "error";
    payload.failedStep = { stage, state, code, error, ...details };
    return resultFromPayload(payload, true);
  };
  if (!args || typeof args !== "object" || Array.isArray(args) || Object.keys(args).some((key) => !BAIT_KEYS.includes(key as BaitKey))) {
    return stop("validation", "failed", "invalid_arguments", "Only the five optional nonnegative integer bait counts are accepted.");
  }
  try {
    for (const key of BAIT_KEYS) {
      const value = (args as Record<string, unknown>)[key];
      payload.requestedCasts[key] = nonnegativeInteger(value === undefined ? 0 : value);
    }
    payload.notRunCastCount = nonnegativeInteger(Object.values(payload.requestedCasts).reduce((sum, value) => sum + value, 0));
  } catch {
    return stop("validation", "failed", "invalid_arguments", "Each count and their sum must be a nonnegative safe integer.");
  }
  if (payload.notRunCastCount === 0) {
    payload.status = "noop";
    payload.remainingSteps = "none";
    payload.message = "未购买、未钓鱼。";
    return resultFromPayload(payload);
  }

  try {
    return await withFishingLock(lockFile, async () => {
      let status: Record<string, unknown>;
      let sourceResult: RawToolResult | undefined;
      try {
        sourceResult = await gateway.callTool("fish", { command: "status" });
        status = parseToolData(sourceResult);
        payload.remainingCastCountBefore = nonnegativeInteger(status.casts_remaining);
      } catch {
        return stop("status", "failed", "source_error", "fish status query or parsing failed; no actions were performed.", sourceResult ? { result: sourceResult } : {});
      }
      if (payload.notRunCastCount > payload.remainingCastCountBefore) {
        return stop("precheck", "failed", "insufficient_casts", `Requested ${payload.notRunCastCount} casts, but only ${payload.remainingCastCountBefore} remain today. No bait was bought or cast.`);
      }
      sourceResult = undefined;
      try {
        sourceResult = await gateway.callTool("fish", { command: "shop" });
        const fish = readFishState(status, parseToolData(sourceResult));
        payload.moonBalanceBefore = fish.moonBalance;
        payload.purchasePlan = BAIT_ORDER.filter((key) => payload.requestedCasts[key] > 0).map((baitKey) => {
          const bait = fish.baits.find((row) => row.key === baitKey)!;
          const quantityToBuy = Math.max(0, payload.requestedCasts[baitKey] - bait.quantity);
          return { baitKey, itemId: bait.itemId, name: bait.name, unitPrice: bait.unitPrice, quantityBefore: bait.quantity,
            quantityToBuy, estimatedCost: quantityToBuy * bait.unitPrice };
        });
      } catch {
        return stop("shop", "failed", "source_error", "fish shop or bait inventory parsing failed; no actions were performed.", sourceResult ? { result: sourceResult } : {});
      }
      try { payload.requiredMoon = nonnegativeInteger(payload.purchasePlan.reduce((sum, row) => sum + row.estimatedCost, 0)); }
      catch { return stop("precheck", "failed", "invalid_cost", "The total bait cost could not be calculated; no actions were performed."); }
      const purchases = payload.purchasePlan.filter((row) => row.quantityToBuy > 0);
      payload.notRunPurchaseKeys = purchases.map((row) => row.baitKey);
      // One combined, inventory-adjusted money check before ANY purchase.
      if (payload.requiredMoon > payload.moonBalanceBefore) {
        return stop("precheck", "failed", "insufficient_moon", `All missing bait costs ${payload.requiredMoon} moon; balance is ${payload.moonBalanceBefore} moon. Nothing was bought or cast.`);
      }
      for (const plan of purchases) {
        const receipt: PurchaseReceipt = { baitKey: plan.baitKey, state: "unknown", quantity: null, cost: null };
        payload.purchases.push(receipt);
        payload.notRunPurchaseKeys.shift();
        try {
          receipt.result = await gateway.callTool("fish", { command: `buy ${plan.baitKey} ${plan.quantityToBuy}` });
          if (receipt.result.isError) {
            receipt.state = "failed";
            return stop("purchase", "failed", "purchase_failed", "Purchase was rejected; all remaining purchases and casts are not run.", { baitKey: plan.baitKey });
          }
          const data = parseToolData(receipt.result);
          if (data.item !== plan.itemId) throw new Error();
          const quantity = nonnegativeInteger(data.quantity);
          const cost = nonnegativeInteger(data.cost);
          receipt.quantity = quantity;
          receipt.cost = cost;
          receipt.state = "completed";
          payload.purchasedBaitCounts[plan.baitKey] += quantity;
          payload.spentMoon += cost;
          if (quantity !== plan.quantityToBuy) {
            return stop("purchase", "failed", "purchase_quantity_mismatch", "Confirmed quantity differs from the request; actual quantity/cost are retained and remaining steps are not run.", { baitKey: plan.baitKey });
          }
        } catch {
          return stop("purchase", "unknown", "purchase_result_unknown", "Purchase response was lost or unconfirmable. Outcome unknown; no automatic retry, remaining steps are not run.", { baitKey: plan.baitKey });
        }
      }
      for (const baitKey of BAIT_ORDER) {
        for (let index = 0; index < payload.requestedCasts[baitKey]; index += 1) {
          const receipt: CastReceipt = { baitKey, castNumber: payload.casts.length + 1, state: "unknown" };
          payload.casts.push(receipt);
          payload.notRunCastCount -= 1;
          try {
            receipt.result = await gateway.callTool("fish", { command: `cast 1 ${baitKey}` });
            if (receipt.result.isError) {
              receipt.state = "failed";
              return stop("cast", "failed", "cast_failed", "This cast was rejected; completed results are retained and remaining casts are not run.", { baitKey, castNumber: receipt.castNumber });
            }
            if (!receipt.result.structuredContent && receipt.result.content.length === 0) throw new Error();
            receipt.state = "completed";
          } catch {
            return stop("cast", "unknown", "cast_result_unknown", "This cast timed out, disconnected, or returned no confirmable response. Outcome unknown; no automatic retry, remaining casts are not run.", { baitKey, castNumber: receipt.castNumber });
          }
        }
      }
      payload.remainingSteps = "none";
      return resultFromPayload(payload);
    });
  } catch {
    return stop("lock", "failed", "lock_unavailable", "Fishing lock is unavailable or still exists. No new run was started; verify the prior process stopped before removing a leftover lock.");
  }
}
