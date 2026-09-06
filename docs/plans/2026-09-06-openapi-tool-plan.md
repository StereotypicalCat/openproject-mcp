# OpenAPI Introspection Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the `openproject_get_openapi_spec` MCP tool and supporting `OpenApiService` to enable dynamic OpenAPI 3.0 introspection with in-memory caching and token-efficient scoping (summary, path, tag, schema, full).

**Architecture:** A domain service `getOpenApiSpec` fetches `GET /api/v3/openapi.json` using the ambient `OpenProjectClient`, caches the parsed ~1.18 MB document in memory by `baseUrl`, and filters/formats the response into compact JSON structures for LLM consumption. The tool definition in `src/tools/openapi.ts` registers `openproject_get_openapi_spec` with `readOnly: true`, plugged into `allTools`.

**Tech Stack:** Bun (v1.3.14), TypeScript (strict mode), `@modelcontextprotocol/sdk`, `zod`, `bun:test`.

**Spec:** `docs/specs/2026-09-06-openapi-tool-design.md`

## Global Constraints

- Runtime & Package Manager: Bun (>= 1.2 / 1.3), `bun test` for test execution.
- Strict TypeScript: `strict: true`, no `any` (use explicit types or `unknown` with type guards).
- Stateless execution & RequestContext: Resolve client using `resolveClient(client)` from `src/services/helper.ts`.
- In-memory caching: Cache parsed OpenAPI spec keyed by `client.baseUrl`, invalidated only when `refresh: true`.
- Stdio stream hygiene: All diagnostics and lifecycle logs use `console.error` (never `console.log`).
- Read-only compatibility: Tool marked `readOnly: true`, registered in both read-only and read-write modes.

---

### Task 1: OpenAPI Domain Service & In-Memory Caching

**Files:**
- Create: `src/services/openapi.ts`
- Modify: `src/services/index.ts`
- Create: `tests/openapi.test.ts`

**Interfaces:**
- Consumes: `src/services/helper.ts` (`resolveClient`), `src/client/api-client.ts` (`OpenProjectClient`, `OpenProjectNotFoundError`)
- Produces:
  ```typescript
  export interface OpenApiQueryOptions {
    path?: string;
    tag?: string;
    schema?: string;
    full?: boolean;
    refresh?: boolean;
  }

  export interface OpenApiSummary {
    title: string;
    version: string;
    openapi: string;
    totalPaths: number;
    tags: Array<{ name: string; endpointCount: number }>;
    availablePaths: string[];
    instructions: string;
  }

  export async function getOpenApiSpec(
    options?: OpenApiQueryOptions,
    client?: OpenProjectClient
  ): Promise<unknown>;

  export function clearOpenApiCache(): void;
  ```

- [x] **Step 1: Write failing service tests in `tests/openapi.test.ts`**

