# Domain Services Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the stateless Domain Services layer (`src/services/`) providing projects, work packages, queries, and metadata operations with HAL+JSON normalization and RequestContext client resolution.

**Architecture:** Functional TypeScript modules in `src/services/` with an internal `resolveClient(client?: OpenProjectClient)` fallback to `getRequestContext().client`. Service functions invoke OpenProject REST API v3 endpoints via `OpenProjectClient`, format query parameters using `FilterBuilder` where applicable, and normalize responses via `hal-parser.ts`.

**Tech Stack:** Bun runtime, TypeScript (strict mode), `bun:test` for testing, native `fetch`, OpenProject REST API v3.

**Spec:** [docs/specs/2026-09-05-domain-services-design.md](../specs/2026-09-05-domain-services-design.md)

## Global Constraints
- Target Bun runtime (>= 1.2 / 1.3), using `bun test` and `Bun.file`.
- Zero global mutable state; clients must be resolved via `getRequestContext()` or explicit argument.
- Never log, print, or leak API keys or authorization headers in errors or payloads.
- Strict TypeScript (`noImplicitAny`, strict types, explicit interfaces).
- Domain services must be stateless and free of CLI / MCP transport concerns.

---

### Task 1: Shared Service Helper (`src/services/helper.ts`)

**Files:**
- Create: `src/services/helper.ts`
- Test: `tests/services.test.ts`

**Interfaces:**
- Consumes: `getRequestContext` from `src/context.ts`, `OpenProjectClient` from `src/client/api-client.ts`
- Produces: `resolveClient(client?: OpenProjectClient): OpenProjectClient`

- [x] **Step 1: Write the failing test for client resolution**

In `tests/services.test.ts`:
```typescript
import { describe, expect, test } from "bun:test";
import { resolveClient } from "../src/services/helper.ts";
import { OpenProjectClient } from "../src/client/api-client.ts";
import { runWithContext, type RequestContext } from "../src/context.ts";

describe("Domain Services Helper", () => {
  test("resolveClient returns explicit client if provided", () => {
    const customClient = new OpenProjectClient({
      baseUrl: "http://example.com",
      apiKey: "custom-key",
    });
    const result = resolveClient(customClient);
    expect(result).toBe(customClient);
  });

  test("resolveClient falls back to getRequestContext().client when omitted", () => {
    const ambientClient = new OpenProjectClient({
      baseUrl: "http://example.com",
      apiKey: "ambient-key",
    });
    const context: RequestContext = {
      client: ambientClient,
      isReadOnly: false,
    };

    runWithContext(context, () => {
      const result = resolveClient();
      expect(result).toBe(ambientClient);
    });
  });

  test("resolveClient throws error when called without client and outside context", () => {
    expect(() => resolveClient()).toThrow("No active RequestContext found");
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `bun test tests/services.test.ts`
Expected: FAIL with module not found `../src/services/helper.ts`

- [x] **Step 3: Write minimal implementation**

In `src/services/helper.ts`:
```typescript
/**
 * Shared helper utilities for domain services.
 */

import { getRequestContext } from "../context.ts";
import type { OpenProjectClient } from "../client/api-client.ts";

/**
 * Resolves an OpenProjectClient instance.
 * Prefers an explicitly passed client; falls back to the ambient RequestContext.
 */
