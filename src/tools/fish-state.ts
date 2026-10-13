export const BAIT_KEYS = ["bread", "moonworm", "stardust", "moonhalo", "fullmoon"] as const;
export type BaitKey = typeof BAIT_KEYS[number];

export interface BaitBrief {
  key: BaitKey;
  itemId: string;
  name: string;
  unitPrice: number;
  quantity: number;
}

export interface FishBrief {
  remainingCastCount: number;
  moonBalance: number;
  baits: BaitBrief[];
}

export function nonnegativeInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error("Expected a nonnegative safe integer.");
  return value;
}

export function readFishState(status: Record<string, unknown>, shop: Record<string, unknown>): FishBrief {
  if (!Array.isArray(status.bait) || !Array.isArray(shop.bait)) throw new Error("Missing bait inventory or shop.");
  const shopBaits = shop.bait;
  const inventory = new Map<string, number>();
  for (const entry of status.bait) {
    const row = object(entry);
    if (typeof row.key !== "string" || inventory.has(row.key)) throw new Error("Invalid bait inventory key.");
    inventory.set(row.key, nonnegativeInteger(row.quantity));
  }
  return {
    remainingCastCount: nonnegativeInteger(status.casts_remaining),
    moonBalance: nonnegativeInteger(shop.moon_balance),
    baits: BAIT_KEYS.map((key) => {
      const matches = shopBaits.filter((entry) => object(entry).item === `bait_${key}`);
      if (matches.length !== 1) throw new Error("Missing or duplicate shop bait.");
      const row = object(matches[0]);
      if (typeof row.name !== "string" || !row.name.trim()) throw new Error("Missing bait name.");
      return { key, itemId: `bait_${key}`, name: row.name, unitPrice: nonnegativeInteger(row.price), quantity: inventory.get(key) ?? 0 };
    }),
  };
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected an object.");
  return value as Record<string, unknown>;
}