```typescript
import { describe, expect, test, beforeEach } from "bun:test";
import {
  getOpenApiSpec,
  clearOpenApiCache,
  type OpenApiSummary,
} from "../src/services/openapi";
import { OpenProjectClient } from "../src/client/api-client";
import { OpenProjectNotFoundError } from "../src/client/errors";

describe("OpenApi Service", () => {
  const mockSpec = {
    openapi: "3.0.3",
    info: { title: "OpenProject API V3 (Test)", version: "3" },
    paths: {
      "/api/v3/work_packages": {
        get: {
          summary: "List work packages",
          operationId: "list_work_packages",
          tags: ["Work Packages"],
          parameters: [{ name: "offset", in: "query" }],
          responses: { "200": { description: "OK" } },
        },
        post: {
          summary: "Create work package",
          operationId: "create_work_package",
          tags: ["Work Packages"],
          responses: { "201": { description: "Created" } },
        },
      },
      "/api/v3/projects": {
        get: {
          summary: "List projects",
          operationId: "list_projects",
          tags: ["Projects"],
          responses: { "200": { description: "OK" } },
        },
      },
    },
    components: {
      schemas: {
        WorkPackageModel: {
          type: "object",
          properties: { id: { type: "integer" }, subject: { type: "string" } },
        },
      },
    },
  };

  let getCallCount = 0;
  const mockClient = {
    baseUrl: "http://mock-openproject.local",
    get: async (path: string) => {
      getCallCount++;
      if (path.includes("openapi.json")) {
        return mockSpec;
      }
      throw new Error("Not found");
    },
  } as unknown as OpenProjectClient;

  beforeEach(() => {
    clearOpenApiCache();
    getCallCount = 0;
  });

  test("summary mode returns overview and instructions when no filters passed", async () => {
    const result = (await getOpenApiSpec({}, mockClient)) as OpenApiSummary;
    expect(result.title).toBe("OpenProject API V3 (Test)");
    expect(result.version).toBe("3");
    expect(result.openapi).toBe("3.0.3");
    expect(result.totalPaths).toBe(2);
    expect(result.tags).toHaveLength(2);
    expect(result.tags[0]).toEqual({ name: "Projects", endpointCount: 1 });
    expect(result.tags[1]).toEqual({ name: "Work Packages", endpointCount: 1 });
    expect(result.availablePaths).toContain("/api/v3/work_packages");
    expect(result.instructions).toContain("Call openproject_get_openapi_spec");
  });

  test("caches spec in memory and avoids duplicate HTTP GET calls", async () => {
    await getOpenApiSpec({}, mockClient);
    expect(getCallCount).toBe(1);

    await getOpenApiSpec({}, mockClient);
    expect(getCallCount).toBe(1); // Served from cache

    await getOpenApiSpec({ refresh: true }, mockClient);
    expect(getCallCount).toBe(2); // Evicted and re-fetched
  });

  test("path mode resolves exact and normalized path endpoints", async () => {
    const res1 = (await getOpenApiSpec({ path: "/api/v3/work_packages" }, mockClient)) as {
      path: string;
      operations: Record<string, unknown>;
    };
    expect(res1.path).toBe("/api/v3/work_packages");
    expect(res1.operations.get).toBeDefined();
    expect(res1.operations.post).toBeDefined();

    // Normalization test without /api/v3 prefix
    const res2 = (await getOpenApiSpec({ path: "work_packages" }, mockClient)) as {
      path: string;
      operations: Record<string, unknown>;
    };
    expect(res2.path).toBe("/api/v3/work_packages");
  });

  test("path mode throws OpenProjectNotFoundError when path does not exist", async () => {
    expect(getOpenApiSpec({ path: "/api/v3/nonexistent" }, mockClient)).rejects.toThrow(
      OpenProjectNotFoundError
    );
  });

  test("tag mode filters paths by functional domain tag", async () => {
    const result = (await getOpenApiSpec({ tag: "Work Packages" }, mockClient)) as {
      tag: string;
      totalPaths: number;
      paths: Record<string, unknown>;
    };
    expect(result.tag).toBe("Work Packages");
    expect(result.totalPaths).toBe(1);
    expect(result.paths["/api/v3/work_packages"]).toBeDefined();
    expect(result.paths["/api/v3/projects"]).toBeUndefined();
  });

  test("tag mode throws OpenProjectNotFoundError when tag does not exist", async () => {
    expect(getOpenApiSpec({ tag: "NonExistentTag" }, mockClient)).rejects.toThrow(
      OpenProjectNotFoundError
    );
  });

  test("schema mode extracts component model from components.schemas", async () => {
    const result = (await getOpenApiSpec({ schema: "WorkPackageModel" }, mockClient)) as {
      schemaName: string;
      schema: { type: string; properties: Record<string, unknown> };
    };
    expect(result.schemaName).toBe("WorkPackageModel");
    expect(result.schema.type).toBe("object");
    expect(result.schema.properties.subject).toBeDefined();
  });

  test("schema mode throws OpenProjectNotFoundError when schema does not exist", async () => {
    expect(getOpenApiSpec({ schema: "UnknownModel" }, mockClient)).rejects.toThrow(
      OpenProjectNotFoundError
    );
  });

  test("full mode returns the complete raw specification", async () => {
    const result = (await getOpenApiSpec({ full: true }, mockClient)) as typeof mockSpec;
    expect(result.openapi).toBe("3.0.3");
    expect(result.paths).toBeDefined();
    expect(result.components).toBeDefined();
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `bun test tests/openapi.test.ts`
Expected: FAIL (Cannot find module `../src/services/openapi`).

- [x] **Step 3: Implement `src/services/openapi.ts` and export from `src/services/index.ts`**

In `src/services/openapi.ts`:
```typescript
import type { OpenProjectClient } from "../client/api-client";
import { OpenProjectNotFoundError } from "../client/errors";
import { resolveClient } from "./helper";

