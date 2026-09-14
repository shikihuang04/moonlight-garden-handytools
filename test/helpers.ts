import type { GardenGateway, RawToolResult } from "../src/types.js";

export function raw(data: unknown, isError = false): RawToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data) }], isError };
}

export class FakeGateway implements GardenGateway {
  readonly calls: Array<{ name: string; arguments: Record<string, unknown> }> = [];

  constructor(private readonly results: Record<string, RawToolResult | Error>) {}

  set(key: string, result: RawToolResult | Error): void {
    this.results[key] = result;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<RawToolResult> {
    this.calls.push({ name, arguments: args });
    const key = `${name} ${String(args.command ?? "")}`.trim();
    const result = this.results[key] ?? this.results[name];
    if (result instanceof Error) throw result;
    if (!result) throw new Error(`Missing fake response for ${key}`);
    return structuredClone(result);
  }
}
