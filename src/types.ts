export interface TextContent {
  type: "text";
  text: string;
}

export interface RawToolResult {
  content: TextContent[];
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
}

export interface GardenGateway {
  callTool(name: string, args: Record<string, unknown>): Promise<RawToolResult>;
  close?(): Promise<void>;
}

export interface HandyToolResult<T extends Record<string, unknown>> {
  [key: string]: unknown;
  content: TextContent[];
  structuredContent: T;
  isError?: boolean;
}

export type ToolName = "daily_routine" | "farm_brief" | "recipe_check";

export function resultFromPayload<T extends Record<string, unknown>>(payload: T, isError = false): HandyToolResult<T> {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
    ...(isError ? { isError: true } : {}),
  };
}

export function parseToolData(result: RawToolResult): Record<string, unknown> {
  if (result.isError) throw new UpstreamToolError("Moonlight Garden tool returned an error.", result);
  if (result.structuredContent && typeof result.structuredContent === "object") return result.structuredContent;
  const text = result.content.find((entry) => entry.type === "text")?.text;
  if (!text) throw new UpstreamToolError("Moonlight Garden tool returned no JSON data.", result);
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    throw new UpstreamToolError("Moonlight Garden tool returned invalid JSON data.", result);
  }
}

export class UpstreamToolError extends Error {
  constructor(message: string, readonly result?: RawToolResult) {
    super(message);
    this.name = "UpstreamToolError";
  }
}