export interface OpenApiQueryOptions {
  path?: string;
  tag?: string;
  schema?: string;
  full?: boolean;
  refresh?: boolean;
}

export interface OpenApiSummary {
  title: string;
  version: string;
  openapi: string;
  totalPaths: number;
  tags: Array<{ name: string; endpointCount: number }>;
  availablePaths: string[];
  instructions: string;
}

interface RawOpenApiDoc {
  openapi: string;
  info: { title: string; version: string; description?: string };
  paths: Record<string, Record<string, { tags?: string[]; summary?: string; operationId?: string; [key: string]: unknown }>>;
  components?: {
    schemas?: Record<string, unknown>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

// In-memory cache keyed by baseUrl
const openApiCache = new Map<string, RawOpenApiDoc>();

export function clearOpenApiCache(): void {
  openApiCache.clear();
}

/**
 * Normalizes an API path for flexible querying.
 */
function normalizePath(path: string): string {
  let clean = path.trim();
  if (!clean.startsWith("/")) {
    clean = `/${clean}`;
  }
  if (!clean.startsWith("/api/v3")) {
    clean = `/api/v3${clean}`;
  }
  return clean.toLowerCase();
}

/**
 * Fetches and filters OpenProject OpenAPI 3.0 specification.
 */
export async function getOpenApiSpec(
  options?: OpenApiQueryOptions,
  client?: OpenProjectClient
): Promise<unknown> {
  const activeClient = resolveClient(client);
  const cacheKey = activeClient.baseUrl;

  if (options?.refresh) {
    openApiCache.delete(cacheKey);
  }

  let doc = openApiCache.get(cacheKey);
  if (!doc) {
    doc = await activeClient.get<RawOpenApiDoc>("openapi.json");
    openApiCache.set(cacheKey, doc);
  }

  // 1. Full mode
  if (options?.full) {
    return doc;
  }

  const allPaths = Object.keys(doc.paths || {});

  // 2. Specific path lookup
  if (options?.path) {
    const target = normalizePath(options.path);
    const matchedKey = allPaths.find((p) => p.toLowerCase() === target) ||
      allPaths.find((p) => p.toLowerCase().endsWith(target.replace(/^\/api\/v3/, "")));

    if (!matchedKey || !doc.paths[matchedKey]) {
      const sample = allPaths.slice(0, 10).join(", ");
      throw new OpenProjectNotFoundError(
        `OpenAPI path '${options.path}' not found. Available paths include: ${sample}...`,
        { errorIdentifier: "urn:openproject-org:api:v3:errors:NotFound" }
      );
    }

    return {
      path: matchedKey,
      operations: doc.paths[matchedKey],
    };
  }

  // 3. Tag filtering
  if (options?.tag) {
    const targetTag = options.tag.trim().toLowerCase();
    const matchedPaths: Record<string, unknown> = {};

    for (const [pathKey, methods] of Object.entries(doc.paths || {})) {
      let pathMatched = false;
      for (const op of Object.values(methods)) {
        if (op && Array.isArray(op.tags) && op.tags.some((t: string) => t.toLowerCase() === targetTag)) {
          pathMatched = true;
          break;
        }
      }
      if (pathMatched) {
        matchedPaths[pathKey] = methods;
      }
    }

    const matchedCount = Object.keys(matchedPaths).length;
    if (matchedCount === 0) {
      const availableTags = Array.from(
        new Set(
          Object.values(doc.paths || {}).flatMap((methods) =>
            Object.values(methods).flatMap((op) => (Array.isArray(op?.tags) ? op.tags : []))
          )
        )
      ).sort();
      throw new OpenProjectNotFoundError(
        `OpenAPI tag '${options.tag}' not found. Available tags include: ${availableTags.slice(0, 15).join(", ")}...`,
        { errorIdentifier: "urn:openproject-org:api:v3:errors:NotFound" }
      );
    }

    return {
      tag: options.tag,
      totalPaths: matchedCount,
      paths: matchedPaths,
    };
  }

  // 4. Schema model lookup
  if (options?.schema) {
    const targetSchema = options.schema.trim().toLowerCase();
    const schemas = doc.components?.schemas || {};
    const matchedKey = Object.keys(schemas).find((s) => s.toLowerCase() === targetSchema);

    if (!matchedKey || !schemas[matchedKey]) {
      const availableSchemas = Object.keys(schemas).slice(0, 15).join(", ");
      throw new OpenProjectNotFoundError(
        `OpenAPI schema '${options.schema}' not found in components.schemas. Available schemas include: ${availableSchemas}...`,
        { errorIdentifier: "urn:openproject-org:api:v3:errors:NotFound" }
      );
    }

    return {
      schemaName: matchedKey,
      schema: schemas[matchedKey],
    };
  }

  // 5. Default: Summary Overview
  const tagCounts = new Map<string, number>();
  for (const methods of Object.values(doc.paths || {})) {
    const seenInPath = new Set<string>();
    for (const op of Object.values(methods)) {
      if (op && Array.isArray(op.tags)) {
        for (const t of op.tags) {
          seenInPath.add(t);
        }
      }
    }
    for (const t of seenInPath) {
      tagCounts.set(t, (tagCounts.get(t) || 0) + 1);
    }
  }

  const sortedTags = Array.from(tagCounts.entries())
    .map(([name, endpointCount]) => ({ name, endpointCount }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const summary: OpenApiSummary = {
    title: doc.info?.title || "OpenProject API V3",
    version: doc.info?.version || "3",
    openapi: doc.openapi || "3.0.0",
    totalPaths: allPaths.length,
    tags: sortedTags,
    availablePaths: allPaths,
    instructions:
      "Call openproject_get_openapi_spec with 'path' (e.g. '/api/v3/work_packages'), 'tag' (e.g. 'Work Packages'), or 'schema' (e.g. 'WorkPackageModel') to inspect detailed schemas and operations without requesting the full payload.",
  };

  return summary;
}
```

In `src/services/index.ts`:
Export `getOpenApiSpec`, `clearOpenApiCache`, `OpenApiQueryOptions`, `OpenApiSummary` from `./openapi`.

- [x] **Step 4: Run test to verify it passes**

Run: `bun test tests/openapi.test.ts`
Expected: PASS (9 pass).

- [x] **Step 5: Commit**

```bash
git add src/services/openapi.ts src/services/index.ts tests/openapi.test.ts
git commit -m "feat(services): implement OpenAPI specification service and in-memory caching"
```

---

### Task 2: MCP Tool Definition, Schema & Registration

**Files:**
- Create: `src/tools/openapi.ts`
- Modify: `src/tools/index.ts`
- Modify: `tests/openapi.test.ts`

**Interfaces:**
- Consumes: `src/services/openapi.ts` (`getOpenApiSpec`), `src/tools/common.ts` (`formatToolSuccess`, `formatToolError`, `ToolDefinition`)
- Produces:
  ```typescript
  export const getOpenApiSpecSchema: ZodRawShape;
  export const getOpenApiSpecTool: ToolDefinition;
  export const openApiTools: ToolDefinition[];
  export function registerOpenApiTools(server: McpServer, options?: RegisterToolOptions): void;
  ```

- [x] **Step 1: Add tool tests to `tests/openapi.test.ts`**

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { runWithContext } from "../src/context";
import {
  getOpenApiSpecTool,
  registerOpenApiTools,
} from "../src/tools/openapi";
import { allTools } from "../src/tools";

describe("OpenApi MCP Tool Registration & Execution", () => {
  test("getOpenApiSpecTool is marked readOnly: true and exposes proper schema", () => {
    expect(getOpenApiSpecTool.name).toBe("openproject_get_openapi_spec");
    expect(getOpenApiSpecTool.readOnly).toBe(true);
    expect(getOpenApiSpecTool.parameters).toBeDefined();
  });

  test("executes openproject_get_openapi_spec tool via MCP Client inside RequestContext", async () => {
    const server = new McpServer({ name: "openapi-test", version: "1.0.0" });
    registerOpenApiTools(server);

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    const client = new Client({ name: "client", version: "1.0.0" });
    await client.connect(clientTransport);

    const res = (await runWithContext({ client: mockClient, isReadOnly: true }, async () => {
      return client.callTool({
        name: "openproject_get_openapi_spec",
        arguments: { tag: "Work Packages" },
      });
    })) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    expect(res.isError).toBeFalsy();
    const data = JSON.parse(res.content[0]?.text ?? "{}");
    expect(data.tag).toBe("Work Packages");
    expect(data.totalPaths).toBe(1);

    await client.close();
    await server.close();
  });

  test("allTools includes openproject_get_openapi_spec (total: 11 tools)", () => {
    const toolNames = allTools.map((t) => t.name);
    expect(toolNames).toContain("openproject_get_openapi_spec");
    expect(allTools).toHaveLength(11);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `bun test tests/openapi.test.ts`
Expected: FAIL (Cannot find module `../src/tools/openapi`).

- [x] **Step 3: Implement `src/tools/openapi.ts` and update `src/tools/index.ts`**

In `src/tools/openapi.ts`:
```typescript
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getOpenApiSpec } from "../services/openapi";
import {
  formatToolSuccess,
  formatToolError,
  registerTool,
  type ToolDefinition,
  type RegisterToolOptions,
} from "./common";

export const getOpenApiSpecSchema = {
  path: z
    .string()
    .optional()
    .describe("Specific endpoint path to inspect (e.g. '/api/v3/work_packages' or 'projects')."),
  tag: z
    .string()
    .optional()
    .describe("Tag or category to filter endpoints by (e.g. 'Work Packages', 'Queries', 'Projects')."),
  schema: z
    .string()
    .optional()
    .describe("Component schema model name to inspect (e.g. 'WorkPackageModel')."),
  full: z
    .boolean()
    .optional()
    .default(false)
    .describe("Whether to return the complete raw OpenAPI 3.0 document. Warning: very large (~1.18 MB)."),
  refresh: z
    .boolean()
    .optional()
    .default(false)
    .describe("Whether to bypass the in-memory cache and fetch a fresh specification from the server."),
};

export const getOpenApiSpecTool: ToolDefinition<typeof getOpenApiSpecSchema> = {
  name: "openproject_get_openapi_spec",
  description:
    "Retrieve OpenProject API v3 OpenAPI 3.0 specification (/api/v3/openapi.json) for dynamic endpoint discovery, parameter schemas, and entity models. Supports smart filtering by path, tag, or schema, or returns a token-efficient summary overview when called without parameters.",
  readOnly: true,
  parameters: getOpenApiSpecSchema,
  execute: async (args) => {
    try {
      const data = await getOpenApiSpec(args);
      return formatToolSuccess(data);
    } catch (error) {
      return formatToolError(error);
    }
  },
};

export const openApiTools: ToolDefinition[] = [
  getOpenApiSpecTool as unknown as ToolDefinition,
];

export function registerOpenApiTools(
  server: McpServer,
  options?: RegisterToolOptions
): void {
  for (const tool of openApiTools) {
    registerTool(server, tool, options);
  }
}
```

In `src/tools/index.ts`:
Import `openApiTools` and `registerOpenApiTools` from `./openapi`.
Add `...openApiTools` to `allTools`.
Call `registerOpenApiTools(server, options)` in `registerAllTools`.

- [x] **Step 4: Run test to verify it passes**

Run: `bun test tests/openapi.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/tools/openapi.ts src/tools/index.ts tests/openapi.test.ts
git commit -m "feat(tools): add openproject_get_openapi_spec tool definition and registration"
```

---

### Task 3: Live Container Integration, Suite Regression Updates & Roadmap Checkoff

**Files:**
- Modify: `tests/openapi.test.ts`
- Modify: `tests/tools.test.ts`
- Modify: `tests/read-only.test.ts`
- Modify: `tests/mcp-server.test.ts`
- Modify: `docs/TODO.md`

**Interfaces:**
- Consumes: Live OpenProject 17 container on `http://localhost:8080`, `src/server.ts`, `allTools`
- Produces: Updated test suites expecting 11 tools, end-to-end verified live OpenAPI querying, and updated project tracking.

- [ ] **Step 1: Add live container integration test to `tests/openapi.test.ts`**

```typescript
describe("Live Container OpenAPI Integration", () => {
  const baseUrl = process.env.OPENPROJECT_BASE_URL || "http://localhost:8080";
  const apiKey = process.env.OPENPROJECT_API_KEY || "";

  test("live: getOpenApiSpec returns live OpenProject 17 summary", async () => {
    const liveClient = new OpenProjectClient({ baseUrl, apiKey });
    const summary = (await getOpenApiSpec({}, liveClient)) as OpenApiSummary;

    expect(summary.title).toContain("OpenProject API");
    expect(summary.totalPaths).toBeGreaterThan(200);
    expect(summary.tags.length).toBeGreaterThan(30);
    expect(summary.availablePaths).toContain("/api/v3/work_packages");
  });

  test("live: getOpenApiSpec filters by path /api/v3/work_packages", async () => {
    const liveClient = new OpenProjectClient({ baseUrl, apiKey });
    const result = (await getOpenApiSpec({ path: "/api/v3/work_packages" }, liveClient)) as {
      path: string;
      operations: Record<string, { summary?: string; parameters?: Array<{ name: string }> }>;
    };

    expect(result.path).toBe("/api/v3/work_packages");
    expect(result.operations.get).toBeDefined();
    const paramNames = result.operations.get?.parameters?.map((p) => p.name);
    expect(paramNames).toContain("offset");
    expect(paramNames).toContain("pageSize");
  });
});
```

- [ ] **Step 2: Update tool count expectations in existing tests**

- In `tests/tools.test.ts`:
  - `allTools contains exactly 10 Phase 1 tools` -> update to `allTools contains exactly 11 tools including OpenAPI spec` and `expect(allTools).toHaveLength(11)`.
  - `registerAllTools registers all 10 tools on McpServer` -> update length expectation from 10 to 11.
  - `registerAllTools filters out non-readOnly tools when readOnly is true` -> update length expectation from 10 to 11.
- In `tests/read-only.test.ts`:
  - `read-only server lists all 10 Phase 1 tools` -> update expectation from 10 to 11.
  - `read-only mode filters out mutating tools from tools/list` -> update expectation from 10 to 11.
- In `tests/mcp-server.test.ts`:
  - `read-only mode filters tools and maintains read-only status in context` -> update length expectation from 10 to 11.

- [ ] **Step 3: Run full test suite**

Run: `bun test`
Expected: All tests pass cleanly across all test files (`smoke`, `client`, `services`, `tools`, `mcp-server`, `read-only`, `openapi`).

- [ ] **Step 4: Update `docs/TODO.md`**

Add `openproject_get_openapi_spec` tool under completed roadmap and record OpenAPI tool implementation.

- [ ] **Step 5: Commit**

```bash
git add tests/openapi.test.ts tests/tools.test.ts tests/read-only.test.ts tests/mcp-server.test.ts docs/TODO.md
git commit -m "test(openapi): add live container tests, update tool count assertions, and update TODO.md"
```
