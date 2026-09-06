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

  test("GET /sse falls back to config.apiKey when configured on server", async () => {
    const singleTenantServer = await startHttpServer({
      baseUrl: "https://mock.openproject.example.com",
      readOnly: true,
      port: 0,
      host: "127.0.0.1",
      apiKey: "server-configured-key",
    });

    const res = await fetch(`http://127.0.0.1:${singleTenantServer.port}/sse`, {
      headers: { Accept: "text/event-stream" },
    });
    expect(res.status).toBe(200);
    const reader = res.body?.getReader();
    const { value } = await reader!.read();
    const text = new TextDecoder().decode(value);
    expect(text).toContain("event: endpoint");
    await reader!.cancel();
    await singleTenantServer.stop();
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

  test("POST /sse with initialize message returns HTTP 200 with Mcp-Session-Id and serverInfo (Open WebUI compatibility)", async () => {
    const res = await fetch(`${serverUrl}/sse?apiKey=test-streamable-key`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "*/*", // Open WebUI / httpx often sends */* or application/json
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "open-webui", version: "0.5.0" },
        },
      }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const sessionId = res.headers.get("mcp-session-id");
    expect(sessionId).toBeTruthy();

    const data = (await res.json()) as {
      jsonrpc: string;
      id: number;
      result: {
        protocolVersion: string;
        serverInfo: { name: string; version: string };
      };
    };
    expect(data.jsonrpc).toBe("2.0");
    expect(data.id).toBe(1);
    expect(data.result.serverInfo.name).toBe("openproject-mcp");

    // Subsequent tools/list request with Mcp-Session-Id
    const toolsRes = await fetch(`${serverUrl}/sse`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Mcp-Session-Id": sessionId!,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: {},
      }),
    });

    expect(toolsRes.status).toBe(200);
    const toolsData = (await toolsRes.json()) as {
      jsonrpc: string;
      id: number;
      result: { tools: Array<{ name: string }> };
    };
    expect(toolsData.id).toBe(2);
    expect(toolsData.result.tools.length).toBeGreaterThan(0);
    expect(
      toolsData.result.tools.some((t) => t.name === "openproject_list_projects")
    ).toBe(true);

    // DELETE session to clean up
    const deleteRes = await fetch(`${serverUrl}/sse`, {
      method: "DELETE",
      headers: {
        "Mcp-Session-Id": sessionId!,
      },
    });
    expect(deleteRes.status).toBe(204);

    // Subsequent request on deleted session returns 404
    const afterDeleteRes = await fetch(`${serverUrl}/sse`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Mcp-Session-Id": sessionId!,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/list",
        params: {},
      }),
    });
    expect(afterDeleteRes.status).toBe(404);
  });

  test("Streamable HTTP on /mcp and / root endpoints", async () => {
    // 1. /mcp endpoint
    const mcpRes = await fetch(`${serverUrl}/mcp`, {
      method: "POST",
      headers: {
        Authorization: "Bearer test-mcp-path-key",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 10,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "test-client", version: "1.0.0" },
        },
      }),
    });
    expect(mcpRes.status).toBe(200);
    const mcpSessionId = mcpRes.headers.get("mcp-session-id");
    expect(mcpSessionId).toBeTruthy();

    // 2. / root endpoint
    const rootRes = await fetch(`${serverUrl}/`, {
      method: "POST",
      headers: {
        "X-OpenProject-Api-Key": "test-root-path-key",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 20,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "test-client", version: "1.0.0" },
        },
      }),
    });
    expect(rootRes.status).toBe(200);
    const rootSessionId = rootRes.headers.get("mcp-session-id");
    expect(rootSessionId).toBeTruthy();
    expect(rootSessionId).not.toBe(mcpSessionId);
  });

  test("POST /mcp without API key returns HTTP 401 Unauthorized", async () => {
    const res = await fetch(`${serverUrl}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "test", version: "1.0" },
        },
      }),
    });
    expect(res.status).toBe(401);
    const data = (await res.json()) as { error: string };
    expect(data.error).toContain("Missing OpenProject API key");
  });

  test("POST /mcp with invalid sessionId returns HTTP 404", async () => {
    const res = await fetch(`${serverUrl}/mcp`, {
      method: "POST",
      headers: {
        Authorization: "Bearer test-key",
        "Content-Type": "application/json",
        "Mcp-Session-Id": "non-existent-uuid",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: {},
      }),
    });
    expect(res.status).toBe(404);
  });

  test("GET /openapi.json and GET /swagger.json return valid OpenAPI 3.1.0 specification", async () => {
    // 1. GET /openapi.json
    const res = await fetch(`${serverUrl}/openapi.json`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");

    const spec = (await res.json()) as {
      openapi: string;
      info: { title: string; version: string };
      paths: Record<string, { post: { operationId: string; description: string } }>;
    };
    expect(spec.openapi).toBe("3.1.0");
    expect(spec.info.title).toContain("OpenProject");
    expect(spec.paths["/api/tools/openproject_list_projects"]).toBeDefined();
    expect(spec.paths["/api/tools/openproject_list_projects"]?.post.operationId).toBe(
      "openproject_list_projects"
    );
    expect(spec.paths["/api/tools/openproject_get_work_package"]).toBeDefined();

    // 2. GET /swagger.json returns identical spec
    const swaggerRes = await fetch(`${serverUrl}/swagger.json`);
    expect(swaggerRes.status).toBe(200);
    const swaggerSpec = (await swaggerRes.json()) as { openapi: string };
    expect(swaggerSpec.openapi).toBe("3.1.0");
  });

  test("POST /api/tools/:toolName executes tool and returns JSON result", async () => {
    // 1. Missing API key returns 401
    const noAuthRes = await fetch(`${serverUrl}/api/tools/openproject_list_projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pageSize: 10 }),
    });
    expect(noAuthRes.status).toBe(401);

    // 2. Non-existent tool returns 404
    const notFoundRes = await fetch(`${serverUrl}/api/tools/non_existent_tool`, {
      method: "POST",
      headers: {
        Authorization: "Bearer test-key",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });
    expect(notFoundRes.status).toBe(404);

    // 3. Invalid tool arguments return 400
    const invalidArgRes = await fetch(`${serverUrl}/api/tools/openproject_get_project`, {
      method: "POST",
      headers: {
        Authorization: "Bearer test-key",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}), // Missing required projectId
    });
    expect(invalidArgRes.status).toBe(400);

    // 4. Valid invocation executes tool and returns result
    const validRes = await fetch(`${serverUrl}/api/tools/openproject_list_projects`, {
      method: "POST",
      headers: {
        Authorization: "Bearer test-key",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ pageSize: 5 }),
    });
    expect(validRes.status).toBe(200);
    const result = (await validRes.json()) as {
      content: Array<{ type: string; text: string }>;
      data?: unknown;
    };
    expect(result.content).toBeDefined();
    expect(result.content.length).toBeGreaterThan(0);
    expect(result.content[0]?.type).toBe("text");

    // 5. Successful data execution with mocked fetch
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
        if (String(url).includes("/api/v3/projects")) {
          return new Response(
            JSON.stringify({
              _embedded: {
                elements: [
                  { id: 1, name: "Test Project", identifier: "test-proj" },
                ],
              },
              total: 1,
              count: 1,
              pageSize: 20,
              offset: 1,
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/hal+json" },
            }
          );
        }
        return originalFetch(url, init);
      }) as unknown as typeof fetch;

      const mockRes = await fetch(`${serverUrl}/api/tools/openproject_list_projects`, {
        method: "POST",
        headers: {
          Authorization: "Bearer test-key",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ pageSize: 5 }),
      });
      expect(mockRes.status).toBe(200);
      const mockResult = (await mockRes.json()) as {
        isError: boolean;
        data?: { projects: Array<{ id: number; identifier: string }> };
      };
      expect(mockResult.isError).toBe(false);
      expect(mockResult.data?.projects[0]?.identifier).toBe("test-proj");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("CLI entrypoint (src/index.ts) boots HTTP server when --port is provided", async () => {
    const proc = Bun.spawn(
      [
        "bun",
        "src/index.ts",
        "--port",
        "0",
        "--host",
        "127.0.0.1",
        "--read-only",
      ],
      {
        env: {
          ...process.env,
          OPENPROJECT_BASE_URL: "https://mock.openproject.example.com",
        },
        stderr: "pipe",
        stdout: "pipe",
      }
    );

    let stderrOutput = "";
    const decoder = new TextDecoder();
    const reader = proc.stderr.getReader();

    const readPromise = (async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          stderrOutput += decoder.decode(value, { stream: true });
          if (stderrOutput.includes("[openproject-mcp] Starting hosted HTTP server on 127.0.0.1:0...")) {
            break;
          }
        }
      } catch {
        // Stream closed
      }
    })();

    const start = Date.now();
    while (
      Date.now() - start < 5000 &&
      !stderrOutput.includes("[openproject-mcp] Starting hosted HTTP server on 127.0.0.1:0...")
    ) {
      await Bun.sleep(50);
    }

    expect(stderrOutput).toContain("[openproject-mcp] Starting hosted HTTP server on 127.0.0.1:0...");

    proc.kill();
    await proc.exited;
    try {
      await reader.cancel();
    } catch {
      // ignore
    }
    await readPromise;
  });
});
