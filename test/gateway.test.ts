import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { MoonlightGardenGateway, safeGatewayFailure } from "../src/gateway.js";

test("diagnostics allow only safe codes and never raw error text", () => {
  const secret="https://secret.example/mcp?api_key=DO_NOT_PRINT";
  const e=Object.assign(new Error(secret),{cause:{code:"ECONNRESET",message:secret}});
  assert.match(safeGatewayFailure(e,"tool_request").message,/ECONNRESET/);
  assert.doesNotMatch(safeGatewayFailure(e,"tool_request").message,/secret|DO_NOT_PRINT/);
  assert.match(safeGatewayFailure({status:503,message:secret},"connect").message,/HTTP 503/);
  assert.doesNotMatch(safeGatewayFailure({code:secret},"connect").message,/secret/);
});

test("real SDK HTTP failures are redacted and not replayed by the gateway", async () => {
  let calls=0;
  const server=createServer((_req,res)=>{calls++;res.writeHead(503).end("PRIVATE_SERVER_BODY");});
  await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));
  const addr=server.address();assert.ok(addr&&typeof addr!=="string");
  const g=new MoonlightGardenGateway(new URL("http://127.0.0.1:"+addr.port+"/mcp?api_key=PRIVATE_TOKEN"));
  try { await assert.rejects(g.callTool("farm",{command:"status"}),e=>{
    assert.ok(e instanceof Error);assert.doesNotMatch(e.message,/PRIVATE|127\.0\.0\.1/);return true;
  });assert.equal(calls,1); }
  finally {await g.close();await new Promise<void>(r=>server.close(()=>r()));}
});

test("a failed action is sent once and diagnosed as tool_request without payload leakage", async () => {
  let actions = 0;
  const server = createServer(async (req, res) => {
    if (req.method !== "POST") { res.writeHead(405).end(); return; }
    let body = ""; for await (const part of req) body += part;
    const message = JSON.parse(body);
    if (message.method === "initialize") {
      res.writeHead(200, {"Content-Type":"application/json"}).end(JSON.stringify({jsonrpc:"2.0",id:message.id,result:{protocolVersion:message.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:"fake",version:"1"}}}));
    } else if (message.method === "tools/call") { actions++; res.writeHead(503).end("PRIVATE_ACTION_BODY"); }
    else res.writeHead(202).end();
  });
  await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));
  const addr=server.address();assert.ok(addr&&typeof addr!=="string");
  const g=new MoonlightGardenGateway(new URL("http://127.0.0.1:"+addr.port+"/mcp"));
  try {
    await assert.rejects(g.callTool("fake_action",{private:"SECRET_ARGUMENT"}), e=>{
      assert.ok(e instanceof Error); assert.match(e.message,/tool_request/); assert.doesNotMatch(e.message,/PRIVATE|SECRET/); return true;
    });
    assert.equal(actions,1);
  } finally { await g.close(); await new Promise<void>(r=>server.close(()=>r())); }
});
