import { describe, expect, test, spyOn } from "bun:test";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer, SERVER_NAME, SERVER_VERSION } from "../src/server";

describe("MCP Server Factory", () => {
  test("creates server and lists all 11 tools via InMemoryTransport", async () => {
    const config = {
      baseUrl: "http://localhost:8080",
      apiKey: "test-key",
      readOnly: false,
    };

    const mcpServer = createServer(config);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await mcpServer.start(serverTransport);

    const client = new Client({ name: "test-client", version: "1.0.0" });
    await client.connect(clientTransport);

    const toolsResult = await client.listTools();
    expect(toolsResult.tools).toHaveLength(11);
    const names = toolsResult.tools.map((t) => t.name);
    expect(names).toContain("openproject_list_projects");
    expect(names).toContain("openproject_get_project");
    expect(names).toContain("openproject_list_work_packages");
    expect(names).toContain("openproject_get_work_package");
    expect(names).toContain("openproject_list_queries");
    expect(names).toContain("openproject_get_query");
    expect(names).toContain("openproject_list_types");
    expect(names).toContain("openproject_list_statuses");
    expect(names).toContain("openproject_list_priorities");
    expect(names).toContain("openproject_list_users");
    expect(names).toContain("openproject_get_openapi_spec");

    await client.close();
    await mcpServer.stop();
  });

  test("server exposes server, client, start, and stop properties with correct constants", () => {
    expect(SERVER_NAME).toBe("openproject-mcp");
    expect(SERVER_VERSION).toBe("0.1.0");

    const config = {
      baseUrl: "https://openproject.example.com",
      apiKey: "secret-key",
      readOnly: true,
    };

    const mcpServer = createServer(config);
    expect(mcpServer.server).toBeDefined();
    expect(mcpServer.client).toBeDefined();
    expect(typeof mcpServer.start).toBe("function");
    expect(typeof mcpServer.stop).toBe("function");
  });

  test("executes tool through MCP client and injects RequestContext", async () => {
    const config = {
      baseUrl: "http://localhost:8080",
      apiKey: "test-key",
      readOnly: false,
    };

    const mcpServer = createServer(config);

    // Mock client.get on mcpServer.client to verify ambient context is used
    let interceptedPath: string | undefined;
    (
      mcpServer.client as unknown as {
        get: (path: string, query?: Record<string, unknown>) => Promise<unknown>;
      }
    ).get = async (path: string, _query?: Record<string, unknown>) => {
      interceptedPath = path;
      return {
        _embedded: {
          elements: [
            {
              id: 42,
              identifier: "ambient-project",
              name: "Ambient Test Project",
              active: true,
              public: true,
              description: { raw: "Ambient description" },
              createdAt: "2026-09-06T00:00:00Z",
              updatedAt: "2026-09-06T00:00:00Z",
            },
          ],
        },
        total: 1,
        count: 1,
        pageSize: 20,
        offset: 1,
      };
    };

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await mcpServer.start(serverTransport);

    const client = new Client({ name: "test-client", version: "1.0.0" });
    await client.connect(clientTransport);

    const callResult = (await client.callTool({
      name: "openproject_list_projects",
      arguments: {},
    })) as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    };

    expect(callResult.isError).toBeFalsy();
    expect(interceptedPath).toBe("projects");
    const parsed = JSON.parse(callResult.content[0]?.text ?? "{}");
    expect(parsed.total).toBe(1);
    expect(parsed.projects[0]?.id).toBe(42);
    expect(parsed.projects[0]?.identifier).toBe("ambient-project");

    await client.close();
    await mcpServer.stop();
  });

  test("read-only mode filters tools and maintains read-only status in context", async () => {
    const config = {
      baseUrl: "http://localhost:8080",
      apiKey: "test-key",
      readOnly: true,
    };

    const mcpServer = createServer(config);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await mcpServer.start(serverTransport);

    const client = new Client({ name: "test-client", version: "1.0.0" });
    await client.connect(clientTransport);

    // In read-only mode, only readOnly: true tools should be registered
    const toolsResult = await client.listTools();
    expect(toolsResult.tools).toHaveLength(11);

    await client.close();
    await mcpServer.stop();
  });

  test("start defaults to StdioServerTransport when no transport is provided", async () => {
    const config = {
      baseUrl: "http://localhost:8080",
      apiKey: "test-key",
      readOnly: false,
    };

    const mcpServer = createServer(config);
    let capturedTransport: unknown;
    const connectSpy = spyOn(mcpServer.server, "connect").mockImplementation(
      async (transport) => {
        capturedTransport = transport;
      }
    );

    await mcpServer.start();
    expect(connectSpy).toHaveBeenCalled();
    expect(capturedTransport).toBeInstanceOf(StdioServerTransport);

    connectSpy.mockRestore();
  });

  test("start and stop log messages via console.error", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});

    const config = {
      baseUrl: "http://localhost:8080",
      apiKey: "test-key",
      readOnly: false,
    };

    const mcpServer = createServer(config);
    const [, serverTransport] = InMemoryTransport.createLinkedPair();

    await mcpServer.start(serverTransport);
    expect(errorSpy).toHaveBeenCalledWith(
      "[openproject-mcp] Server started (readOnly=false)"
    );

    await mcpServer.stop();
    expect(errorSpy).toHaveBeenCalledWith("[openproject-mcp] Server stopped");

    errorSpy.mockRestore();
  });
});

describe("End-to-End Live Tool Calling over MCP Client", () => {
  const baseUrl = process.env.OPENPROJECT_BASE_URL || "http://localhost:8080";
  const apiKey = process.env.OPENPROJECT_API_KEY || "";

  test("calls openproject_list_projects and openproject_get_work_package via Client", async () => {
    const mcpServer = createServer({ baseUrl, apiKey, readOnly: false });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await mcpServer.start(serverTransport);

    const client = new Client({ name: "test-runner", version: "1" });
    await client.connect(clientTransport);

    try {
      // Call openproject_list_projects
      const projRes = (await client.callTool({
        name: "openproject_list_projects",
        arguments: { pageSize: 5 },
      })) as {
        content: Array<{ type: string; text: string }>;
        isError?: boolean;
      };
      expect(projRes.isError).toBeFalsy();
      const projData = JSON.parse(projRes.content[0]?.text ?? "{}");
      expect(projData.projects.length).toBeGreaterThan(0);

      // Call openproject_get_work_package
      const wpRes = (await client.callTool({
        name: "openproject_get_work_package",
        arguments: { workPackageId: 38 },
      })) as {
        content: Array<{ type: string; text: string }>;
        isError?: boolean;
      };
      expect(wpRes.isError).toBeFalsy();
      const wpData = JSON.parse(wpRes.content[0]?.text ?? "{}");
      expect(wpData.id).toBe(38);
    } finally {
      await client.close();
      await mcpServer.stop();
    }
  });

  test("tool error propagation returns isError: true without crashing client", async () => {
    const mcpServer = createServer({ baseUrl, apiKey, readOnly: false });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await mcpServer.start(serverTransport);

    const client = new Client({ name: "test-runner", version: "1" });
    await client.connect(clientTransport);

    try {
      const errRes = (await client.callTool({
        name: "openproject_get_project",
        arguments: { projectId: 999999 },
      })) as {
        content: Array<{ type: string; text: string }>;
        isError?: boolean;
      };
      expect(errRes.isError).toBe(true);
      expect(errRes.content[0]?.text).toContain("OPENPROJECT_NOT_FOUND");
    } finally {
      await client.close();
      await mcpServer.stop();
    }
  });
});

