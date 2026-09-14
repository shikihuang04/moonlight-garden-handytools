import assert from "node:assert/strict";
import test from "node:test";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";

import { createServer, enabledToolNames } from "../src/server.js";
import { FakeGateway } from "./helpers.js";

test("each handy tool can be registered independently", () => {
  assert.deepEqual(enabledToolNames({ enabledTools: ["farm_brief"] }), ["farm_brief"]);
  assert.deepEqual(enabledToolNames({ enabledTools: ["daily_routine", "recipe_check"] }), ["daily_routine", "recipe_check"]);
});

test("MCP initialize and tools/list expose only configured tools", async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createServer({
    enabledTools: ["farm_brief"],
    profileId: "default",
    storageDirectory: "/tmp/handytools-test/profiles/default",
    recipeLedger: { enabledInDailyRoutine: false, directory: "/tmp/handytools-test", fileName: "recipes.md" },
    farmBrief: { cabbagePlantGapFormula: "chickenCount * 2 - cabbageInInventory" },
  }, new FakeGateway({}));
  const client = new Client({ name: "handytools-test", version: "1.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const tools = await client.listTools();
    assert.deepEqual(tools.tools.map((tool) => tool.name), ["farm_brief"]);
    assert.match(tools.tools[0]?.description ?? "", /bee-hive.*bee-trip.*waiting-young/iu);
    assert.equal(tools.tools[0]?.annotations?.readOnlyHint, true);
  } finally {
    await client.close();
    await server.close();
  }
});

test("daily_routine advertises explicit recovery choices for unknown outcomes", async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createServer({
    enabledTools: ["daily_routine"],
    profileId: "default",
    storageDirectory: "/tmp/handytools-test/profiles/default",
    recipeLedger: { enabledInDailyRoutine: false, directory: "/tmp/handytools-test", fileName: "recipes.md" },
    farmBrief: { cabbagePlantGapFormula: "chickenCount * 2 - cabbageInInventory" },
  }, new FakeGateway({}));
  const client = new Client({ name: "handytools-test", version: "1.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const tools = await client.listTools();
    const tool = tools.tools[0];
    const schema = tool?.inputSchema as { properties?: { resolveUnknown?: { enum?: string[]; description?: string } } };
    assert.deepEqual(schema.properties?.resolveUnknown?.enum, ["assume_completed", "retry"]);
    assert.match(schema.properties?.resolveUnknown?.description ?? "", /ask the user.*explicit choice/iu);
    assert.match(tool?.description ?? "", /must not choose.*without the user's explicit decision/iu);
  } finally {
    await client.close();
    await server.close();
  }
});
