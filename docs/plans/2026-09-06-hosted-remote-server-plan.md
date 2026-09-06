# Hosted Remote MCP Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a hosted remote MCP server over HTTP/SSE (`Bun.serve`) allowing multiple users to connect from their AI clients (Cursor, Claude Desktop, web agents) with their own OpenProject API keys against a shared hosted OpenProject instance, complete with a `docker-compose.server.yml` deployment file.

**Architecture:** Extend `AppConfig` to support `port` and `host`. When `port` is provided, `src/index.ts` boots an HTTP server (`src/http-server.ts`) via `Bun.serve`. Incoming `GET /sse` connections extract the user's OpenProject API key from `Authorization: Bearer`, `X-OpenProject-Api-Key`, or `?apiKey=`, rejecting missing keys with HTTP 401. Each valid connection establishes an isolated session with its own `OpenProjectClient`, and incoming `POST /messages` JSON-RPC requests execute tools inside `runWithContext`. Provide a `docker-compose.server.yml` file and document client setups in `README.md`.

**Tech Stack:** Bun (v1.3.14), TypeScript, `@modelcontextprotocol/sdk`, Server-Sent Events (SSE), Docker Compose.

**Spec:** `docs/specs/2026-09-06-hosted-remote-server-design.md`

## Global Constraints

- Runtime & Package Manager: Bun (>= 1.2 / 1.3), `bun test` for test execution.
- Strict TypeScript: `strict: true`, `"noUncheckedIndexedAccess": true`, no `any`.
- Multi-Tenant Credential Scoping: User credentials must never be stored in global mutable variables. Each session must use its own `OpenProjectClient` inside `runWithContext`.
- Credential Extraction Precedence:
  1. `Authorization: Bearer <key>`
  2. `X-OpenProject-Api-Key: <key>`
  3. `?apiKey=<key>` query parameter
- Rejection: Missing API keys must return HTTP 401 with JSON error `{ error: "..." }`.
- Backward Compatibility: Default behavior when `PORT` is not set must remain local stdio transport.
- Stream Hygiene: All logging in stdio mode must use `console.error`. In HTTP mode, standard server logging to stderr/console is permitted.

---

### Task 1: Configuration Extension for HTTP/SSE Transport

**Files:**
- Modify: `src/config/index.ts`
- Modify: `tests/client.test.ts` (or add tests in `tests/config.test.ts`)

**Interfaces:**
- Consumes: `process.env`, CLI `process.argv`
- Produces: Updated `AppConfig` interface and `loadConfig()` function supporting `port?: number`, `host?: string`, and optional `apiKey` when `port` is set.

- [x] **Step 1: Write failing tests in `tests/config.test.ts`**

```typescript
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { loadConfig } from "../src/config/index.ts";

describe("Configuration Loader (HTTP & Stdio Support)", () => {
  const originalEnv = { ...process.env };
  const originalArgv = [...process.argv];

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.argv = [...originalArgv.slice(0, 2)];
  });

  afterEach(() => {
    process.env = originalEnv;
    process.argv = originalArgv;
  });

  test("loads stdio configuration when PORT is unset and OPENPROJECT_API_KEY is provided", () => {
    process.env.OPENPROJECT_BASE_URL = "https://openproject.example.com";
    process.env.OPENPROJECT_API_KEY = "test-key";
    delete process.env.PORT;

    const config = loadConfig();
    expect(config.baseUrl).toBe("https://openproject.example.com");
    expect(config.apiKey).toBe("test-key");
    expect(config.readOnly).toBe(false);
    expect(config.port).toBeUndefined();
  });

  test("throws error if OPENPROJECT_API_KEY is missing in stdio mode", () => {
    process.env.OPENPROJECT_BASE_URL = "https://openproject.example.com";
    delete process.env.OPENPROJECT_API_KEY;
    delete process.env.PORT;

    expect(() => loadConfig()).toThrow();
  });

  test("loads HTTP configuration when PORT environment variable is set without API key", () => {
    process.env.OPENPROJECT_BASE_URL = "https://openproject.example.com";
    delete process.env.OPENPROJECT_API_KEY;
    process.env.PORT = "3000";

    const config = loadConfig();
    expect(config.baseUrl).toBe("https://openproject.example.com");
    expect(config.port).toBe(3000);
    expect(config.apiKey).toBeUndefined();
  });

  test("parses --port and --host CLI arguments", () => {
    process.env.OPENPROJECT_BASE_URL = "https://openproject.example.com";
    delete process.env.OPENPROJECT_API_KEY;
    delete process.env.PORT;
    process.argv.push("--port", "8080", "--host", "127.0.0.1", "--read-only");

    const config = loadConfig();
    expect(config.port).toBe(8080);
    expect(config.host).toBe("127.0.0.1");
    expect(config.readOnly).toBe(true);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `bun test tests/config.test.ts`
Expected: FAIL because `port`, `host`, and optional `apiKey` logic are not yet implemented in `src/config/index.ts`.

- [x] **Step 3: Update `src/config/index.ts`**

Update `AppConfig` and `loadConfig` in `src/config/index.ts`:
- Add `port?: number` and `host?: string` to `AppConfig`.
- In `loadConfig`:
  - Check for `--port <number>` in `process.argv` or `process.env.PORT`.
  - Check for `--host <string>` in `process.argv` or `process.env.HOST`.
  - If `port` is defined, `apiKey` is optional (does not throw if missing).
  - If `port` is undefined, require `apiKey` as before.

- [x] **Step 4: Run test to verify it passes**

Run: `bun test tests/config.test.ts`
Expected: PASS (all 4 tests pass).

- [x] **Step 5: Commit**

```bash
git add src/config/index.ts tests/config.test.ts
git commit -m "feat(config): support port and host options for HTTP/SSE transport"
```

---

### Task 2: Hosted HTTP/SSE Server Implementation (`src/http-server.ts`)

**Files:**
- Create: `src/http-server.ts`
- Create: `tests/http-server.test.ts`

**Interfaces:**
- Consumes: `src/config/index.ts` (`AppConfig`), `src/context.ts` (`runWithContext`), `src/client/api-client.ts` (`OpenProjectClient`), `src/tools/index.ts` (`registerAllTools`, `allTools`)
- Produces:
  ```typescript
  export interface HttpServerInstance {
    server: import("bun").Server<unknown>;
    port: number;
    stop(): Promise<void>;
  }

  export function startHttpServer(config: AppConfig): Promise<HttpServerInstance>;
  ```

- [x] **Step 1: Write failing tests in `tests/http-server.test.ts`**

```typescript
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
    const data = (await res.json()) as { status: string; mode: string; openproject: string; readOnly: boolean };
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
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `bun test tests/http-server.test.ts`
Expected: FAIL because `src/http-server.ts` does not exist yet.

