import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

import type { GardenGateway, RawToolResult } from "./types.js";

export class MoonlightGardenGateway implements GardenGateway {
  private client: Client | undefined;
  private connecting: Promise<Client> | undefined;

  constructor(private readonly endpoint: URL, private readonly token?: string) {
    if (endpoint.protocol !== "https:" && endpoint.hostname !== "127.0.0.1" && endpoint.hostname !== "localhost") {
      throw new Error("MOONLIGHT_GARDEN_MCP_URL must use HTTPS (localhost is allowed for development).");
    }
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<RawToolResult> {
    const client = await this.getClient();
    const result = await client.callTool({ name, arguments: args });
    const content = result.content.flatMap((entry) => entry.type === "text" ? [{ type: "text" as const, text: entry.text }] : []);
    const structured = asObject(result.structuredContent);
    if (content.length === 0 && structured) content.push({ type: "text", text: JSON.stringify(structured) });
    return {
      content,
      ...(result.isError === true ? { isError: true } : {}),
      ...(structured ? { structuredContent: structured } : {}),
    };
  }

  async close(): Promise<void> {
    const client = this.client;
    this.client = undefined;
    this.connecting = undefined;
    if (client) await client.close();
  }

  private async getClient(): Promise<Client> {
    if (this.client) return this.client;
    this.connecting ??= this.connect();
    try {
      this.client = await this.connecting;
      return this.client;
    } finally {
      this.connecting = undefined;
    }
  }

  private async connect(): Promise<Client> {
    const client = new Client({ name: "moonlight-garden-handytools", version: "0.1.0" }, { versionNegotiation: { mode: "legacy" } });
    const headers = this.token ? { Authorization: `Bearer ${this.token}` } : undefined;
    const transport = new StreamableHTTPClientTransport(this.endpoint, headers ? { requestInit: { headers } } : undefined);
    await client.connect(transport);
    return client;
  }
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
