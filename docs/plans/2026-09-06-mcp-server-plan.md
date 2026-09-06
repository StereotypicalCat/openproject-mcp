# MCP Stdio Server Assembly & Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Assemble the OpenProject MCP server with `StdioServerTransport`, scoped request context execution, read-only mode enforcement, and end-to-end client verification.

**Architecture:** A modular server factory (`src/server.ts`) initializes `McpServer` and `OpenProjectClient`, registers all 10 tools with execution wrappers running inside `runWithContext`, connects to `StdioServerTransport` in CLI entrypoint (`src/index.ts`), and redirects all diagnostics to `stderr`.

**Tech Stack:** Bun, TypeScript, `@modelcontextprotocol/sdk` (McpServer, StdioServerTransport, InMemoryTransport, Client), Zod, `bun:test`.

**Spec:** [docs/specs/2026-09-06-mcp-server-design.md](file:///home/user/openproject-mcp/docs/specs/2026-09-06-mcp-server-design.md)

## Global Constraints
- Bun runtime (>= 1.3), `bun test` for verification.
- Strict TypeScript (`strict: true`), no `any` (use explicit Zod types or `unknown`).
- Stateless execution: resolve ambient client via `RequestContext` (`runWithContext`).
- All server diagnostics and logging must use `console.error` (never `console.log` on stdout).
- Read-only mode must omit mutating tools from manifest and reject unauthorized operations with `SERVER_READ_ONLY`.

---

### Task 1: Execution Wrapper & Read-Only Guard in Tool Registration

**Files:**
- Modify: `src/tools/common.ts`
- Modify: `src/tools/index.ts`
- Modify: `tests/tools.test.ts`

**Interfaces:**
- Consumes: `src/tools/common.ts`, `src/tools/index.ts`
- Produces:
  - `RegisterToolOptions`: `{ wrapExecute?: (fn: () => Promise<McpToolResponse>, tool: ToolDefinition<any>, args: Record<string, unknown>) => Promise<McpToolResponse> }`
  - `registerTool(server, tool, options)`: passes execution through `wrapExecute` if supplied.
  - `registerAllTools(server, options)`: forwards `wrapExecute` to each tool registration.

- [x] **Step 1: Write failing tests for tool execution wrapping**

In `tests/tools.test.ts`:
```typescript
describe("Tool Execution Wrapper", () => {
  test("registerTool passes execution through wrapExecute when provided", async () => {
    const server = new McpServer({ name: "test", version: "1" });
    let wrapperCalled = false;
    const dummyTool: ToolDefinition = {
      name: "wrapped_tool",
      description: "A wrapped tool",
      readOnly: true,
      execute: async () => ({ content: [{ type: "text", text: "success" }] }),
    };

    registerTool(server, dummyTool, {
      wrapExecute: async (fn) => {
        wrapperCalled = true;
        return fn();
      },
    });

    const registered = (server as unknown as { _registeredTools: Record<string, any> })._registeredTools["wrapped_tool"];
    const result = await registered.handler({});
    expect(wrapperCalled).toBe(true);
    expect(result.content[0].text).toBe("success");
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `bun test tests/tools.test.ts`
Expected: FAIL (options parameter or wrapExecute behavior not implemented).

- [x] **Step 3: Implement wrapExecute in `src/tools/common.ts` and `src/tools/index.ts`**

In `src/tools/common.ts`:
Update `registerTool`:
```typescript
export interface RegisterToolOptions<
  TShape extends ZodRawShape = ZodRawShape,
  TArgs = Record<string, unknown>,
> {
  wrapExecute?: (
    fn: () => Promise<McpToolResponse>,
    tool: ToolDefinition<TShape, TArgs>,
    args: TArgs
  ) => Promise<McpToolResponse>;
}

export function registerTool<
  TShape extends ZodRawShape = ZodRawShape,
  TArgs = Record<string, unknown>,
>(
  server: McpServer,
  tool: ToolDefinition<TShape, TArgs>,
  options?: RegisterToolOptions<TShape, TArgs>
): void {
  const executeFn = (args: TArgs) => {
    if (options?.wrapExecute) {
      return options.wrapExecute(() => tool.execute(args), tool, args);
    }
    return tool.execute(args);
  };

  if (tool.parameters) {
    server.tool(tool.name, tool.description, tool.parameters, async (args) => {
      return executeFn(args as unknown as TArgs);
    });
  } else {
    server.tool(tool.name, tool.description, async () => {
      return executeFn({} as unknown as TArgs);
    });
  }
}
```

In `src/tools/index.ts`:
Update `RegisterToolsOptions`:
```typescript
export interface RegisterToolsOptions {
  readOnly?: boolean;
  tools?: AnyToolDefinition[];
  wrapExecute?: (
    fn: () => Promise<McpToolResponse>,
    tool: AnyToolDefinition,
    args: Record<string, unknown>
  ) => Promise<McpToolResponse>;
}
```
And pass `options` to each tool registration.

- [x] **Step 4: Run test to verify it passes**

Run: `bun test tests/tools.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/tools/common.ts src/tools/index.ts tests/tools.test.ts
git commit -m "feat(tools): add execution wrapper support to tool registration"
```

---

### Task 2: Server Factory Implementation (`src/server.ts`)

**Files:**
- Create: `src/server.ts`
- Create: `tests/mcp-server.test.ts`

**Interfaces:**
- Consumes: `src/config/index.ts`, `src/client/api-client.ts`, `src/context.ts`, `src/tools/index.ts`, `@modelcontextprotocol/sdk`
- Produces:
  - `OpenProjectMcpServer`: `{ server: McpServer; client: OpenProjectClient; start: (transport?: Transport) => Promise<void>; stop: () => Promise<void> }`
  - `createServer(config: AppConfig): OpenProjectMcpServer`

- [x] **Step 1: Write failing tests for server factory**

In `tests/mcp-server.test.ts`:
```typescript
import { describe, expect, test } from "bun:test";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { createServer } from "../src/server";

describe("MCP Server Factory", () => {
  test("creates server and lists all 10 tools via InMemoryTransport", async () => {
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
    expect(toolsResult.tools).toHaveLength(10);
    const names = toolsResult.tools.map((t) => t.name);
    expect(names).toContain("openproject_list_projects");
    expect(names).toContain("openproject_get_work_package");

    await client.close();
    await mcpServer.stop();
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `bun test tests/mcp-server.test.ts`
Expected: FAIL with module `../src/server` not found.

- [x] **Step 3: Implement `src/server.ts`**

In `src/server.ts`:
```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { AppConfig } from "./config";
import { OpenProjectClient } from "./client/api-client";
import { runWithContext } from "./context";
import { registerAllTools } from "./tools";
import { formatToolError } from "./tools/common";
import { OpenProjectError } from "./client/errors";

export interface OpenProjectMcpServer {
  server: McpServer;
  client: OpenProjectClient;
  start: (transport?: Transport) => Promise<void>;
  stop: () => Promise<void>;
}

export const SERVER_NAME = "openproject-mcp";
export const SERVER_VERSION = "0.1.0";

export function createServer(config: AppConfig): OpenProjectMcpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  const client = new OpenProjectClient({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
  });

  // Register all tools with ambient context execution and read-only guards
  registerAllTools(server, {
    readOnly: config.readOnly,
    wrapExecute: async (fn, tool) => {
      if (config.readOnly && !tool.readOnly) {
        return formatToolError(
          new OpenProjectError(
            "SERVER_READ_ONLY",
            "Operation rejected. OpenProject MCP server is running in read-only mode."
          )
        );
      }
      return runWithContext({ client, isReadOnly: config.readOnly }, fn);
    },
  });

  return {
    server,
    client,
    start: async (transport?: Transport) => {
      const activeTransport = transport ?? new StdioServerTransport();
      await server.connect(activeTransport);
      console.error(`[${SERVER_NAME}] Server started (readOnly=${config.readOnly})`);
    },
    stop: async () => {
      await server.close();
      console.error(`[${SERVER_NAME}] Server stopped`);
    },
  };
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `bun test tests/mcp-server.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/server.ts tests/mcp-server.test.ts
git commit -m "feat(server): implement MCP server factory and transport lifecycle"
```

---

### Task 3: Read-Only Mode Enforcement & Guard Tests

**Files:**
- Create: `tests/read-only.test.ts`

**Interfaces:**
- Consumes: `src/server.ts`, `src/config/index.ts`, `src/tools/common.ts`, `@modelcontextprotocol/sdk`
- Produces: Complete verification of manifest filtering and execution guards under read-only mode.

- [x] **Step 1: Write read-only mode verification tests**

In `tests/read-only.test.ts`:
```typescript
import { describe, expect, test } from "bun:test";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { createServer } from "../src/server";
import { parseConfig } from "../src/config";
import type { ToolDefinition } from "../src/tools/common";
import { allTools } from "../src/tools";

describe("Read-Only Mode Enforcement", () => {
  test("parseConfig parses read-only flags from env and argv", () => {
    const configEnv = parseConfig({
      OPENPROJECT_BASE_URL: "http://localhost:8080",
      OPENPROJECT_API_KEY: "key",
      OPENPROJECT_READ_ONLY: "true",
    }, []);
    expect(configEnv.readOnly).toBe(true);

    const configArg = parseConfig({
      OPENPROJECT_BASE_URL: "http://localhost:8080",
      OPENPROJECT_API_KEY: "key",
    }, ["--read-only"]);
    expect(configArg.readOnly).toBe(true);
  });

  test("read-only server lists all 10 Phase 1 tools (all are readOnly: true)", async () => {
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
    expect(toolsResult.tools).toHaveLength(10);

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

    const mcpServer = createServer({
      baseUrl: "http://localhost:8080",
      apiKey: "test-key",
      readOnly: true,
    });

    // Manually register a mutating tool through the server to test filtering
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await mcpServer.start(serverTransport);

    const client = new Client({ name: "client", version: "1" });
    await client.connect(clientTransport);

    const toolsResult = await client.listTools();
    const names = toolsResult.tools.map((t) => t.name);
    expect(names).not.toContain("openproject_create_work_package_synthetic");

    await client.close();
    await mcpServer.stop();
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
    const { registerTool } = await import("../src/tools/common");
    registerTool(mcpServer.server, syntheticMutatingTool, {
      wrapExecute: async (fn, tool) => {
        if (true && !tool.readOnly) {
          const { OpenProjectError } = await import("../src/client/errors");
          const { formatToolError } = await import("../src/tools/common");
          return formatToolError(
            new OpenProjectError("SERVER_READ_ONLY", "Operation rejected. OpenProject MCP server is running in read-only mode.")
          );
        }
        return fn();
      },
    });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await mcpServer.start(serverTransport);

    const client = new Client({ name: "client", version: "1" });
    await client.connect(clientTransport);

    const callRes = await client.callTool({
      name: "openproject_synthetic_write",
      arguments: {},
    });

    expect(callRes.isError).toBe(true);
    expect((callRes.content[0] as { text: string }).text).toContain("SERVER_READ_ONLY");
    expect(executionAttempted).toBe(false);

    await client.close();
    await mcpServer.stop();
  });
});
```

- [x] **Step 2: Run tests to verify they pass**

Run: `bun test tests/read-only.test.ts`
Expected: PASS (4 pass).

- [x] **Step 3: Commit**

```bash
git add tests/read-only.test.ts
git commit -m "feat(server): add read-only mode enforcement and execution guard tests"
```

---

### Task 4: CLI Entrypoint, End-to-End Live Tool Calling & TODO Checkoff

**Files:**
- Modify: `src/index.ts`
- Modify: `tests/mcp-server.test.ts`
- Modify: `docs/TODO.md`

**Interfaces:**
- Consumes: `src/server.ts`, `src/config/index.ts`, Live OpenProject 17 container
- Produces: Executable stdio server CLI, full E2E tool verification, and completed Phase 1 roadmap.

- [ ] **Step 1: Add live container E2E tool calling tests to `tests/mcp-server.test.ts`**

In `tests/mcp-server.test.ts`:
```typescript
describe("End-to-End Live Tool Calling over MCP Client", () => {
  const baseUrl = process.env.OPENPROJECT_BASE_URL || "http://localhost:8080";
  const apiKey = process.env.OPENPROJECT_API_KEY || "";

  test("calls openproject_list_projects and openproject_get_work_package via Client", async () => {
    const mcpServer = createServer({ baseUrl, apiKey, readOnly: false });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await mcpServer.start(serverTransport);

    const client = new Client({ name: "test-runner", version: "1" });
    await client.connect(clientTransport);

    // Call openproject_list_projects
    const projRes = await client.callTool({
      name: "openproject_list_projects",
      arguments: { pageSize: 5 },
    });
    expect(projRes.isError).toBeUndefined();
    const projData = JSON.parse((projRes.content[0] as { text: string }).text);
    expect(projData.projects.length).toBeGreaterThan(0);

    // Call openproject_get_work_package
    const wpRes = await client.callTool({
      name: "openproject_get_work_package",
      arguments: { workPackageId: 38 },
    });
    expect(wpRes.isError).toBeUndefined();
    const wpData = JSON.parse((wpRes.content[0] as { text: string }).text);
    expect(wpData.id).toBe(38);

    await client.close();
    await mcpServer.stop();
  });

  test("tool error propagation returns isError: true without crashing client", async () => {
    const mcpServer = createServer({ baseUrl, apiKey, readOnly: false });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await mcpServer.start(serverTransport);

    const client = new Client({ name: "test-runner", version: "1" });
    await client.connect(clientTransport);

    const errRes = await client.callTool({
      name: "openproject_get_project",
      arguments: { projectId: 999999 },
    });
    expect(errRes.isError).toBe(true);
    expect((errRes.content[0] as { text: string }).text).toContain("OPENPROJECT_NOT_FOUND");

    await client.close();
    await mcpServer.stop();
  });
});
```

- [ ] **Step 2: Implement production CLI entrypoint in `src/index.ts`**

In `src/index.ts`:
```typescript
#!/usr/bin/env bun
/**
 * openproject-mcp - Model Context Protocol Server for OpenProject
 */

import { parseConfig } from "./config";
import { createServer } from "./server";

async function main(): Promise<void> {
  try {
    const config = parseConfig(process.env, process.argv);
    const mcpServer = createServer(config);

    // Bind graceful termination
    const shutdown = async () => {
      console.error("\n[openproject-mcp] Received termination signal, shutting down...");
      await mcpServer.stop();
      process.exit(0);
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);

    // Start server over stdio transport
    await mcpServer.start();
  } catch (error) {
    console.error("[openproject-mcp] Fatal startup error:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

// Only execute when invoked directly as a script
if (import.meta.main) {
  main();
}

export { createServer } from "./server";
export { SERVER_NAME, SERVER_VERSION } from "./server";
```

- [ ] **Step 3: Run full test suite**

Run: `bun test`
Expected: All tests pass across all 5 test files (`smoke`, `client`, `services`, `tools`, `mcp-server`, `read-only`).

- [ ] **Step 4: Update `docs/TODO.md`**

Mark Task 4 as completed in `docs/TODO.md`.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts tests/mcp-server.test.ts docs/TODO.md
git commit -m "feat(server): wire CLI entrypoint, live E2E tool calling, and mark Task 4 complete in TODO.md"
```
