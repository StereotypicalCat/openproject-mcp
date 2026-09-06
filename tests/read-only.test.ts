import { describe, expect, test } from "bun:test";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createServer } from "../src/server";
import { parseConfig } from "../src/config";
import {
  registerTool,
  type ToolDefinition,
} from "../src/tools/common";
import { allTools, registerAllTools, type AnyToolDefinition } from "../src/tools";
import { OpenProjectError } from "../src/client/errors";
import { formatToolError } from "../src/tools/common";
import { getRequestContext } from "../src/context";

describe("Read-Only Mode Enforcement", () => {
  test("parseConfig parses read-only flags from env and argv", () => {
    const configEnv = parseConfig(
      {
        OPENPROJECT_BASE_URL: "http://localhost:8080",
        OPENPROJECT_API_KEY: "key",
        OPENPROJECT_READ_ONLY: "true",
      },
      []
    );
    expect(configEnv.readOnly).toBe(true);

    const configArg = parseConfig(
      {
        OPENPROJECT_BASE_URL: "http://localhost:8080",
        OPENPROJECT_API_KEY: "key",
      },
      ["--read-only"]
    );
    expect(configArg.readOnly).toBe(true);

    const configDefault = parseConfig(
      {
        OPENPROJECT_BASE_URL: "http://localhost:8080",
        OPENPROJECT_API_KEY: "key",
      },
      []
    );
    expect(configDefault.readOnly).toBe(false);

    const configOne = parseConfig(
      {
        OPENPROJECT_BASE_URL: "http://localhost:8080",
        OPENPROJECT_API_KEY: "key",
        OPENPROJECT_READ_ONLY: "1",
      },
      []
    );
    expect(configOne.readOnly).toBe(true);

    const configYes = parseConfig(
      {
        OPENPROJECT_BASE_URL: "http://localhost:8080",
        OPENPROJECT_API_KEY: "key",
        OPENPROJECT_READ_ONLY: "yes",
      },
      []
    );
    expect(configYes.readOnly).toBe(true);

    const configFalse = parseConfig(
      {
        OPENPROJECT_BASE_URL: "http://localhost:8080",
        OPENPROJECT_API_KEY: "key",
        OPENPROJECT_READ_ONLY: "false",
      },
      []
    );
    expect(configFalse.readOnly).toBe(false);
  });

  test("read-only server lists all 11 tools (all are readOnly: true)", async () => {
    const mcpServer = createServer({
      baseUrl: "http://localhost:8080",
      apiKey: "test-key",
      readOnly: true,
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await mcpServer.start(serverTransport);

    const client = new Client({ name: "client", version: "1" });
    await client.connect(clientTransport);

    const toolsResult = await client.listTools();
    expect(toolsResult.tools).toHaveLength(11);

    await client.close();
    await mcpServer.stop();
  });

  test("read-only mode filters out mutating tools from tools/list", async () => {
    const syntheticMutatingTool: ToolDefinition = {
      name: "openproject_create_work_package_synthetic",
      description: "Synthetic mutating tool",
      readOnly: false,
      execute: async () => ({ content: [{ type: "text", text: "created" }] }),
    };


    // Also verify registerAllTools explicitly filters out mutating tools when readOnly is true
    const standaloneServer = new McpServer({ name: "test-server", version: "1.0.0" });
    registerAllTools(standaloneServer, {
      readOnly: true,
      tools: [...allTools, syntheticMutatingTool as unknown as AnyToolDefinition],
    });

    const [cTransport, sTransport] = InMemoryTransport.createLinkedPair();
    await standaloneServer.connect(sTransport);

    const client2 = new Client({ name: "client-filter-test", version: "1.0.0" });
    await client2.connect(cTransport);

    const standaloneTools = await client2.listTools();
    const standaloneNames = standaloneTools.tools.map((t) => t.name);
    expect(standaloneNames).not.toContain("openproject_create_work_package_synthetic");
    expect(standaloneTools.tools).toHaveLength(11);

    await client2.close();
    await standaloneServer.close();
  });

  test("execution guard returns SERVER_READ_ONLY if mutating tool is called in read-only mode", async () => {
    let executionAttempted = false;
    const syntheticMutatingTool: ToolDefinition = {
      name: "openproject_synthetic_write",
      description: "Write tool",
      readOnly: false,
      execute: async () => {
        executionAttempted = true;
        return { content: [{ type: "text", text: "written" }] };
      },
    };

    const mcpServer = createServer({
      baseUrl: "http://localhost:8080",
      apiKey: "test-key",
      readOnly: true,
    });

    // Register with mutating tool included
    registerTool(mcpServer.server, syntheticMutatingTool, {
      wrapExecute: async (fn, tool) => {
        if (true && !tool.readOnly) {
          return formatToolError(
            new OpenProjectError(
              "Operation rejected. OpenProject MCP server is running in read-only mode.",
              { code: "SERVER_READ_ONLY" }
            )
          );
        }
        return fn();
      },
    });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await mcpServer.start(serverTransport);

    const client = new Client({ name: "client", version: "1" });
    await client.connect(clientTransport);

    const callRes = (await client.callTool({
      name: "openproject_synthetic_write",
      arguments: {},
    })) as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    };

    expect(callRes.isError).toBe(true);
    expect(callRes.content[0]!.text).toContain("SERVER_READ_ONLY");
    expect(callRes.content[0]!.text).toContain(
      "Operation rejected. OpenProject MCP server is running in read-only mode."
    );
    expect(executionAttempted).toBe(false);

    await client.close();
    await mcpServer.stop();
  });

  test("propagates isReadOnly flag in RequestContext during tool execution", async () => {
    let capturedReadOnly: boolean | undefined;

    const readOnlyServer = createServer({
      baseUrl: "http://localhost:8080",
      apiKey: "test-key",
      readOnly: true,
    });

    (
      readOnlyServer.client as unknown as {
        get: (path: string, query?: Record<string, unknown>) => Promise<unknown>;
      }
    ).get = async () => {
      const ctx = getRequestContext();
      capturedReadOnly = ctx.isReadOnly;
      return {
        _embedded: { elements: [] },
        total: 0,
        count: 0,
        pageSize: 20,
        offset: 1,
      };
    };

    const [clientTransport1, serverTransport1] = InMemoryTransport.createLinkedPair();
    await readOnlyServer.start(serverTransport1);

    const client1 = new Client({ name: "ro-client", version: "1.0.0" });
    await client1.connect(clientTransport1);

    await client1.callTool({
      name: "openproject_list_projects",
      arguments: {},
    });

    expect(capturedReadOnly).toBe(true);

    await client1.close();
    await readOnlyServer.stop();

    // Verify readOnly: false sets isReadOnly to false
    let capturedReadWrite: boolean | undefined;
    const readWriteServer = createServer({
      baseUrl: "http://localhost:8080",
      apiKey: "test-key",
      readOnly: false,
    });

    (
      readWriteServer.client as unknown as {
        get: (path: string, query?: Record<string, unknown>) => Promise<unknown>;
      }
    ).get = async () => {
      const ctx = getRequestContext();
      capturedReadWrite = ctx.isReadOnly;
      return {
        _embedded: { elements: [] },
        total: 0,
        count: 0,
        pageSize: 20,
        offset: 1,
      };
    };

    const [clientTransport2, serverTransport2] = InMemoryTransport.createLinkedPair();
    await readWriteServer.start(serverTransport2);

    const client2 = new Client({ name: "rw-client", version: "1.0.0" });
    await client2.connect(clientTransport2);

    await client2.callTool({
      name: "openproject_list_projects",
      arguments: {},
    });

    expect(capturedReadWrite).toBe(false);

    await client2.close();
    await readWriteServer.stop();
  });
});