- [x] **Step 3: Implement `src/http-server.ts`**

Implement `src/http-server.ts`:
- Parse API key from request:
  - Check `req.headers.get("authorization")` (strip `Bearer `).
  - Check `req.headers.get("x-openproject-api-key")`.
  - Check `url.searchParams.get("apiKey")`.
- Implement endpoints:
  - `/health`: Return JSON status.
  - `/sse`: Validate key -> create session -> return `text/event-stream` with `/messages?sessionId=${sessionId}` endpoint.
  - `/messages`: Validate `sessionId` -> route JSON-RPC message into session handler inside `runWithContext`.
  - Cleanup sessions on client disconnect.
- Export `startHttpServer`.

- [x] **Step 4: Run test to verify it passes**

Run: `bun test tests/http-server.test.ts`
Expected: PASS (all tests pass).

- [x] **Step 5: Commit**

```bash
git add src/http-server.ts tests/http-server.test.ts
git commit -m "feat(http): implement hosted remote MCP server with HTTP/SSE transport"
```

---

### Task 3: CLI Entrypoint, Docker Compose Setup & Documentation

**Files:**
- Modify: `src/index.ts`
- Create: `docker-compose.server.yml`
- Modify: `docs/DECISIONS.md` (add ADR-016)
- Modify: `docs/TODO.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: `src/http-server.ts`, `src/server.ts`, `src/config/index.ts`
- Produces: Unified CLI entrypoint supporting both stdio and HTTP transports, production Docker Compose configuration, and updated documentation.

- [x] **Step 1: Wire `src/index.ts` for dual-transport execution**

In `src/index.ts`:
- Load config via `loadConfig()`.
- If `config.port !== undefined`:
  - Log to stderr: `[openproject-mcp] Starting hosted HTTP server on ${config.host || "0.0.0.0"}:${config.port}...`
  - Await `startHttpServer(config)`.
- Else:
  - Run existing stdio server lifecycle.

- [x] **Step 2: Create `docker-compose.server.yml`**

Create `docker-compose.server.yml`:
```yaml
version: "3.8"

services:
  openproject-mcp:
    image: ghcr.io/stereotypicalcat/openproject-mcp:latest
    container_name: openproject-mcp-hosted
    restart: unless-stopped
    ports:
      - "${HOST_PORT:-3000}:3000"
    environment:
      - OPENPROJECT_BASE_URL=${OPENPROJECT_BASE_URL:-https://openproject.example.com}
      - PORT=3000
      - OPENPROJECT_READ_ONLY=${OPENPROJECT_READ_ONLY:-false}
    healthcheck:
      test: ["CMD-SHELL", "bun -e 'fetch(\"http://localhost:3000/health\").then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))'"]
      interval: 30s
      timeout: 5s
      retries: 3
```

- [x] **Step 3: Record ADR-016 in `docs/DECISIONS.md`**

Record ADR-016 documenting the hosted remote server architecture, credential extraction strategy, and session lifecycle.

- [x] **Step 4: Update `README.md` and `docs/TODO.md`**

In `README.md`:
- Add "Hosted Remote MCP Server (Docker Compose)" section showing how to deploy `docker-compose.server.yml`.
- Add remote MCP client configuration instructions for Cursor and Claude Desktop using the hosted URL (`https://mcp.company.com/sse`) and personal API key.
In `docs/TODO.md`:
- Mark Phase 4 (Remote Transport) completed.

- [x] **Step 5: Run full test suite and type check**

Run:
`bun run typecheck`
`bun test`
Expected: 0 type errors, all tests pass.

- [x] **Step 6: Commit**

```bash
git add src/index.ts docker-compose.server.yml docs/DECISIONS.md docs/TODO.md README.md
git commit -m "feat(server): wire HTTP transport into CLI, add docker-compose.server.yml, and update docs"
```
