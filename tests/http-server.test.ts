import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { startHttpServer, type HttpServerInstance } from "../src/http-server.ts";

describe("Hosted Remote MCP Server (HTTP/SSE)", () => {
  let instance: HttpServerInstance;
  let serverUrl: string;

  beforeAll(async () => {
    instance = await startHttpServer({
      baseUrl: "https://mock.openproject.example.com",
      readOnly: true,
      port: 0, // OS assigns random available port
      host: "127.0.0.1",
    });
    serverUrl = `http://127.0.0.1:${instance.port}`;
  });

  afterAll(async () => {
    await instance.stop();
  });

  test("GET /health returns HTTP 200 with server status", async () => {
    const res = await fetch(`${serverUrl}/health`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      status: string;
      mode: string;
      openproject: string;
      readOnly: boolean;
    };
    expect(data.status).toBe("ok");
    expect(data.mode).toBe("remote-mcp");
    expect(data.openproject).toBe("https://mock.openproject.example.com");
    expect(data.readOnly).toBe(true);
  });

  test("GET /sse without API key returns HTTP 401 Unauthorized", async () => {
    const res = await fetch(`${serverUrl}/sse`);
    expect(res.status).toBe(401);
    const data = (await res.json()) as { error: string };
    expect(data.error).toContain("Missing OpenProject API key");
  });

  test("GET /sse with X-OpenProject-Api-Key header initiates SSE stream", async () => {
    const res = await fetch(`${serverUrl}/sse`, {
      headers: {
        "X-OpenProject-Api-Key": "test-key-header",
        Accept: "text/event-stream",
      },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const reader = res.body?.getReader();
    expect(reader).toBeDefined();

    const { value } = await reader!.read();
    const text = new TextDecoder().decode(value);
    expect(text).toContain("event: endpoint");
    expect(text).toContain("/messages?sessionId=");

    await reader!.cancel();
  });

  test("GET /sse with Authorization: Bearer header initiates SSE stream", async () => {
    const res = await fetch(`${serverUrl}/sse`, {
      headers: {
        Authorization: "Bearer test-key-bearer",
        Accept: "text/event-stream",
      },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const reader = res.body?.getReader();
    const { value } = await reader!.read();
    const text = new TextDecoder().decode(value);
    expect(text).toContain("event: endpoint");

    await reader!.cancel();
  });

  test("GET /sse with ?apiKey= query parameter initiates SSE stream", async () => {
    const res = await fetch(`${serverUrl}/sse?apiKey=test-key-query`, {
      headers: {
        Accept: "text/event-stream",
      },
    });

    expect(res.status).toBe(200);
    const reader = res.body?.getReader();
    const { value } = await reader!.read();
    const text = new TextDecoder().decode(value);
    expect(text).toContain("event: endpoint");

    await reader!.cancel();
  });

  test("POST /messages with invalid sessionId returns HTTP 404", async () => {
    const res = await fetch(`${serverUrl}/messages?sessionId=non-existent-id`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "ping", id: 1 }),
    });

    expect(res.status).toBe(404);
  });

  test("POST /messages with missing sessionId returns HTTP 400", async () => {
    const res = await fetch(`${serverUrl}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "ping", id: 1 }),
    });

    expect(res.status).toBe(400);
  });

  test("POST /messages with invalid JSON returns HTTP 400", async () => {
    const sseRes = await fetch(`${serverUrl}/sse?apiKey=test-key-json`, {
      headers: { Accept: "text/event-stream" },
    });
    const reader = sseRes.body?.getReader();
    const { value } = await reader!.read();
    const text = new TextDecoder().decode(value);
    const match = text.match(/\/messages\?sessionId=([a-zA-Z0-9_-]+)/);
    expect(match).toBeTruthy();
    const sessionId = match![1];

    const res = await fetch(`${serverUrl}/messages?sessionId=${sessionId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-json{",
    });
    expect(res.status).toBe(400);

    await reader!.cancel();
  });

  test("full JSON-RPC flow over SSE and POST /messages", async () => {
    const sseRes = await fetch(`${serverUrl}/sse?apiKey=test-session-key`, {
      headers: { Accept: "text/event-stream" },
    });
    expect(sseRes.status).toBe(200);
    const reader = sseRes.body?.getReader();
    expect(reader).toBeDefined();

    // 1. First event is endpoint
    const { value: epValue } = await reader!.read();
    const epText = new TextDecoder().decode(epValue);
    expect(epText).toContain("event: endpoint");
    const match = epText.match(/\/messages\?sessionId=([a-zA-Z0-9_-]+)/);
    expect(match).toBeTruthy();
    const sessionId = match![1];

    // 2. Client sends initialize request via POST /messages
    const postRes = await fetch(`${serverUrl}/messages?sessionId=${sessionId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "test-client", version: "1.0.0" },
        },
      }),
    });
    expect(postRes.status).toBe(202);

    // 3. Receive initialize response via SSE
    const { value: msgValue } = await reader!.read();
    const msgText = new TextDecoder().decode(msgValue);
    expect(msgText).toContain("event: message");
    const jsonMatch = msgText.match(/data:\s*(\{.*\})/);
    expect(jsonMatch).toBeTruthy();
    const rawData = jsonMatch?.[1];
    expect(rawData).toBeDefined();
    const rpcResponse = JSON.parse(rawData!);
    expect(rpcResponse.id).toBe(1);
    expect(rpcResponse.result).toBeDefined();
    expect(rpcResponse.result.serverInfo.name).toBe("openproject-mcp");

    // 4. Client sends tools/list request
    const toolsPostRes = await fetch(`${serverUrl}/messages?sessionId=${sessionId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: {},
      }),
    });
    expect(toolsPostRes.status).toBe(202);

    const { value: toolsValue } = await reader!.read();
    const toolsText = new TextDecoder().decode(toolsValue);
    expect(toolsText).toContain("event: message");
    const toolsMatch = toolsText.match(/data:\s*(\{.*\})/);
    expect(toolsMatch).toBeTruthy();
    const toolsRawData = toolsMatch?.[1];
    expect(toolsRawData).toBeDefined();
    const toolsRpcResponse = JSON.parse(toolsRawData!);
    expect(toolsRpcResponse.id).toBe(2);
    expect(toolsRpcResponse.result.tools).toBeDefined();
    expect(toolsRpcResponse.result.tools.length).toBeGreaterThan(0);

    await reader!.cancel();
  });

  test("client disconnect evicts session from active sessions", async () => {
    const ac = new AbortController();
    const sseRes = await fetch(`${serverUrl}/sse?apiKey=test-evict-key`, {
      headers: { Accept: "text/event-stream" },
      signal: ac.signal,
    });
    const reader = sseRes.body?.getReader();
    expect(reader).toBeDefined();

    const initialCount = instance.getActiveSessionsCount();
    expect(initialCount).toBeGreaterThan(0);

    // Abort client request to simulate disconnect
    ac.abort();

    // Small delay to allow abort callback to execute
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(instance.getActiveSessionsCount()).toBeLessThan(initialCount);
  });

  test("OPTIONS /sse and /messages return 204 with CORS headers", async () => {
    const res = await fetch(`${serverUrl}/sse`, {
      method: "OPTIONS",
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-methods")).toContain("GET");
  });

  test("concurrent clients with different API keys maintain isolated sessions", async () => {
    // Client A
    const resA = await fetch(`${serverUrl}/sse?apiKey=user-a-secret`, {
      headers: { Accept: "text/event-stream" },
    });
    const readerA = resA.body?.getReader();
    const { value: valA } = await readerA!.read();
    const textA = new TextDecoder().decode(valA);
    const matchA = textA.match(/\/messages\?sessionId=([a-zA-Z0-9_-]+)/);
    expect(matchA).toBeTruthy();
    const sessionIdA = matchA![1];

    // Client B
    const resB = await fetch(`${serverUrl}/sse?apiKey=user-b-secret`, {
      headers: { Accept: "text/event-stream" },
    });
    const readerB = resB.body?.getReader();
    const { value: valB } = await readerB!.read();
    const textB = new TextDecoder().decode(valB);
    const matchB = textB.match(/\/messages\?sessionId=([a-zA-Z0-9_-]+)/);
    expect(matchB).toBeTruthy();
    const sessionIdB = matchB![1];

    // Session IDs must be distinct
    expect(sessionIdA).not.toBe(sessionIdB);

    // Both can initialize independently
    const initA = await fetch(`${serverUrl}/messages?sessionId=${sessionIdA}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 101,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "client-a", version: "1.0.0" },
        },
      }),
    });
    expect(initA.status).toBe(202);

    const initB = await fetch(`${serverUrl}/messages?sessionId=${sessionIdB}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 201,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "client-b", version: "1.0.0" },
        },
      }),
    });
    expect(initB.status).toBe(202);

    // Read response for A
    const { value: respValA } = await readerA!.read();
    const respTextA = new TextDecoder().decode(respValA);
    expect(respTextA).toContain('"id":101');

    // Read response for B
    const { value: respValB } = await readerB!.read();
    const respTextB = new TextDecoder().decode(respValB);
    expect(respTextB).toContain('"id":201');

    await readerA!.cancel();
    await readerB!.cancel();
  });
});
