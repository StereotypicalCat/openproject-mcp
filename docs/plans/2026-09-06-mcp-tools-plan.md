# MCP Tool Definitions & Schema Registration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose OpenProject capabilities as 10 Model Context Protocol (MCP) tools with Zod input validation, error sanitization, and server registration.

**Architecture:** Modular tool definitions in `src/tools/` wrapping domain services (`src/services/`), returning standard MCP text content blocks, resolving client via ambient `RequestContext`, and registering on `@modelcontextprotocol/sdk` `McpServer`.

**Tech Stack:** Bun, TypeScript, `@modelcontextprotocol/sdk` (McpServer), Zod, `bun:test`.

**Spec:** [docs/specs/2026-09-06-mcp-tools-design.md](file:///home/user/openproject-mcp/docs/specs/2026-09-06-mcp-tools-design.md)

## Global Constraints
- Bun runtime (>= 1.3), `bun test` for verification.
- Strict TypeScript (`strict: true`), no `any` (use explicit Zod inference or `unknown`).
- Stateless execution: resolve ambient client via `RequestContext` (no global mutable client).
- All tools are read-only (`readOnly: true`).
- Standard MCP tool return format: `{ content: [{ type: "text", text: string }], isError?: boolean }`.
- Plain text responses / no secrets in error messages.

---

### Task 1: Common Tool Utilities & Types

**Files:**
- Create: `src/tools/common.ts`
- Test: `tests/tools.test.ts`

**Interfaces:**
- Consumes: `src/client/errors.ts`, `zod`, `@modelcontextprotocol/sdk/server/mcp.js`
- Produces:
  - `McpToolResponse`: `{ content: Array<{ type: "text"; text: string }>; isError?: boolean }`
  - `formatToolSuccess(data: unknown): McpToolResponse`
  - `formatToolError(error: unknown): McpToolResponse`
  - `ToolDefinition<TShape>` interface: `{ name: string; description: string; schema?: TShape; readOnly: boolean; execute: (args: any) => Promise<McpToolResponse> }`
  - `registerTool(server: McpServer, tool: ToolDefinition<any>): void`

- [x] **Step 1: Write failing tests for common tool utilities**

In `tests/tools.test.ts`:
```typescript
import { describe, expect, test } from "bun:test";
import { formatToolSuccess, formatToolError } from "../src/tools/common";
import { OpenProjectNotFoundError } from "../src/client/errors";

describe("Tool Utilities", () => {
  test("formatToolSuccess formats data into MCP text response", () => {
    const data = { id: 1, name: "Test" };
    const response = formatToolSuccess(data);
    expect(response.isError).toBeUndefined();
    expect(response.content).toHaveLength(1);
    expect(response.content[0].type).toBe("text");
    expect(JSON.parse(response.content[0].text)).toEqual(data);
  });

  test("formatToolError formats error into MCP isError response", () => {
    const error = new OpenProjectNotFoundError("Project 99 not found");
    const response = formatToolError(error);
    expect(response.isError).toBe(true);
    expect(response.content).toHaveLength(1);
    expect(response.content[0].type).toBe("text");
    expect(response.content[0].text).toContain("Project 99 not found");
  });

  test("formatToolError handles non-Error unknown values", () => {
    const response = formatToolError("unexpected failure string");
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toContain("unexpected failure string");
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `bun test tests/tools.test.ts`
Expected: FAIL with module `../src/tools/common` not found.

- [x] **Step 3: Implement minimal code for common tool utilities**

In `src/tools/common.ts`:
```typescript
import type { ZodRawShape } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { OpenProjectError } from "../client/errors";

export interface McpToolResponse {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

export function formatToolSuccess(data: unknown): McpToolResponse {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

export function formatToolError(error: unknown): McpToolResponse {
  let message: string;

  if (error instanceof OpenProjectError) {
    message = `Error [${error.code}]: ${error.message}`;
  } else if (error instanceof Error) {
    message = `Error: ${error.message}`;
  } else {
    message = `Error: ${String(error)}`;
  }

  return {
    content: [
      {
        type: "text",
        text: message,
      },
    ],
    isError: true,
  };
}

export interface ToolDefinition<TShape extends ZodRawShape = ZodRawShape> {
  name: string;
  description: string;
  parameters?: TShape;
  readOnly: boolean;
  execute: (args: any) => Promise<McpToolResponse>;
}

export function registerTool(server: McpServer, tool: ToolDefinition<any>): void {
  if (tool.parameters) {
    server.tool(tool.name, tool.description, tool.parameters, async (args: any) => {
      return tool.execute(args);
    });
  } else {
    server.tool(tool.name, tool.description, async () => {
      return tool.execute({});
    });
  }
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `bun test tests/tools.test.ts`
Expected: PASS (3 pass).

- [x] **Step 5: Commit**

```bash
git add src/tools/common.ts tests/tools.test.ts
git commit -m "feat(tools): add common tool utilities, types, and error formatting"
```

---

### Task 2: Project Tools

**Files:**
- Create: `src/tools/projects.ts`
- Modify: `tests/tools.test.ts`

**Interfaces:**
- Consumes: `src/tools/common.ts`, `src/services/projects.ts`, `zod`
- Produces:
  - `listProjectsShape`: ZodRawShape for `openproject_list_projects`
  - `handleListProjects(args)`: handler returning `Promise<McpToolResponse>`
  - `getProjectShape`: ZodRawShape for `openproject_get_project`
  - `handleGetProject(args)`: handler returning `Promise<McpToolResponse>`
  - `listProjectsTool`: ToolDefinition
  - `getProjectTool`: ToolDefinition
  - `projectTools`: ToolDefinition[]
  - `registerProjectTools(server: McpServer): void`

- [x] **Step 1: Write failing tests for project tools**

In `tests/tools.test.ts`:
```typescript
import {
  listProjectsShape,
  handleListProjects,
  getProjectShape,
  handleGetProject,
  projectTools,
  registerProjectTools,
} from "../src/tools/projects";
import { runWithContext } from "../src/context";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

describe("Project Tools", () => {
  const dummyClient = {
    get: async (path: string, query?: Record<string, any>) => {
      if (path === "/api/v3/projects/4") {
        return {
          id: 4,
          identifier: "mcp-test-project",
          name: "MCP Test Project",
          active: true,
          public: false,
          description: { raw: "Desc", html: "<p>Desc</p>" },
          createdAt: "2026-09-01T00:00:00Z",
          updatedAt: "2026-09-01T00:00:00Z",
          _links: { self: { href: "/api/v3/projects/4" } },
        };
      }
      return {
        _embedded: {
          elements: [
            {
              id: 4,
              identifier: "mcp-test-project",
              name: "MCP Test Project",
              active: true,
              public: false,
              createdAt: "2026-09-01T00:00:00Z",
              updatedAt: "2026-09-01T00:00:00Z",
              _links: { self: { href: "/api/v3/projects/4" } },
            },
          ],
        },
        total: 1,
        pageSize: 20,
        offset: 1,
      };
    },
  } as any;

  test("listProjects validates schema and executes successfully", async () => {
    const schema = z.object(listProjectsShape);
    const parsed = schema.parse({ pageSize: 10, offset: 1 });
    const response = await runWithContext({ client: dummyClient, isReadOnly: false }, () =>
      handleListProjects(parsed)
    );

    expect(response.isError).toBeUndefined();
    const result = JSON.parse(response.content[0].text);
    expect(result.projects).toHaveLength(1);
    expect(result.projects[0].id).toBe(4);
    expect(result.total).toBe(1);
  });

  test("getProject validates schema and retrieves single project", async () => {
    const schema = z.object(getProjectShape);
    const parsed = schema.parse({ projectId: 4 });
    const response = await runWithContext({ client: dummyClient, isReadOnly: false }, () =>
      handleGetProject(parsed)
    );

    expect(response.isError).toBeUndefined();
    const result = JSON.parse(response.content[0].text);
    expect(result.id).toBe(4);
    expect(result.identifier).toBe("mcp-test-project");
  });

  test("getProject catches errors and formats error response", async () => {
    const failingClient = {
      get: async () => {
        throw new Error("Network timeout");
      },
    } as any;

    const response = await runWithContext({ client: failingClient, isReadOnly: false }, () =>
      handleGetProject({ projectId: 999 })
    );

    expect(response.isError).toBe(true);
    expect(response.content[0].text).toContain("Network timeout");
  });

  test("registerProjectTools registers tools on McpServer", () => {
    const server = new McpServer({ name: "test-mcp", version: "1.0.0" });
    registerProjectTools(server);
    expect(projectTools).toHaveLength(2);
    expect(projectTools.map((t) => t.name)).toEqual([
      "openproject_list_projects",
      "openproject_get_project",
    ]);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `bun test tests/tools.test.ts`
Expected: FAIL with module `../src/tools/projects` not found.

- [x] **Step 3: Implement project tools**

In `src/tools/projects.ts`:
```typescript
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { formatToolSuccess, formatToolError, registerTool, type McpToolResponse, type ToolDefinition } from "./common";
import { listProjects, getProject } from "../services/projects";

export const listProjectsShape = {
  pageSize: z.number().int().positive().max(100).optional().describe("Number of projects to return per page (max 100, default 20)"),
  offset: z.number().int().positive().optional().describe("Page number to retrieve (1-based, default 1)"),
  sortBy: z.string().optional().describe("Sorting criteria (e.g. 'name:asc', 'id:desc')"),
  filters: z.string().optional().describe("Optional raw OpenProject JSON filters string"),
};

export async function handleListProjects(args: z.infer<z.ZodObject<typeof listProjectsShape>>): Promise<McpToolResponse> {
  try {
    const result = await listProjects(args);
    return formatToolSuccess(result);
  } catch (error) {
    return formatToolError(error);
  }
}

export const getProjectShape = {
  projectId: z.union([z.number().int().positive(), z.string()]).describe("Numeric project ID or string identifier/slug"),
};

export async function handleGetProject(args: z.infer<z.ZodObject<typeof getProjectShape>>): Promise<McpToolResponse> {
  try {
    const result = await getProject(args.projectId);
    return formatToolSuccess(result);
  } catch (error) {
    return formatToolError(error);
  }
}

export const listProjectsTool: ToolDefinition<typeof listProjectsShape> = {
  name: "openproject_list_projects",
  description: "List OpenProject projects accessible to the authenticated user with optional pagination and sorting",
  parameters: listProjectsShape,
  readOnly: true,
  execute: handleListProjects,
};

export const getProjectTool: ToolDefinition<typeof getProjectShape> = {
  name: "openproject_get_project",
  description: "Retrieve detailed information for a single project by its numeric ID or string identifier (slug)",
  parameters: getProjectShape,
  readOnly: true,
  execute: handleGetProject,
};

export const projectTools = [listProjectsTool, getProjectTool];

export function registerProjectTools(server: McpServer): void {
  for (const tool of projectTools) {
    registerTool(server, tool);
  }
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `bun test tests/tools.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/tools/projects.ts tests/tools.test.ts
git commit -m "feat(tools): implement project tools and registration"
```

---

### Task 3: Work Package Tools

**Files:**
- Create: `src/tools/work-packages.ts`
- Modify: `tests/tools.test.ts`

**Interfaces:**
- Consumes: `src/tools/common.ts`, `src/services/work-packages.ts`, `zod`
- Produces:
  - `listWorkPackagesShape`: ZodRawShape for `openproject_list_work_packages`
  - `handleListWorkPackages(args)`: handler returning `Promise<McpToolResponse>`
  - `getWorkPackageShape`: ZodRawShape for `openproject_get_work_package`
  - `handleGetWorkPackage(args)`: handler returning `Promise<McpToolResponse>`
  - `listWorkPackagesTool`: ToolDefinition
  - `getWorkPackageTool`: ToolDefinition
  - `workPackageTools`: ToolDefinition[]
  - `registerWorkPackageTools(server: McpServer): void`

- [x] **Step 1: Write failing tests for work package tools**

In `tests/tools.test.ts`:
```typescript
import {
  listWorkPackagesShape,
  handleListWorkPackages,
  getWorkPackageShape,
  handleGetWorkPackage,
  workPackageTools,
  registerWorkPackageTools,
} from "../src/tools/work-packages";

describe("Work Package Tools", () => {
  const dummyClient = {
    get: async (path: string) => {
      if (path === "/api/v3/work_packages/38") {
        return {
          id: 38,
          subject: "Seed Task 1",
          description: { raw: "Desc" },
          startDate: "2026-09-01",
          dueDate: "2026-09-10",
          estimatedTime: "PT8H",
          percentageDone: 0,
          createdAt: "2026-09-01T00:00:00Z",
          updatedAt: "2026-09-01T00:00:00Z",
          _links: {
            self: { href: "/api/v3/work_packages/38" },
            project: { href: "/api/v3/projects/4", title: "MCP Test Project" },
            type: { href: "/api/v3/types/1", title: "Task" },
            status: { href: "/api/v3/statuses/1", title: "New" },
          },
        };
      }
      return {
        _embedded: {
          elements: [
            {
              id: 38,
              subject: "Seed Task 1",
              _links: {
                self: { href: "/api/v3/work_packages/38" },
                project: { href: "/api/v3/projects/4", title: "MCP Test Project" },
                type: { href: "/api/v3/types/1", title: "Task" },
                status: { href: "/api/v3/statuses/1", title: "New" },
              },
            },
          ],
        },
        total: 1,
        pageSize: 20,
        offset: 1,
      };
    },
  } as any;

  test("listWorkPackages parses parameters and returns normalized list", async () => {
    const schema = z.object(listWorkPackagesShape);
    const parsed = schema.parse({ projectId: 4, status: "open" });
    const response = await runWithContext({ client: dummyClient, isReadOnly: false }, () =>
      handleListWorkPackages(parsed)
    );

    expect(response.isError).toBeUndefined();
    const result = JSON.parse(response.content[0].text);
    expect(result.workPackages).toHaveLength(1);
    expect(result.workPackages[0].id).toBe(38);
    expect(result.workPackages[0].subject).toBe("Seed Task 1");
  });

  test("getWorkPackage parses numeric ID and returns details", async () => {
    const schema = z.object(getWorkPackageShape);
    const parsed = schema.parse({ workPackageId: 38 });
    const response = await runWithContext({ client: dummyClient, isReadOnly: false }, () =>
      handleGetWorkPackage(parsed)
    );

    expect(response.isError).toBeUndefined();
    const result = JSON.parse(response.content[0].text);
    expect(result.id).toBe(38);
    expect(result.subject).toBe("Seed Task 1");
    expect(result.project?.title).toBe("MCP Test Project");
  });

  test("registerWorkPackageTools registers tools on McpServer", () => {
    const server = new McpServer({ name: "test-mcp", version: "1.0.0" });
    registerWorkPackageTools(server);
    expect(workPackageTools).toHaveLength(2);
    expect(workPackageTools.map((t) => t.name)).toEqual([
      "openproject_list_work_packages",
      "openproject_get_work_package",
    ]);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `bun test tests/tools.test.ts`
Expected: FAIL with module `../src/tools/work-packages` not found.

- [x] **Step 3: Implement work package tools**

In `src/tools/work-packages.ts`:
```typescript
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { formatToolSuccess, formatToolError, registerTool, type McpToolResponse, type ToolDefinition } from "./common";
import { listWorkPackages, getWorkPackage } from "../services/work-packages";

export const listWorkPackagesShape = {
  projectId: z.union([z.number().int().positive(), z.string()]).optional().describe("Scope work packages to a specific project by numeric ID or slug identifier"),
  status: z.union([z.enum(["open", "closed"]), z.number().int().positive()]).optional().describe("Filter by status: 'open', 'closed', or numeric status ID"),
  type: z.number().int().positive().optional().describe("Filter by work package type ID (e.g. 1 for Task, 2 for Milestone)"),
  assigneeId: z.number().int().positive().optional().describe("Filter by assignee user ID"),
  subject: z.string().optional().describe("Filter by substring search in work package subject"),
  pageSize: z.number().int().positive().max(100).optional().describe("Number of items per page (max 100, default 20)"),
  offset: z.number().int().positive().optional().describe("Page number to retrieve (1-based, default 1)"),
  sortBy: z.string().optional().describe("Sorting criteria (e.g. 'id:asc', 'updatedAt:desc')"),
  filters: z.string().optional().describe("Optional raw OpenProject JSON filter string array overriding individual filters"),
};

export async function handleListWorkPackages(args: z.infer<z.ZodObject<typeof listWorkPackagesShape>>): Promise<McpToolResponse> {
  try {
    const result = await listWorkPackages(args);
    return formatToolSuccess(result);
  } catch (error) {
    return formatToolError(error);
  }
}

export const getWorkPackageShape = {
  workPackageId: z.number().int().positive().describe("The numeric ID of the work package"),
};

export async function handleGetWorkPackage(args: z.infer<z.ZodObject<typeof getWorkPackageShape>>): Promise<McpToolResponse> {
  try {
    const result = await getWorkPackage(args.workPackageId);
    return formatToolSuccess(result);
  } catch (error) {
    return formatToolError(error);
  }
}

export const listWorkPackagesTool: ToolDefinition<typeof listWorkPackagesShape> = {
  name: "openproject_list_work_packages",
  description: "Browse and filter work packages (tasks, bugs, milestones, features) across projects or within a specific project",
  parameters: listWorkPackagesShape,
  readOnly: true,
  execute: handleListWorkPackages,
};

export const getWorkPackageTool: ToolDefinition<typeof getWorkPackageShape> = {
  name: "openproject_get_work_package",
  description: "Get full details of a specific work package by its numeric ID, including status, priority, assignee, parent, and child relations",
  parameters: getWorkPackageShape,
  readOnly: true,
  execute: handleGetWorkPackage,
};

export const workPackageTools = [listWorkPackagesTool, getWorkPackageTool];

export function registerWorkPackageTools(server: McpServer): void {
  for (const tool of workPackageTools) {
    registerTool(server, tool);
  }
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `bun test tests/tools.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/tools/work-packages.ts tests/tools.test.ts
git commit -m "feat(tools): implement work package tools and registration"
```

---

### Task 4: Query Tools

**Files:**
- Create: `src/tools/queries.ts`
- Modify: `tests/tools.test.ts`

**Interfaces:**
- Consumes: `src/tools/common.ts`, `src/services/queries.ts`, `zod`
- Produces:
  - `listQueriesShape`: ZodRawShape for `openproject_list_queries`
  - `handleListQueries(args)`: handler returning `Promise<McpToolResponse>`
  - `getQueryShape`: ZodRawShape for `openproject_get_query`
  - `handleGetQuery(args)`: handler returning `Promise<McpToolResponse>`
  - `listQueriesTool`: ToolDefinition
  - `getQueryTool`: ToolDefinition
  - `queryTools`: ToolDefinition[]
  - `registerQueryTools(server: McpServer): void`

- [x] **Step 1: Write failing tests for query tools**

In `tests/tools.test.ts`:
```typescript
import {
  listQueriesShape,
  handleListQueries,
  getQueryShape,
  handleGetQuery,
  queryTools,
  registerQueryTools,
} from "../src/tools/queries";

describe("Query Tools", () => {
  const dummyClient = {
    get: async (path: string) => {
      if (path === "/api/v3/queries/30") {
        return {
          id: 30,
          name: "MCP Active Tasks",
          public: true,
          starred: false,
          createdAt: "2026-09-01T00:00:00Z",
          updatedAt: "2026-09-01T00:00:00Z",
          _links: {
            self: { href: "/api/v3/queries/30" },
            results: { href: "/api/v3/queries/30/results" },
          },
        };
      }
      if (path === "/api/v3/queries/30/results") {
        return {
          _embedded: {
            elements: [
              {
                id: 38,
                subject: "Seed Task 1",
                _links: {
                  self: { href: "/api/v3/work_packages/38" },
                  type: { href: "/api/v3/types/1", title: "Task" },
                  status: { href: "/api/v3/statuses/1", title: "New" },
                },
              },
            ],
          },
          total: 1,
          pageSize: 20,
          offset: 1,
        };
      }
      return {
        _embedded: {
          elements: [
            {
              id: 30,
              name: "MCP Active Tasks",
              public: true,
              starred: false,
              _links: { self: { href: "/api/v3/queries/30" } },
            },
          ],
        },
        total: 1,
        pageSize: 20,
        offset: 1,
      };
    },
  } as any;

  test("listQueries parses parameters and returns normalized query list", async () => {
    const schema = z.object(listQueriesShape);
    const parsed = schema.parse({ projectId: 4 });
    const response = await runWithContext({ client: dummyClient, isReadOnly: false }, () =>
      handleListQueries(parsed)
    );

    expect(response.isError).toBeUndefined();
    const result = JSON.parse(response.content[0].text);
    expect(result.queries).toHaveLength(1);
    expect(result.queries[0].id).toBe(30);
  });

  test("getQuery returns query details along with result work packages", async () => {
    const schema = z.object(getQueryShape);
    const parsed = schema.parse({ queryId: 30 });
    const response = await runWithContext({ client: dummyClient, isReadOnly: false }, () =>
      handleGetQuery(parsed)
    );

    expect(response.isError).toBeUndefined();
    const result = JSON.parse(response.content[0].text);
    expect(result.query.id).toBe(30);
    expect(result.results.workPackages).toHaveLength(1);
    expect(result.results.workPackages[0].id).toBe(38);
  });

  test("registerQueryTools registers tools on McpServer", () => {
    const server = new McpServer({ name: "test-mcp", version: "1.0.0" });
    registerQueryTools(server);
    expect(queryTools).toHaveLength(2);
    expect(queryTools.map((t) => t.name)).toEqual([
      "openproject_list_queries",
      "openproject_get_query",
    ]);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `bun test tests/tools.test.ts`
Expected: FAIL with module `../src/tools/queries` not found.

- [x] **Step 3: Implement query tools**

In `src/tools/queries.ts`:
```typescript
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { formatToolSuccess, formatToolError, registerTool, type McpToolResponse, type ToolDefinition } from "./common";
import { listQueries, getQuery, getQueryResults } from "../services/queries";

export const listQueriesShape = {
  projectId: z.union([z.number().int().positive(), z.string()]).optional().describe("Optional project ID or identifier to scope saved queries"),
  pageSize: z.number().int().positive().max(100).optional().describe("Number of queries to return per page (max 100, default 20)"),
  offset: z.number().int().positive().optional().describe("Page number to retrieve (1-based, default 1)"),
};

export async function handleListQueries(args: z.infer<z.ZodObject<typeof listQueriesShape>>): Promise<McpToolResponse> {
  try {
    const result = await listQueries(args);
    return formatToolSuccess(result);
  } catch (error) {
    return formatToolError(error);
  }
}

export const getQueryShape = {
  queryId: z.number().int().positive().describe("The numeric ID of the saved query"),
  pageSize: z.number().int().positive().max(100).optional().describe("Maximum number of result work packages to return (max 100, default 20)"),
  offset: z.number().int().positive().optional().describe("Page number of results to retrieve (1-based, default 1)"),
};

export async function handleGetQuery(args: z.infer<z.ZodObject<typeof getQueryShape>>): Promise<McpToolResponse> {
  try {
    const query = await getQuery(args.queryId);
    const results = await getQueryResults(args.queryId, {
      pageSize: args.pageSize,
      offset: args.offset,
    });
    return formatToolSuccess({ query, results });
  } catch (error) {
    return formatToolError(error);
  }
}

export const listQueriesTool: ToolDefinition<typeof listQueriesShape> = {
  name: "openproject_list_queries",
  description: "List saved queries (custom views, filter sets) accessible to the user, optionally filtered by project",
  parameters: listQueriesShape,
  readOnly: true,
  execute: handleListQueries,
};

export const getQueryTool: ToolDefinition<typeof getQueryShape> = {
  name: "openproject_get_query",
  description: "Retrieve metadata and work package results for a saved query",
  parameters: getQueryShape,
  readOnly: true,
  execute: handleGetQuery,
};

export const queryTools = [listQueriesTool, getQueryTool];

export function registerQueryTools(server: McpServer): void {
  for (const tool of queryTools) {
    registerTool(server, tool);
  }
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `bun test tests/tools.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/tools/queries.ts tests/tools.test.ts
git commit -m "feat(tools): implement query tools and registration"
```

---

### Task 5: Metadata Tools

**Files:**
- Create: `src/tools/metadata.ts`
- Modify: `tests/tools.test.ts`

**Interfaces:**
- Consumes: `src/tools/common.ts`, `src/services/metadata.ts`, `zod`
- Produces:
  - `listTypesShape`: ZodRawShape for `openproject_list_types`
  - `handleListTypes(args)`: handler returning `Promise<McpToolResponse>`
  - `listStatusesShape`: empty ZodRawShape `{}`
  - `handleListStatuses(args)`: handler returning `Promise<McpToolResponse>`
  - `listPrioritiesShape`: empty ZodRawShape `{}`
  - `handleListPriorities(args)`: handler returning `Promise<McpToolResponse>`
  - `listUsersShape`: ZodRawShape for `openproject_list_users`
  - `handleListUsers(args)`: handler returning `Promise<McpToolResponse>`
  - `metadataTools`: ToolDefinition[]
  - `registerMetadataTools(server: McpServer): void`

- [x] **Step 1: Write failing tests for metadata tools**

In `tests/tools.test.ts`:
```typescript
import {
  listTypesShape,
  handleListTypes,
  listStatusesShape,
  handleListStatuses,
  listPrioritiesShape,
  handleListPriorities,
  listUsersShape,
  handleListUsers,
  metadataTools,
  registerMetadataTools,
} from "../src/tools/metadata";

describe("Metadata Tools", () => {
  const dummyClient = {
    get: async (path: string) => {
      if (path === "/api/v3/types") {
        return {
          _embedded: {
            elements: [
              { id: 1, name: "Task", color: "#1a73e8", isDefault: true, isMilestone: false, _links: { self: { href: "/api/v3/types/1" } } },
            ],
          },
          total: 1,
        };
      }
      if (path === "/api/v3/statuses") {
        return {
          _embedded: {
            elements: [
              { id: 1, name: "New", isClosed: false, isDefault: true, color: "#34a853", _links: { self: { href: "/api/v3/statuses/1" } } },
            ],
          },
          total: 1,
        };
      }
      if (path === "/api/v3/priorities") {
        return {
          _embedded: {
            elements: [
              { id: 1, name: "Normal", isDefault: true, _links: { self: { href: "/api/v3/priorities/1" } } },
            ],
          },
          total: 1,
        };
      }
      if (path === "/api/v3/users") {
        return {
          _embedded: {
            elements: [
              { id: 1, name: "OpenProject Admin", email: "admin@example.com", status: "active", admin: true, _links: { self: { href: "/api/v3/users/1" } } },
            ],
          },
          total: 1,
          pageSize: 20,
          offset: 1,
        };
      }
      return { _embedded: { elements: [] }, total: 0 };
    },
  } as any;

  test("listTypes returns types collection", async () => {
    const response = await runWithContext({ client: dummyClient, isReadOnly: false }, () =>
      handleListTypes({})
    );
    expect(response.isError).toBeUndefined();
    const result = JSON.parse(response.content[0].text);
    expect(result.types).toHaveLength(1);
    expect(result.types[0].name).toBe("Task");
  });

  test("listStatuses returns status items", async () => {
    const response = await runWithContext({ client: dummyClient, isReadOnly: false }, () =>
      handleListStatuses({})
    );
    expect(response.isError).toBeUndefined();
    const result = JSON.parse(response.content[0].text);
    expect(result.statuses).toHaveLength(1);
    expect(result.statuses[0].name).toBe("New");
  });

  test("listPriorities returns priority items", async () => {
    const response = await runWithContext({ client: dummyClient, isReadOnly: false }, () =>
      handleListPriorities({})
    );
    expect(response.isError).toBeUndefined();
    const result = JSON.parse(response.content[0].text);
    expect(result.priorities).toHaveLength(1);
    expect(result.priorities[0].name).toBe("Normal");
  });

  test("listUsers returns paginated user list", async () => {
    const response = await runWithContext({ client: dummyClient, isReadOnly: false }, () =>
      handleListUsers({ pageSize: 10 })
    );
    expect(response.isError).toBeUndefined();
    const result = JSON.parse(response.content[0].text);
    expect(result.users).toHaveLength(1);
    expect(result.users[0].name).toBe("OpenProject Admin");
  });

  test("registerMetadataTools registers all 4 metadata tools", () => {
    const server = new McpServer({ name: "test-mcp", version: "1.0.0" });
    registerMetadataTools(server);
    expect(metadataTools).toHaveLength(4);
    expect(metadataTools.map((t) => t.name)).toEqual([
      "openproject_list_types",
      "openproject_list_statuses",
      "openproject_list_priorities",
      "openproject_list_users",
    ]);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `bun test tests/tools.test.ts`
Expected: FAIL with module `../src/tools/metadata` not found.

- [x] **Step 3: Implement metadata tools**

In `src/tools/metadata.ts`:
```typescript
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { formatToolSuccess, formatToolError, registerTool, type McpToolResponse, type ToolDefinition } from "./common";
import { listTypes, listStatuses, listPriorities, listUsers } from "../services/metadata";

export const listTypesShape = {
  projectId: z.union([z.number().int().positive(), z.string()]).optional().describe("Optional numeric project ID or identifier to scope types"),
};

export async function handleListTypes(args: z.infer<z.ZodObject<typeof listTypesShape>>): Promise<McpToolResponse> {
  try {
    const result = await listTypes(args.projectId);
    return formatToolSuccess(result);
  } catch (error) {
    return formatToolError(error);
  }
}

export const listStatusesShape = {};

export async function handleListStatuses(_args: Record<string, never>): Promise<McpToolResponse> {
  try {
    const result = await listStatuses();
    return formatToolSuccess(result);
  } catch (error) {
    return formatToolError(error);
  }
}

export const listPrioritiesShape = {};

export async function handleListPriorities(_args: Record<string, never>): Promise<McpToolResponse> {
  try {
    const result = await listPriorities();
    return formatToolSuccess(result);
  } catch (error) {
    return formatToolError(error);
  }
}

export const listUsersShape = {
  pageSize: z.number().int().positive().max(100).optional().describe("Number of users to return per page (max 100, default 20)"),
  offset: z.number().int().positive().optional().describe("Page number to retrieve (1-based, default 1)"),
};

export async function handleListUsers(args: z.infer<z.ZodObject<typeof listUsersShape>>): Promise<McpToolResponse> {
  try {
    const result = await listUsers(args);
    return formatToolSuccess(result);
  } catch (error) {
    return formatToolError(error);
  }
}

export const listTypesTool: ToolDefinition<typeof listTypesShape> = {
  name: "openproject_list_types",
  description: "List all available work package types (Task, Bug, Milestone, Feature, etc.), optionally scoped to a project",
  parameters: listTypesShape,
  readOnly: true,
  execute: handleListTypes,
};

export const listStatusesTool: ToolDefinition<typeof listStatusesShape> = {
  name: "openproject_list_statuses",
  description: "List all available work package statuses (New, In Progress, Closed, etc.)",
  parameters: listStatusesShape,
  readOnly: true,
  execute: handleListStatuses,
};

export const listPrioritiesTool: ToolDefinition<typeof listPrioritiesShape> = {
  name: "openproject_list_priorities",
  description: "List all priority levels (Low, Normal, High, Immediate)",
  parameters: listPrioritiesShape,
  readOnly: true,
  execute: handleListPriorities,
};

export const listUsersTool: ToolDefinition<typeof listUsersShape> = {
  name: "openproject_list_users",
  description: "List users in the OpenProject instance with optional pagination",
  parameters: listUsersShape,
  readOnly: true,
  execute: handleListUsers,
};

export const metadataTools = [
  listTypesTool,
  listStatusesTool,
  listPrioritiesTool,
  listUsersTool,
];

export function registerMetadataTools(server: McpServer): void {
  for (const tool of metadataTools) {
    registerTool(server, tool);
  }
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `bun test tests/tools.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/tools/metadata.ts tests/tools.test.ts
git commit -m "feat(tools): implement metadata tools and registration"
```

---

### Task 6: Tool Registry & Barrel Export

**Files:**
- Create: `src/tools/index.ts`
- Modify: `tests/tools.test.ts`

**Interfaces:**
- Consumes: `src/tools/common.ts`, `src/tools/projects.ts`, `src/tools/work-packages.ts`, `src/tools/queries.ts`, `src/tools/metadata.ts`
- Produces:
  - `allTools`: Array of all 10 `ToolDefinition` objects
  - `registerAllTools(server: McpServer, options?: { readOnly?: boolean }): void`
  - Re-exports of all individual tools, shapes, and handlers

- [x] **Step 1: Write failing tests for tool registry**

In `tests/tools.test.ts`:
```typescript
import { allTools, registerAllTools } from "../src/tools/index";

describe("Tool Registry", () => {
  test("allTools contains exactly 10 Phase 1 tools", () => {
    expect(allTools).toHaveLength(10);
    const names = allTools.map((t) => t.name);
    expect(names).toEqual([
      "openproject_list_projects",
      "openproject_get_project",
      "openproject_list_work_packages",
      "openproject_get_work_package",
      "openproject_list_queries",
      "openproject_get_query",
      "openproject_list_types",
      "openproject_list_statuses",
      "openproject_list_priorities",
      "openproject_list_users",
    ]);
  });

  test("all tools in Phase 1 are marked readOnly: true", () => {
    for (const tool of allTools) {
      expect(tool.readOnly).toBe(true);
    }
  });

  test("registerAllTools registers all 10 tools on McpServer", () => {
    const server = new McpServer({ name: "test-mcp", version: "1.0.0" });
    registerAllTools(server);
    // Verified via successful registration without throws
    expect(true).toBe(true);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `bun test tests/tools.test.ts`
Expected: FAIL with module `../src/tools/index` not found.

- [x] **Step 3: Implement tool registry**

In `src/tools/index.ts`:
```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTool, type ToolDefinition } from "./common";
import { projectTools } from "./projects";
import { workPackageTools } from "./work-packages";
import { queryTools } from "./queries";
import { metadataTools } from "./metadata";

export * from "./common";
export * from "./projects";
export * from "./work-packages";
export * from "./queries";
export * from "./metadata";

export const allTools: ToolDefinition<any>[] = [
  ...projectTools,
  ...workPackageTools,
  ...queryTools,
  ...metadataTools,
];

export interface RegisterToolsOptions {
  readOnly?: boolean;
}

export function registerAllTools(server: McpServer, options?: RegisterToolsOptions): void {
  const isReadOnly = options?.readOnly ?? false;

  for (const tool of allTools) {
    // If server is in read-only mode, skip any non-read-only tools
    if (isReadOnly && !tool.readOnly) {
      continue;
    }
    registerTool(server, tool);
  }
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `bun test tests/tools.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/tools/index.ts tests/tools.test.ts
git commit -m "feat(tools): add tool registry and barrel export"
```

---

### Task 7: Live Container Integration & End-to-End Verification

**Files:**
- Modify: `tests/tools.test.ts`
- Modify: `docs/TODO.md`
- [x] **Step 1: Add live integration tests for all 10 tools**

In `tests/tools.test.ts`:
```typescript
import { OpenProjectClient } from "../src/client/api-client";
import {
  handleListProjects,
  handleGetProject,
  handleListWorkPackages,
  handleGetWorkPackage,
  handleListQueries,
  handleGetQuery,
  handleListTypes,
  handleListStatuses,
  handleListPriorities,
  handleListUsers,
} from "../src/tools/index";

describe("Live Container Integration (All 10 MCP Tools)", () => {
  const baseUrl = process.env.OPENPROJECT_BASE_URL || "http://localhost:8080";
  const apiKey = process.env.OPENPROJECT_API_KEY || "";
  const liveClient = new OpenProjectClient({ baseUrl, apiKey });

  test("live: list projects and get project tool execution", async () => {
    await runWithContext({ client: liveClient, isReadOnly: false }, async () => {
      const listRes = await handleListProjects({ pageSize: 5 });
      expect(listRes.isError).toBeUndefined();
      const listData = JSON.parse(listRes.content[0].text);
      expect(listData.projects.length).toBeGreaterThan(0);

      const targetProject = listData.projects.find((p: any) => p.identifier === "mcp-test-project") || listData.projects[0];
      const getRes = await handleGetProject({ projectId: targetProject.id });
      expect(getRes.isError).toBeUndefined();
      const getData = JSON.parse(getRes.content[0].text);
      expect(getData.id).toBe(targetProject.id);
    });
  });

  test("live: list work packages and get work package tool execution", async () => {
    await runWithContext({ client: liveClient, isReadOnly: false }, async () => {
      const listRes = await handleListWorkPackages({ pageSize: 5 });
      expect(listRes.isError).toBeUndefined();
      const listData = JSON.parse(listRes.content[0].text);
      expect(listData.workPackages.length).toBeGreaterThan(0);

      const wpId = listData.workPackages[0].id;
      const getRes = await handleGetWorkPackage({ workPackageId: wpId });
      expect(getRes.isError).toBeUndefined();
      const getData = JSON.parse(getRes.content[0].text);
      expect(getData.id).toBe(wpId);
      expect(getData.subject).toBeDefined();
    });
  });

  test("live: list queries and get query tool execution", async () => {
    await runWithContext({ client: liveClient, isReadOnly: false }, async () => {
      const listRes = await handleListQueries({});
      expect(listRes.isError).toBeUndefined();
      const listData = JSON.parse(listRes.content[0].text);
      expect(listData.queries.length).toBeGreaterThan(0);

      const queryId = listData.queries[0].id;
      const getRes = await handleGetQuery({ queryId });
      expect(getRes.isError).toBeUndefined();
      const getData = JSON.parse(getRes.content[0].text);
      expect(getData.query.id).toBe(queryId);
      expect(getData.results).toBeDefined();
    });
  });

  test("live: metadata tools execution (types, statuses, priorities, users)", async () => {
    await runWithContext({ client: liveClient, isReadOnly: false }, async () => {
      const typesRes = await handleListTypes({});
      expect(typesRes.isError).toBeUndefined();
      const typesData = JSON.parse(typesRes.content[0].text);
      expect(typesData.types.length).toBeGreaterThan(0);

      const statusesRes = await handleListStatuses({});
      expect(statusesRes.isError).toBeUndefined();
      const statusesData = JSON.parse(statusesRes.content[0].text);
      expect(statusesData.statuses.length).toBeGreaterThan(0);

      const prioritiesRes = await handleListPriorities({});
      expect(prioritiesRes.isError).toBeUndefined();
      const prioritiesData = JSON.parse(prioritiesRes.content[0].text);
      expect(prioritiesData.priorities.length).toBeGreaterThan(0);

      const usersRes = await handleListUsers({ pageSize: 5 });
      expect(usersRes.isError).toBeUndefined();
      const usersData = JSON.parse(usersRes.content[0].text);
      expect(usersData.users.length).toBeGreaterThan(0);
    });
  });
});
```

- [x] **Step 2: Run all tests against live container**

Run: `bun test`
Expected: All tests pass (client, smoke, services, tools).

- [x] **Step 3: Update `docs/TODO.md`**

Mark Task 3 as completed in `docs/TODO.md`.

- [x] **Step 4: Commit**

```bash
git add tests/tools.test.ts docs/TODO.md
git commit -m "feat(tools): add live container tests and mark Task 3 complete in TODO.md"
```
