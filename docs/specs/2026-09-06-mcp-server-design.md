# Design Specification: MCP Stdio Server Assembly & Integration

**Date**: 2026-09-06
**Status**: Approved
**Scope**: Phase 1 Task 4 - MCP Stdio Server Assembly & Integration

---

## 1. Executive Summary

This specification defines the assembly, transport binding, request lifecycle management, read-only enforcement, and logging safeguards for the `openproject-mcp` stdio server.

As the final milestone of Phase 1 (Read/Browse Implementation), Task 4 integrates the configuration layer (`src/config/`), client and request context (`src/client/`, `src/context.ts`), and MCP tools (`src/tools/`) into an executable Model Context Protocol server communicating over standard input/output (`StdioServerTransport`) using `@modelcontextprotocol/sdk`.

---

## 2. Architecture & Design Principles

### 2.1 Server Factory Pattern (`src/server.ts`)
To ensure testability and separation from process lifecycle concerns, the server is instantiated via a factory function:

```typescript
export interface OpenProjectMcpServer {
  server: McpServer;
  client: OpenProjectClient;
  start: (transport?: Transport) => Promise<void>;
  stop: () => Promise<void>;
}

export function createServer(config: AppConfig): OpenProjectMcpServer;
```

- **Configuration Injection**: Accepts validated `AppConfig` (`baseUrl`, `apiKey`, `readOnly`).
- **Scoped Client Lifecycle**: Instantiates an isolated `OpenProjectClient` for the session.
- **Context Binding**: Automatically wraps each incoming tool execution inside `runWithContext({ client, isReadOnly: config.readOnly }, ...)` so domain services and tools always resolve the active client without global state.
- **Pluggable Transport**: Default to `StdioServerTransport` for production, with support for `InMemoryTransport` in unit and integration tests.

### 2.2 CLI Entrypoint (`src/index.ts`)
The CLI entrypoint:
1. Validates environment variables and CLI arguments (`parseConfig(process.env, process.argv)`).
2. Initializes the server via `createServer(config)`.
3. Binds graceful termination handlers (`SIGINT`, `SIGTERM`).
4. Connects to `StdioServerTransport` and starts listening.

```
+-------------------------------------------------------------+
|                      MCP Client Host                        |
|              (Claude Desktop, Cursor, Antigravity)          |
+-------------------------------------------------------------+
                              |
                     stdio (stdin / stdout)
                              v
+-------------------------------------------------------------+
|               src/index.ts / src/server.ts                  |
|  - Parse AppConfig (OPENPROJECT_BASE_URL, API_KEY, ReadOnly)|
|  - Instantiate McpServer & OpenProjectClient                |
|  - StdioServerTransport                                     |
|  - Execution Wrapper: runWithContextStorage                 |
+-------------------------------------------------------------+
                              |
                              v
+-------------------------------------------------------------+
|                  src/tools/ (10 Tools)                      |
|  - Tool Definitions & Zod Parameter Validation              |
|  - Error Sanitization (formatToolSuccess / formatToolError) |
|  - Read-Only Execution Guard                                |
+-------------------------------------------------------------+
                              |
                              v
+-------------------------------------------------------------+
|                 src/services/ & src/client/                 |
|  - projects, work-packages, queries, metadata               |
|  - Native fetch to OpenProject API v3 (Basic Auth)          |
+-------------------------------------------------------------+
```

### 2.3 Read-Only Mode Enforcement
Per ADR-005 and AGENTS.md requirements:
1. **Tool Manifest Filtering**: When `config.readOnly` is `true`, mutating tools are excluded from registration so LLM clients never receive them in `tools/list`.
2. **Runtime Execution Guard**: In addition to manifest omission, any tool call executed while `isReadOnly` is `true` that attempts a non-read-only action is rejected with error code `SERVER_READ_ONLY`:
   ```json
   {
     "content": [
       {
         "type": "text",
         "text": "Error [SERVER_READ_ONLY]: Operation rejected. OpenProject MCP server is running in read-only mode."
       }
     ],
     "isError": true
   }
   ```
3. **Phase 1 Verification**: All 10 Phase 1 tools are read-only (`readOnly: true`), ensuring 100% availability in read-only mode while providing the enforcement harness for Phase 2 mutations.

### 2.4 Stdio Transport Integrity & Stderr Logging
In Model Context Protocol stdio transport:
- `stdout` is the communication channel for JSON-RPC messages. Any non-JSON text emitted to `stdout` will corrupt the transport and crash the MCP client.
- All diagnostics, banners, startup messages, and errors must be directed to `stderr`.
- `createServer` and `index.ts` ensure all startup logging uses `console.error`.

---

## 3. Interfaces & Contracts

### 3.1 `src/server.ts`
```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { AppConfig } from "./config";
import { OpenProjectClient } from "./client/api-client";

export interface OpenProjectMcpServer {
  server: McpServer;
  client: OpenProjectClient;
  start: (transport?: Transport) => Promise<void>;
  stop: () => Promise<void>;
}

export function createServer(config: AppConfig): OpenProjectMcpServer;
```

### 3.2 Tool Execution Wrapping in `src/tools/common.ts` & `src/tools/index.ts`
Enhance `registerAllTools` and `registerTool` with `wrapExecute`:
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

When `wrapExecute` is supplied:
1. Checks if `isReadOnly && !tool.readOnly`. If so, returns `formatToolError(new OpenProjectError("SERVER_READ_ONLY", "Operation rejected. OpenProject MCP server is running in read-only mode."))`.
2. Executes the tool inside `runWithContext({ client, isReadOnly }, fn)`.

---

## 4. Testing Strategy

1. **End-to-End Server Tests (`tests/mcp-server.test.ts`)**:
   - Verify server initialization with `createServer(config)`.
   - Connect client using `InMemoryTransport.createLinkedPair()`.
   - Verify `client.listTools()` returns all 10 Phase 1 tools.
   - Verify calling tools (`openproject_list_projects`, `openproject_get_work_package`) via `client.callTool()` executes successfully against live OpenProject 17 container.
   - Verify invalid arguments return `isError: true` without throwing unhandled exceptions.
2. **Read-Only Mode Tests (`tests/read-only.test.ts`)**:
   - Verify config parsing with `OPENPROJECT_READ_ONLY=true` and `--read-only`.
   - Verify that all Phase 1 tools remain listed and functional.
   - Verify that a synthetic mutating tool (`readOnly: false`) is omitted from `client.listTools()`.
   - Verify that invoking a mutating tool triggers `SERVER_READ_ONLY` execution guard.
3. **Subprocess Stdio Verification**:
   - Spawn `bun run src/index.ts` as a child process and verify startup banner on `stderr`.