export function resolveClient(client?: OpenProjectClient): OpenProjectClient {
  return client ?? getRequestContext().client;
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `bun test tests/services.test.ts`
Expected: PASS (3 tests passed)

- [x] **Step 5: Commit**

```bash
git add src/services/helper.ts tests/services.test.ts
git commit -m "feat(services): implement shared client resolution helper"
```

---

### Task 2: Projects Service (`src/services/projects.ts`)

**Files:**
- Create: `src/services/projects.ts`
- Modify: `tests/services.test.ts`

**Interfaces:**
- Consumes:
  - `resolveClient` from `src/services/helper.ts`
  - `OpenProjectClient` from `src/client/api-client.ts`
  - `unpackCollection`, `normalizeProjectSummary`, `normalizeProject` from `src/client/hal-parser.ts`
  - `ProjectSummary`, `ProjectDetail`, `PaginatedResult`, `FilterElement` from `src/client/types.ts`
- Produces:
  - `listProjects(params?: ListProjectsParams, client?: OpenProjectClient): Promise<PaginatedResult<ProjectSummary>>`
  - `getProject(idOrIdentifier: number | string, client?: OpenProjectClient): Promise<ProjectDetail>`
  - `getProjectSchema(client?: OpenProjectClient): Promise<Record<string, unknown>>`
  - `ListProjectsParams` interface

- [x] **Step 1: Write failing tests for projects service**

Append to `tests/services.test.ts`:
```typescript
import { listProjects, getProject, getProjectSchema } from "../src/services/projects.ts";

describe("Projects Service", () => {
  const sampleProjectHal = {
    _type: "Project",
    id: 4,
    identifier: "mcp-test-project",
    name: "MCP Test Project",
    active: true,
    public: true,
    description: { format: "markdown", raw: "Dedicated test project" },
    _links: {
      self: { href: "/api/v3/projects/4", title: "MCP Test Project" },
      parent: { href: "/api/v3/projects/1", title: "Parent Project" },
    },
  };

  test("listProjects sends correct parameters and returns paginated ProjectSummary items", async () => {
    let requestedUrl = "";
    const mockFetch = async (input: string | URL | Request) => {
      requestedUrl = String(input);
      return new Response(
        JSON.stringify({
          _type: "Collection",
          total: 1,
          count: 1,
          pageSize: 10,
          offset: 1,
          _embedded: {
            elements: [sampleProjectHal],
          },
        }),
        { headers: { "Content-Type": "application/hal+json" } }
      );
    };

    const client = new OpenProjectClient({
      baseUrl: "http://example.com",
      apiKey: "test-key",
      fetchFn: mockFetch,
    });

    const result = await listProjects({ pageSize: 10, offset: 1, sortBy: '[["name","asc"]]' }, client);

    expect(requestedUrl).toContain("/api/v3/projects");
    expect(requestedUrl).toContain("pageSize=10");
    expect(requestedUrl).toContain("offset=1");
    expect(requestedUrl).toContain("sortBy=");
    expect(result.total).toBe(1);
    expect(result.items[0].id).toBe(4);
    expect(result.items[0].identifier).toBe("mcp-test-project");
    expect(result.items[0].name).toBe("MCP Test Project");
  });

  test("getProject retrieves project detail by id or identifier", async () => {
    let requestedUrl = "";
    const mockFetch = async (input: string | URL | Request) => {
      requestedUrl = String(input);
      return new Response(JSON.stringify(sampleProjectHal), {
        headers: { "Content-Type": "application/hal+json" },
      });
    };

    const client = new OpenProjectClient({
      baseUrl: "http://example.com",
      apiKey: "test-key",
      fetchFn: mockFetch,
    });

    const result = await getProject("mcp-test-project", client);
    expect(requestedUrl).toContain("/api/v3/projects/mcp-test-project");
    expect(result.id).toBe(4);
    expect(result.parentId).toBe(1);
    expect(result.parentName).toBe("Parent Project");
  });

  test("getProjectSchema retrieves project schema definition", async () => {
    const mockFetch = async () => {
      return new Response(JSON.stringify({ _type: "Schema", name: { type: "String" } }), {
        headers: { "Content-Type": "application/json" },
      });
    };

    const client = new OpenProjectClient({
      baseUrl: "http://example.com",
      apiKey: "test-key",
      fetchFn: mockFetch,
    });

    const result = await getProjectSchema(client);
    expect(result._type).toBe("Schema");
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `bun test tests/services.test.ts`
Expected: FAIL with module not found `../src/services/projects.ts`

- [x] **Step 3: Write minimal implementation**

In `src/services/projects.ts`:
```typescript
/**
 * Projects Domain Service.
 */

import type { OpenProjectClient } from "../client/api-client.ts";
import {
  normalizeProject,
  normalizeProjectSummary,
  unpackCollection,
} from "../client/hal-parser.ts";
import type {
  FilterElement,
  HalCollection,
  HalResource,
  PaginatedResult,
  ProjectDetail,
  ProjectSummary,
} from "../client/types.ts";
import { resolveClient } from "./helper.ts";

export interface ListProjectsParams {
  pageSize?: number;
  offset?: number;
  sortBy?: string;
  filters?: FilterElement[];
}

/**
 * Lists projects accessible to the authenticated user.
 */
export async function listProjects(
  params?: ListProjectsParams,
  client?: OpenProjectClient
): Promise<PaginatedResult<ProjectSummary>> {
  const opClient = resolveClient(client);
  const query: Record<string, string | number | boolean | undefined> = {};

  if (params?.pageSize !== undefined) query.pageSize = params.pageSize;
  if (params?.offset !== undefined) query.offset = params.offset;
  if (params?.sortBy !== undefined) query.sortBy = params.sortBy;
  if (params?.filters && params.filters.length > 0) {
    query.filters = JSON.stringify(params.filters);
  }

  const response = await opClient.get<HalCollection<HalResource>>("projects", query);
  return unpackCollection(response, normalizeProjectSummary);
}

/**
 * Retrieves a single project by its numeric ID or string identifier.
 */
export async function getProject(
  idOrIdentifier: number | string,
  client?: OpenProjectClient
): Promise<ProjectDetail> {
  const opClient = resolveClient(client);
  const response = await opClient.get<HalResource>(`projects/${idOrIdentifier}`);
  return normalizeProject(response);
}

/**
 * Retrieves the schema definition for projects.
 */
export async function getProjectSchema(
  client?: OpenProjectClient
): Promise<Record<string, unknown>> {
  const opClient = resolveClient(client);
  return opClient.get<Record<string, unknown>>("projects/schema");
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `bun test tests/services.test.ts`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add src/services/projects.ts tests/services.test.ts
git commit -m "feat(services): implement projects domain service"
```

---

### Task 3: Work Packages Service (`src/services/work-packages.ts`)

**Files:**
- Create: `src/services/work-packages.ts`
- Modify: `tests/services.test.ts`

**Interfaces:**
- Consumes:
  - `resolveClient` from `src/services/helper.ts`
  - `OpenProjectClient` from `src/client/api-client.ts`
  - `buildWorkPackageFilters` from `src/client/filter-builder.ts`
  - `unpackCollection`, `normalizeWorkPackageSummary`, `normalizeWorkPackage` from `src/client/hal-parser.ts`
  - `WorkPackageSummary`, `WorkPackageDetail`, `WorkPackageFilterParams`, `PaginatedResult`, `HalCollection`, `HalResource` from `src/client/types.ts`
- Produces:
  - `listWorkPackages(params?: ListWorkPackagesParams, client?: OpenProjectClient): Promise<PaginatedResult<WorkPackageSummary>>`
  - `getWorkPackage(id: number, client?: OpenProjectClient): Promise<WorkPackageDetail>`
  - `searchWorkPackages(query: string, options?: SearchWorkPackagesOptions, client?: OpenProjectClient): Promise<PaginatedResult<WorkPackageSummary>>`
  - `ListWorkPackagesParams`, `SearchWorkPackagesOptions` interfaces

- [x] **Step 1: Write failing tests for work packages service**

Append to `tests/services.test.ts`:
```typescript
import {
  listWorkPackages,
  getWorkPackage,
  searchWorkPackages,
} from "../src/services/work-packages.ts";

describe("Work Packages Service", () => {
  const sampleWpHal = {
    _type: "WorkPackage",
    id: 38,
    subject: "Implement MCP Server Core Protocol",
    description: { format: "markdown", raw: "Build stdio transport" },
    startDate: "2026-09-01",
    dueDate: "2026-09-10",
    lockVersion: 3,
    _links: {
      self: { href: "/api/v3/work_packages/38", title: "Implement MCP Server Core Protocol" },
      project: { href: "/api/v3/projects/4", title: "MCP Test Project" },
      type: { href: "/api/v3/types/1", title: "Task" },
      status: { href: "/api/v3/statuses/2", title: "In progress" },
      priority: { href: "/api/v3/priorities/8", title: "High" },
      author: { href: "/api/v3/users/1", title: "Admin User" },
      assignee: { href: "/api/v3/users/1", title: "Admin User" },
      parent: { href: "/api/v3/work_packages/30", title: "Epic Parent" },
      children: [
        { href: "/api/v3/work_packages/39", title: "Subtask 1" },
        { href: "/api/v3/work_packages/40", title: "Subtask 2" },
      ],
    },
  };

  test("listWorkPackages applies filter parameters and normalizes collection", async () => {
    let requestedUrl = "";
    const mockFetch = async (input: string | URL | Request) => {
      requestedUrl = String(input);
      return new Response(
        JSON.stringify({
          _type: "Collection",
          total: 1,
          count: 1,
          pageSize: 25,
          offset: 1,
          _embedded: { elements: [sampleWpHal] },
        }),
        { headers: { "Content-Type": "application/hal+json" } }
      );
    };

    const client = new OpenProjectClient({
      baseUrl: "http://example.com",
      apiKey: "test-key",
      fetchFn: mockFetch,
    });

    const result = await listWorkPackages(
      { projectId: 4, status: "open", typeId: 1, pageSize: 25 },
      client
    );

    expect(requestedUrl).toContain("/api/v3/work_packages");
    expect(requestedUrl).toContain("filters=");
    expect(requestedUrl).toContain("pageSize=25");
    expect(result.total).toBe(1);
    expect(result.items[0].id).toBe(38);
    expect(result.items[0].subject).toBe("Implement MCP Server Core Protocol");
    expect(result.items[0].status).toBe("In progress");
    expect(result.items[0].type).toBe("Task");
  });

  test("getWorkPackage returns full details with parent and children", async () => {
    const mockFetch = async () => {
      return new Response(JSON.stringify(sampleWpHal), {
        headers: { "Content-Type": "application/hal+json" },
      });
    };

    const client = new OpenProjectClient({
      baseUrl: "http://example.com",
      apiKey: "test-key",
      fetchFn: mockFetch,
    });

    const wp = await getWorkPackage(38, client);
    expect(wp.id).toBe(38);
    expect(wp.subject).toBe("Implement MCP Server Core Protocol");
    expect(wp.parent?.id).toBe(30);
    expect(wp.parent?.subject).toBe("Epic Parent");
    expect(wp.children?.length).toBe(2);
    expect(wp.children?.[0].id).toBe(39);
    expect(wp.lockVersion).toBe(3);
  });

  test("searchWorkPackages sets subject query filter", async () => {
    let requestedUrl = "";
    const mockFetch = async (input: string | URL | Request) => {
      requestedUrl = String(input);
      return new Response(
        JSON.stringify({
          _type: "Collection",
          total: 1,
          count: 1,
          pageSize: 10,
          offset: 1,
          _embedded: { elements: [sampleWpHal] },
        }),
        { headers: { "Content-Type": "application/hal+json" } }
      );
    };

    const client = new OpenProjectClient({
      baseUrl: "http://example.com",
      apiKey: "test-key",
      fetchFn: mockFetch,
    });

    await searchWorkPackages("MCP Server", { projectId: 4 }, client);
    expect(requestedUrl).toContain("filters=");
    // Filter must include substring operator for subject
    const decodedUrl = decodeURIComponent(requestedUrl);
    expect(decodedUrl).toContain('"subject"');
    expect(decodedUrl).toContain("MCP Server");
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `bun test tests/services.test.ts`
Expected: FAIL with module not found `../src/services/work-packages.ts`

- [x] **Step 3: Write minimal implementation**

In `src/services/work-packages.ts`:
```typescript
/**
 * Work Packages Domain Service.
 */

import type { OpenProjectClient } from "../client/api-client.ts";
import { buildWorkPackageFilters } from "../client/filter-builder.ts";
import {
  normalizeWorkPackage,
  normalizeWorkPackageSummary,
  unpackCollection,
} from "../client/hal-parser.ts";
import type {
  HalCollection,
  HalResource,
  PaginatedResult,
  WorkPackageDetail,
  WorkPackageFilterParams,
  WorkPackageSummary,
} from "../client/types.ts";
import { resolveClient } from "./helper.ts";

export interface ListWorkPackagesParams extends WorkPackageFilterParams {
  pageSize?: number;
  offset?: number;
  sortBy?: string;
}

export interface SearchWorkPackagesOptions {
  projectId?: number | string;
  pageSize?: number;
  offset?: number;
}

/**
 * Lists work packages matching filters and pagination options.
 */
export async function listWorkPackages(
  params?: ListWorkPackagesParams,
  client?: OpenProjectClient
): Promise<PaginatedResult<WorkPackageSummary>> {
  const opClient = resolveClient(client);
  const query: Record<string, string | number | boolean | undefined> = {};

  if (params?.pageSize !== undefined) query.pageSize = params.pageSize;
  if (params?.offset !== undefined) query.offset = params.offset;
  if (params?.sortBy !== undefined) query.sortBy = params.sortBy;

  if (params) {
    const filters = buildWorkPackageFilters(params);
    if (filters.length > 0) {
      query.filters = JSON.stringify(filters);
    }
  }

  const response = await opClient.get<HalCollection<HalResource>>("work_packages", query);
  return unpackCollection(response, normalizeWorkPackageSummary);
}

/**
 * Retrieves details for a specific work package by its numeric ID.
 */
export async function getWorkPackage(
  id: number,
  client?: OpenProjectClient
): Promise<WorkPackageDetail> {
  const opClient = resolveClient(client);
  const response = await opClient.get<HalResource>(`work_packages/${id}`);
  return normalizeWorkPackage(response);
}

/**
 * Convenience helper to search work packages by subject text, optionally within a project.
 */
export async function searchWorkPackages(
  query: string,
  options?: SearchWorkPackagesOptions,
  client?: OpenProjectClient
): Promise<PaginatedResult<WorkPackageSummary>> {
  return listWorkPackages(
    {
      subject: query,
      projectId: options?.projectId,
      pageSize: options?.pageSize,
      offset: options?.offset,
    },
    client
  );
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `bun test tests/services.test.ts`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add src/services/work-packages.ts tests/services.test.ts
git commit -m "feat(services): implement work packages domain service"
```

---

### Task 4: Queries Service (`src/services/queries.ts`)

**Files:**
- Create: `src/services/queries.ts`
- Modify: `tests/services.test.ts`

**Interfaces:**
- Consumes:
  - `resolveClient` from `src/services/helper.ts`
  - `OpenProjectClient` from `src/client/api-client.ts`
  - `unpackCollection`, `normalizeQuerySummary`, `normalizeQuery`, `normalizeWorkPackageSummary` from `src/client/hal-parser.ts`
  - `QuerySummary`, `QueryDetail`, `WorkPackageSummary`, `PaginatedResult`, `HalCollection`, `HalResource` from `src/client/types.ts`
- Produces:
  - `listQueries(params?: ListQueriesParams, client?: OpenProjectClient): Promise<PaginatedResult<QuerySummary>>`
  - `getQuery(id: number, client?: OpenProjectClient): Promise<QueryDetail>`
  - `getQueryResults(id: number, params?: QueryResultsParams, client?: OpenProjectClient): Promise<PaginatedResult<WorkPackageSummary>>`
  - `ListQueriesParams`, `QueryResultsParams` interfaces

- [ ] **Step 1: Write failing tests for queries service**

Append to `tests/services.test.ts`:
```typescript
import { listQueries, getQuery, getQueryResults } from "../src/services/queries.ts";

describe("Queries Service", () => {
  const sampleQueryHal = {
    _type: "Query",
    id: 30,
    name: "MCP Active Tasks",
    public: true,
    starred: false,
    _links: {
      self: { href: "/api/v3/queries/30", title: "MCP Active Tasks" },
      project: { href: "/api/v3/projects/4", title: "MCP Test Project" },
      results: { href: "/api/v3/queries/30/results" },
      columns: [
        { href: "/api/v3/queries/columns/id", title: "ID" },
        { href: "/api/v3/queries/columns/subject", title: "Subject" },
        { href: "/api/v3/queries/columns/status", title: "Status" },
      ],
      sortBy: [
        { href: "/api/v3/queries/sort_bys/id-asc", title: "ID ascending" },
      ],
    },
    filters: [
      {
        _links: {
          operator: { href: "/api/v3/queries/operators/=", title: "is" },
          filter: { href: "/api/v3/queries/filters/status", title: "Status" },
        },
        name: "status",
        values: ["open"],
      },
    ],
  };

  test("listQueries filters by project when provided", async () => {
    let requestedUrl = "";
    const mockFetch = async (input: string | URL | Request) => {
      requestedUrl = String(input);
      return new Response(
        JSON.stringify({
          _type: "Collection",
          total: 1,
          count: 1,
          pageSize: 20,
          offset: 1,
          _embedded: { elements: [sampleQueryHal] },
        }),
        { headers: { "Content-Type": "application/hal+json" } }
      );
    };

    const client = new OpenProjectClient({
      baseUrl: "http://example.com",
      apiKey: "test-key",
      fetchFn: mockFetch,
    });

    const result = await listQueries({ projectId: 4, pageSize: 20 }, client);
    expect(requestedUrl).toContain("/api/v3/queries");
    expect(requestedUrl).toContain("pageSize=20");
    const decodedUrl = decodeURIComponent(requestedUrl);
    expect(decodedUrl).toContain('"project"');
    expect(result.items[0].id).toBe(30);
    expect(result.items[0].name).toBe("MCP Active Tasks");
    expect(result.items[0].projectId).toBe(4);
  });

  test("getQuery returns normalized details with columns and filters", async () => {
    const mockFetch = async () => {
      return new Response(JSON.stringify(sampleQueryHal), {
        headers: { "Content-Type": "application/hal+json" },
      });
    };

    const client = new OpenProjectClient({
      baseUrl: "http://example.com",
      apiKey: "test-key",
      fetchFn: mockFetch,
    });

    const query = await getQuery(30, client);
    expect(query.id).toBe(30);
    expect(query.name).toBe("MCP Active Tasks");
    expect(query.columns).toContain("ID");
    expect(query.columns).toContain("Subject");
    expect(query.sortBy?.[0].attribute).toBe("id");
    expect(query.sortBy?.[0].direction).toBe("asc");
    expect(query.filters?.[0].field).toBe("Status");
    expect(query.resultsHref).toBe("/api/v3/queries/30/results");
  });

  test("getQueryResults fetches work packages produced by saved query", async () => {
    let requestedUrl = "";
    const mockFetch = async (input: string | URL | Request) => {
      requestedUrl = String(input);
      return new Response(
        JSON.stringify({
          _type: "Collection",
          total: 1,
          count: 1,
          pageSize: 10,
          offset: 1,
          _embedded: {
            elements: [
              {
                _type: "WorkPackage",
                id: 38,
                subject: "Implement MCP Server Core Protocol",
                _links: {
                  self: { href: "/api/v3/work_packages/38" },
                  type: { title: "Task" },
                  status: { title: "In progress" },
                },
              },
            ],
          },
        }),
        { headers: { "Content-Type": "application/hal+json" } }
      );
    };

    const client = new OpenProjectClient({
      baseUrl: "http://example.com",
      apiKey: "test-key",
      fetchFn: mockFetch,
    });

    const result = await getQueryResults(30, { pageSize: 10 }, client);
    expect(requestedUrl).toContain("/api/v3/queries/30/results");
    expect(requestedUrl).toContain("pageSize=10");
    expect(result.items[0].id).toBe(38);
    expect(result.items[0].subject).toBe("Implement MCP Server Core Protocol");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/services.test.ts`
Expected: FAIL with module not found `../src/services/queries.ts`

- [ ] **Step 3: Write minimal implementation**

In `src/services/queries.ts`:
```typescript
/**
 * Queries Domain Service.
 */

import type { OpenProjectClient } from "../client/api-client.ts";
import {
  normalizeQuery,
  normalizeQuerySummary,
  normalizeWorkPackageSummary,
  unpackCollection,
} from "../client/hal-parser.ts";
import type {
  HalCollection,
  HalResource,
  PaginatedResult,
  QueryDetail,
  QuerySummary,
  WorkPackageSummary,
} from "../client/types.ts";
import { resolveClient } from "./helper.ts";

export interface ListQueriesParams {
  projectId?: number | string;
  pageSize?: number;
  offset?: number;
}

export interface QueryResultsParams {
  pageSize?: number;
  offset?: number;
}

/**
 * Lists saved queries, optionally filtered by project.
 */
export async function listQueries(
  params?: ListQueriesParams,
  client?: OpenProjectClient
): Promise<PaginatedResult<QuerySummary>> {
  const opClient = resolveClient(client);
  const query: Record<string, string | number | boolean | undefined> = {};

  if (params?.pageSize !== undefined) query.pageSize = params.pageSize;
  if (params?.offset !== undefined) query.offset = params.offset;

  if (params?.projectId !== undefined) {
    query.filters = JSON.stringify([
      { project: { operator: "=", values: [String(params.projectId)] } },
    ]);
  }

  const response = await opClient.get<HalCollection<HalResource>>("queries", query);
  return unpackCollection(response, normalizeQuerySummary);
}

/**
 * Retrieves details and structure of a saved query by its ID.
 */
export async function getQuery(
  id: number,
  client?: OpenProjectClient
): Promise<QueryDetail> {
  const opClient = resolveClient(client);
  const response = await opClient.get<HalResource>(`queries/${id}`);
  return normalizeQuery(response);
}

/**
 * Executes a saved query and returns its resulting work packages.
 */
export async function getQueryResults(
  id: number,
  params?: QueryResultsParams,
  client?: OpenProjectClient
): Promise<PaginatedResult<WorkPackageSummary>> {
  const opClient = resolveClient(client);
  const query: Record<string, string | number | boolean | undefined> = {};

  if (params?.pageSize !== undefined) query.pageSize = params.pageSize;
  if (params?.offset !== undefined) query.offset = params.offset;

  const response = await opClient.get<HalCollection<HalResource>>(
    `queries/${id}/results`,
    query
  );
  return unpackCollection(response, normalizeWorkPackageSummary);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/services.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/queries.ts tests/services.test.ts
git commit -m "feat(services): implement queries domain service"
```

---

### Task 5: Metadata Service (`src/services/metadata.ts`) and Unified Index

**Files:**
- Create: `src/services/metadata.ts`
- Create: `src/services/index.ts`
- Modify: `tests/services.test.ts`

**Interfaces:**
- Consumes:
  - `resolveClient` from `src/services/helper.ts`
  - `OpenProjectClient` from `src/client/api-client.ts`
  - `unpackCollection`, `normalizeStatus`, `normalizeType`, `normalizePriority`, `normalizeUser` from `src/client/hal-parser.ts`
  - `StatusItem`, `TypeItem`, `PriorityItem`, `UserItem`, `PaginatedResult`, `HalCollection`, `HalResource` from `src/client/types.ts`
- Produces:
  - `listStatuses(client?: OpenProjectClient): Promise<StatusItem[]>`
  - `listTypes(params?: ListTypesParams, client?: OpenProjectClient): Promise<TypeItem[]>`
  - `listPriorities(client?: OpenProjectClient): Promise<PriorityItem[]>`
  - `listUsers(params?: ListUsersParams, client?: OpenProjectClient): Promise<PaginatedResult<UserItem>>`
  - `ListTypesParams`, `ListUsersParams` interfaces
  - Barrel exports in `src/services/index.ts`

- [ ] **Step 1: Write failing tests for metadata service**

Append to `tests/services.test.ts`:
```typescript
import {
  listStatuses,
  listTypes,
  listPriorities,
  listUsers,
} from "../src/services/metadata.ts";
import * as domainServices from "../src/services/index.ts";

describe("Metadata Service", () => {
  test("listStatuses retrieves and unpacks status items", async () => {
    const mockFetch = async () => {
      return new Response(
        JSON.stringify({
          _type: "Collection",
          _embedded: {
            elements: [
              { id: 1, name: "New", isClosed: false, isDefault: true },
              { id: 2, name: "Closed", isClosed: true, isDefault: false },
            ],
          },
        }),
        { headers: { "Content-Type": "application/hal+json" } }
      );
    };

    const client = new OpenProjectClient({
      baseUrl: "http://example.com",
      apiKey: "test-key",
      fetchFn: mockFetch,
    });

    const statuses = await listStatuses(client);
    expect(statuses.length).toBe(2);
    expect(statuses[0].name).toBe("New");
    expect(statuses[0].isClosed).toBe(false);
    expect(statuses[1].isClosed).toBe(true);
  });

  test("listTypes scopes to project when projectId is provided", async () => {
    let requestedUrl = "";
    const mockFetch = async (input: string | URL | Request) => {
      requestedUrl = String(input);
      return new Response(
        JSON.stringify({
          _type: "Collection",
          _embedded: {
            elements: [{ id: 1, name: "Task", isMilestone: false }],
          },
        }),
        { headers: { "Content-Type": "application/hal+json" } }
      );
    };

    const client = new OpenProjectClient({
      baseUrl: "http://example.com",
      apiKey: "test-key",
      fetchFn: mockFetch,
    });

    const types = await listTypes({ projectId: 4 }, client);
    expect(requestedUrl).toContain("/api/v3/projects/4/types");
    expect(types[0].name).toBe("Task");
  });

  test("listPriorities retrieves priority items", async () => {
    const mockFetch = async () => {
      return new Response(
        JSON.stringify({
          _type: "Collection",
          _embedded: {
            elements: [{ id: 8, name: "High", isActive: true }],
          },
        }),
        { headers: { "Content-Type": "application/hal+json" } }
      );
    };

    const client = new OpenProjectClient({
      baseUrl: "http://example.com",
      apiKey: "test-key",
      fetchFn: mockFetch,
    });

    const priorities = await listPriorities(client);
    expect(priorities[0].name).toBe("High");
  });

  test("listUsers returns paginated UserItem list", async () => {
    let requestedUrl = "";
    const mockFetch = async (input: string | URL | Request) => {
      requestedUrl = String(input);
      return new Response(
        JSON.stringify({
          _type: "Collection",
          total: 1,
          count: 1,
          pageSize: 25,
          offset: 1,
          _embedded: {
            elements: [{ id: 1, name: "Admin User", login: "admin", admin: true }],
          },
        }),
        { headers: { "Content-Type": "application/hal+json" } }
      );
    };

    const client = new OpenProjectClient({
      baseUrl: "http://example.com",
      apiKey: "test-key",
      fetchFn: mockFetch,
    });

    const users = await listUsers({ pageSize: 25, offset: 1 }, client);
    expect(requestedUrl).toContain("/api/v3/users");
    expect(users.items[0].login).toBe("admin");
    expect(users.items[0].admin).toBe(true);
  });

  test("src/services/index.ts exports all services properly", () => {
    expect(typeof domainServices.listProjects).toBe("function");
    expect(typeof domainServices.getProject).toBe("function");
    expect(typeof domainServices.listWorkPackages).toBe("function");
    expect(typeof domainServices.getWorkPackage).toBe("function");
    expect(typeof domainServices.listQueries).toBe("function");
    expect(typeof domainServices.getQuery).toBe("function");
    expect(typeof domainServices.listStatuses).toBe("function");
    expect(typeof domainServices.listTypes).toBe("function");
    expect(typeof domainServices.listPriorities).toBe("function");
    expect(typeof domainServices.listUsers).toBe("function");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/services.test.ts`
Expected: FAIL with module not found `../src/services/metadata.ts`

- [ ] **Step 3: Write minimal implementation**

In `src/services/metadata.ts`:
```typescript
/**
 * Metadata & Taxonomies Domain Service.
 */

import type { OpenProjectClient } from "../client/api-client.ts";
import {
  normalizePriority,
  normalizeStatus,
  normalizeType,
  normalizeUser,
  unpackCollection,
} from "../client/hal-parser.ts";
import type {
  HalCollection,
  HalResource,
  PaginatedResult,
  PriorityItem,
  StatusItem,
  TypeItem,
  UserItem,
} from "../client/types.ts";
import { resolveClient } from "./helper.ts";

export interface ListTypesParams {
  projectId?: number | string;
}

export interface ListUsersParams {
  pageSize?: number;
  offset?: number;
  status?: string;
}

/**
 * Lists all work package statuses available in the system.
 */
export async function listStatuses(
  client?: OpenProjectClient
): Promise<StatusItem[]> {
  const opClient = resolveClient(client);
  const response = await opClient.get<HalCollection<HalResource>>("statuses");
  const unpacked = unpackCollection(response, normalizeStatus);
  return unpacked.items;
}

/**
 * Lists work package types, optionally filtered to those enabled for a specific project.
 */
export async function listTypes(
  params?: ListTypesParams,
  client?: OpenProjectClient
): Promise<TypeItem[]> {
  const opClient = resolveClient(client);
  const path = params?.projectId !== undefined ? `projects/${params.projectId}/types` : "types";
  const response = await opClient.get<HalCollection<HalResource>>(path);
  const unpacked = unpackCollection(response, normalizeType);
  return unpacked.items;
}

/**
 * Lists issue priority levels configured in the system.
 */
export async function listPriorities(
  client?: OpenProjectClient
): Promise<PriorityItem[]> {
  const opClient = resolveClient(client);
  const response = await opClient.get<HalCollection<HalResource>>("priorities");
  const unpacked = unpackCollection(response, normalizePriority);
  return unpacked.items;
}

/**
 * Lists users in the OpenProject instance with pagination.
 */
export async function listUsers(
  params?: ListUsersParams,
  client?: OpenProjectClient
): Promise<PaginatedResult<UserItem>> {
  const opClient = resolveClient(client);
  const query: Record<string, string | number | boolean | undefined> = {};

  if (params?.pageSize !== undefined) query.pageSize = params.pageSize;
  if (params?.offset !== undefined) query.offset = params.offset;
  if (params?.status !== undefined) query.status = params.status;

  const response = await opClient.get<HalCollection<HalResource>>("users", query);
  return unpackCollection(response, normalizeUser);
}
```

In `src/services/index.ts`:
```typescript
/**
 * Domain Services Barrel Export.
 */

export * from "./helper.ts";
export * from "./projects.ts";
export * from "./work-packages.ts";
export * from "./queries.ts";
export * from "./metadata.ts";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/services.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/metadata.ts src/services/index.ts tests/services.test.ts
git commit -m "feat(services): implement metadata domain service and barrel export"
```

---

### Task 6: Live Container Integration Verification & Documentation Update

**Files:**
- Modify: `tests/services.test.ts`
- Modify: `docs/TODO.md`

**Interfaces:**
- Consumes: All services from `src/services/index.ts`
- Produces: Live validation suite against OpenProject 17 docker container

- [ ] **Step 1: Write live integration test suite**

In `tests/services.test.ts`, add live integration tests that run when local OpenProject container is reachable:
```typescript
describe("Live Container Integration (Domain Services)", () => {
  const liveBaseUrl = process.env.OPENPROJECT_BASE_URL || "http://localhost:8080";
  const liveApiKey = process.env.OPENPROJECT_API_KEY;

  const runLiveTests = liveApiKey ? test : test.skip;

  runLiveTests("live: projects service operations", async () => {
    const client = new OpenProjectClient({ baseUrl: liveBaseUrl, apiKey: liveApiKey! });

    const projects = await domainServices.listProjects({ pageSize: 5 }, client);
    expect(projects.items.length).toBeGreaterThan(0);

    const testProject = await domainServices.getProject("mcp-test-project", client);
    expect(testProject.identifier).toBe("mcp-test-project");
    expect(testProject.id).toBeGreaterThan(0);
  });

  runLiveTests("live: work packages service operations", async () => {
    const client = new OpenProjectClient({ baseUrl: liveBaseUrl, apiKey: liveApiKey! });

    const wps = await domainServices.listWorkPackages({ projectId: "mcp-test-project" }, client);
    expect(wps.items.length).toBeGreaterThan(0);

    const firstWp = await domainServices.getWorkPackage(wps.items[0].id, client);
    expect(firstWp.id).toBe(wps.items[0].id);
    expect(firstWp.subject).toBeDefined();

    const searchRes = await domainServices.searchWorkPackages("MCP", { projectId: "mcp-test-project" }, client);
    expect(searchRes.items.length).toBeGreaterThan(0);
  });

  runLiveTests("live: queries service operations", async () => {
    const client = new OpenProjectClient({ baseUrl: liveBaseUrl, apiKey: liveApiKey! });

    const queries = await domainServices.listQueries({ projectId: "mcp-test-project" }, client);
    expect(queries.items.length).toBeGreaterThan(0);

    const activeQuery = queries.items.find((q) => q.name.includes("MCP Active Tasks"));
    if (activeQuery) {
      const detail = await domainServices.getQuery(activeQuery.id, client);
      expect(detail.id).toBe(activeQuery.id);

      const results = await domainServices.getQueryResults(activeQuery.id, {}, client);
      expect(results.items.length).toBeGreaterThan(0);
    }
  });

  runLiveTests("live: metadata service operations", async () => {
    const client = new OpenProjectClient({ baseUrl: liveBaseUrl, apiKey: liveApiKey! });

    const statuses = await domainServices.listStatuses(client);
    expect(statuses.length).toBeGreaterThan(0);

    const types = await domainServices.listTypes({ projectId: "mcp-test-project" }, client);
    expect(types.length).toBeGreaterThan(0);

    const priorities = await domainServices.listPriorities(client);
    expect(priorities.length).toBeGreaterThan(0);

    const users = await domainServices.listUsers({ pageSize: 5 }, client);
    expect(users.items.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run full test suite to verify all tests pass**

Run: `bun test`
Expected: PASS (All tests in client.test.ts, smoke.test.ts, and services.test.ts pass)

- [ ] **Step 3: Update `docs/TODO.md`**

Update `docs/TODO.md` to mark Task 2 items completed.

- [ ] **Step 4: Commit**

```bash
git add tests/services.test.ts docs/TODO.md
git commit -m "feat(services): add live container tests and mark Task 2 complete in TODO.md"
```
