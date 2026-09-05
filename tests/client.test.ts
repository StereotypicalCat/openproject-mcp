import { describe, expect, test } from "bun:test";
import { parseConfig } from "../src/config/index.ts";
import {
  getRequestContext,
  runWithContext,
  tryGetRequestContext,
  type RequestContext,
} from "../src/context.ts";
import {
  OpenProjectClient,
  OpenProjectAuthenticationError,
  OpenProjectForbiddenError,
  OpenProjectNotFoundError,
  OpenProjectConflictError,
  OpenProjectValidationError,
  OpenProjectRateLimitError,
  OpenProjectServerError,
} from "../src/client/api-client.ts";
import {
  FilterBuilder,
  buildWorkPackageFilters,
  serializeFilters,
} from "../src/client/filter-builder.ts";
import {
  extractIdFromHref,
  resolveLink,
  extractRawText,
  normalizeProjectSummary,
  normalizeProject,
  normalizeWorkPackageSummary,
  normalizeWorkPackage,
  normalizeQuerySummary,
  normalizeQuery,
  normalizeStatus,
  normalizeType,
  normalizePriority,
  normalizeUser,
  unpackCollection,
  unpackHalResource,
} from "../src/client/hal-parser.ts";
import type { HalCollection, HalResource } from "../src/client/types.ts";

// =============================================================================
// 1. Configuration Parsing & Validation
// =============================================================================

describe("Configuration Parser", () => {
  test("parses valid configuration and trims trailing slashes", () => {
    const config = parseConfig(
      {
        OPENPROJECT_BASE_URL: "http://localhost:8080///",
        OPENPROJECT_API_KEY: "valid-test-key-12345",
      },
      []
    );

    expect(config.baseUrl).toBe("http://localhost:8080");
    expect(config.apiKey).toBe("valid-test-key-12345");
    expect(config.readOnly).toBe(false);
  });

  test("enables readOnly mode from env OPENPROJECT_READ_ONLY", () => {
    const config = parseConfig(
      {
        OPENPROJECT_BASE_URL: "http://localhost:8080",
        OPENPROJECT_API_KEY: "secret",
        OPENPROJECT_READ_ONLY: "true",
      },
      []
    );
    expect(config.readOnly).toBe(true);
  });

  test("enables readOnly mode from --read-only argv flag", () => {
    const config = parseConfig(
      {
        OPENPROJECT_BASE_URL: "http://localhost:8080",
        OPENPROJECT_API_KEY: "secret",
      },
      ["node", "index.js", "--read-only"]
    );
    expect(config.readOnly).toBe(true);
  });

  test("throws error when OPENPROJECT_BASE_URL is invalid", () => {
    expect(() =>
      parseConfig({
        OPENPROJECT_BASE_URL: "not-a-valid-url",
        OPENPROJECT_API_KEY: "secret",
      })
    ).toThrow();
  });

  test("throws error when OPENPROJECT_API_KEY is missing or empty", () => {
    expect(() =>
      parseConfig({
        OPENPROJECT_BASE_URL: "http://localhost:8080",
        OPENPROJECT_API_KEY: "",
      })
    ).toThrow();
  });
});

// =============================================================================
// 2. Request Scoping & AsyncLocalStorage
// =============================================================================

describe("RequestContext Scoping", () => {
  test("throws when getRequestContext() is called outside runWithContext", () => {
    expect(() => getRequestContext()).toThrow(/No active RequestContext found/);
    expect(tryGetRequestContext()).toBeUndefined();
  });

  test("provides isolated context inside runWithContext", async () => {
    const clientA = new OpenProjectClient({
      baseUrl: "http://host-a",
      apiKey: "key-a",
    });
    const contextA: RequestContext = {
      client: clientA,
      isReadOnly: false,
      userId: "user-a",
    };

    await runWithContext(contextA, async () => {
      const activeCtx = getRequestContext();
      expect(activeCtx.userId).toBe("user-a");
      expect(activeCtx.client.baseUrl).toBe("http://host-a");
      expect(activeCtx.isReadOnly).toBe(false);
    });
  });

  test("maintains isolated context across concurrent asynchronous tasks", async () => {
    const client1 = new OpenProjectClient({
      baseUrl: "http://localhost:8080",
      apiKey: "key-user-1",
    });
    const client2 = new OpenProjectClient({
      baseUrl: "http://localhost:8080",
      apiKey: "key-user-2",
    });

    const ctx1: RequestContext = { client: client1, isReadOnly: false, userId: "user-1" };
    const ctx2: RequestContext = { client: client2, isReadOnly: true, userId: "user-2" };

    const task1 = runWithContext(ctx1, async () => {
      await new Promise((resolve) => setTimeout(resolve, 15));
      const current = getRequestContext();
      expect(current.userId).toBe("user-1");
      expect(current.isReadOnly).toBe(false);
      return current.userId;
    });

    const task2 = runWithContext(ctx2, async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      const current = getRequestContext();
      expect(current.userId).toBe("user-2");
      expect(current.isReadOnly).toBe(true);
      return current.userId;
    });

    const results = await Promise.all([task1, task2]);
    expect(results).toEqual(["user-1", "user-2"]);
  });
});

// =============================================================================
// 3. Filter Builder
// =============================================================================

describe("FilterBuilder", () => {
  test("builds individual filters correctly", () => {
    const builder = new FilterBuilder();
    builder.project(12).status("open").type(3);

    const filters = builder.build();
    expect(filters).toEqual([
      { project: { operator: "=", values: ["12"] } },
      { status: { operator: "o", values: [] } },
      { type: { operator: "=", values: ["3"] } },
    ]);
  });

  test("handles closed and specific status IDs", () => {
    const builderClosed = new FilterBuilder().status("closed");
    expect(builderClosed.build()).toEqual([
      { status: { operator: "c", values: [] } },
    ]);

    const builderSpecific = new FilterBuilder().status("7");
    expect(builderSpecific.build()).toEqual([
      { status: { operator: "=", values: ["7"] } },
    ]);
  });

  test("builds full query from WorkPackageFilterParams", () => {
    const filters = buildWorkPackageFilters({
      projectId: "mcp-test-project",
      status: "open",
      assigneeId: "me",
      priorityId: 2,
      subject: "bug in auth",
    });

    expect(filters).toEqual([
      { project: { operator: "=", values: ["mcp-test-project"] } },
      { status: { operator: "o", values: [] } },
      { assignee: { operator: "=", values: ["me"] } },
      { priority: { operator: "=", values: ["2"] } },
      { subject: { operator: "~", values: ["bug in auth"] } },
    ]);

    const serialized = serializeFilters(filters);
    expect(typeof serialized).toBe("string");
    expect(JSON.parse(serialized)).toEqual(filters);
  });
});

// =============================================================================
// 4. HAL Parser & Normalizers
// =============================================================================

describe("HAL Normalizer", () => {
  test("extracts numeric IDs from URLs", () => {
    expect(extractIdFromHref("/api/v3/projects/42")).toBe(42);
    expect(extractIdFromHref("/api/v3/work_packages/123/relations")).toBe(123);
    expect(extractIdFromHref(null)).toBeUndefined();
    expect(extractIdFromHref("")).toBeUndefined();
  });

  test("resolves links and text fields", () => {
    const link = { href: "/api/v3/types/5", title: "Bug" };
    expect(resolveLink(link)).toEqual({ id: 5, title: "Bug", href: "/api/v3/types/5" });
    expect(resolveLink(null)).toBeUndefined();

    expect(extractRawText("plain string")).toBe("plain string");
    expect(extractRawText({ raw: "raw markdown", html: "<p>html</p>" })).toBe("raw markdown");
    expect(extractRawText({ html: "<p>html only</p>" })).toBe("<p>html only</p>");
    expect(extractRawText(null)).toBe("");
  });

  test("normalizes Project HAL resource", () => {
    const rawProject: HalResource = {
      _type: "Project",
      id: 4,
      identifier: "test-proj",
      name: "Test Project",
      active: true,
      public: false,
      description: { raw: "Project description", html: "<p>Project description</p>" },
      statusExplanation: { raw: "All green", html: "" },
      _links: {
        self: { href: "/api/v3/projects/4", title: "Test Project" },
        parent: { href: "/api/v3/projects/1", title: "Parent Project" },
        status: { href: "/api/v3/project_statuses/2", title: "ON TRACK" },
      },
    };

    const detail = normalizeProject(rawProject);
    expect(detail.id).toBe(4);
    expect(detail.identifier).toBe("test-proj");
    expect(detail.name).toBe("Test Project");
    expect(detail.active).toBe(true);
    expect(detail.public).toBe(false);
    expect(detail.description).toBe("Project description");
    expect(detail.parentId).toBe(1);
    expect(detail.parentName).toBe("Parent Project");
    expect(detail.status).toBe("ON TRACK");
    expect(detail.statusExplanation).toBe("All green");
  });

  test("normalizes WorkPackage HAL resource", () => {
    const rawWp: HalResource = {
      _type: "WorkPackage",
      id: 55,
      subject: "Fix critical login loop",
      startDate: "2026-09-01",
      dueDate: "2026-09-10",
      lockVersion: 3,
      description: { raw: "Investigation needed." },
      _links: {
        self: { href: "/api/v3/work_packages/55" },
        type: { href: "/api/v3/types/2", title: "Bug" },
        status: { href: "/api/v3/statuses/1", title: "New" },
        priority: { href: "/api/v3/priorities/8", title: "High" },
        project: { href: "/api/v3/projects/4", title: "Test Project" },
        author: { href: "/api/v3/users/1", title: "Admin User" },
        assignee: { href: "/api/v3/users/2", title: "Developer" },
        parent: { href: "/api/v3/work_packages/50", title: "Parent Task" },
        children: [
          { href: "/api/v3/work_packages/56", title: "Subtask 1" },
          { href: "/api/v3/work_packages/57", title: "Subtask 2" },
        ],
      },
    };

    const detail = normalizeWorkPackage(rawWp);
    expect(detail.id).toBe(55);
    expect(detail.subject).toBe("Fix critical login loop");
    expect(detail.type).toBe("Bug");
    expect(detail.typeId).toBe(2);
    expect(detail.status).toBe("New");
    expect(detail.statusId).toBe(1);
    expect(detail.priority).toBe("High");
    expect(detail.priorityId).toBe(8);
    expect(detail.project).toBe("Test Project");
    expect(detail.projectId).toBe(4);
    expect(detail.author).toBe("Admin User");
    expect(detail.authorId).toBe(1);
    expect(detail.assignee).toBe("Developer");
    expect(detail.assigneeId).toBe(2);
    expect(detail.parent).toEqual({ id: 50, subject: "Parent Task" });
    expect(detail.children).toEqual([
      { id: 56, subject: "Subtask 1" },
      { id: 57, subject: "Subtask 2" },
    ]);
    expect(detail.description).toBe("Investigation needed.");
    expect(detail.lockVersion).toBe(3);
  });

  test("normalizes Query, Status, Type, Priority, and User", () => {
    const rawQuery: HalResource = {
      _type: "Query",
      id: 10,
      name: "My Tasks",
      public: true,
      starred: true,
      filters: [
        {
          _links: {
            filter: { title: "Status" },
            operator: { title: "open" },
          },
          values: [],
        },
      ],
      _links: {
        self: { href: "/api/v3/queries/10" },
        project: { href: "/api/v3/projects/4", title: "Test Project" },
        columns: [
          { href: "/api/v3/queries/columns/id", title: "ID" },
          { href: "/api/v3/queries/columns/subject", title: "Subject" },
        ],
        sortBy: [{ href: "/api/v3/queries/sort_bys/id-desc", title: "ID (descending)" }],
      },
    };

    const query = normalizeQuery(rawQuery);
    expect(query.id).toBe(10);
    expect(query.name).toBe("My Tasks");
    expect(query.columns).toEqual(["ID", "Subject"]);
    expect(query.sortBy).toEqual([{ attribute: "id", direction: "desc" }]);
    expect(query.filters).toEqual([{ field: "Status", operator: "open", values: [] }]);

    const status = normalizeStatus({ _type: "Status", id: 1, name: "New", isClosed: false });
    expect(status).toEqual({ id: 1, name: "New", isClosed: false, isDefault: undefined, color: undefined });

    const type = normalizeType({ _type: "Type", id: 2, name: "Bug", isMilestone: false });
    expect(type).toEqual({ id: 2, name: "Bug", isMilestone: false, isDefault: undefined, color: undefined });

    const priority = normalizePriority({ _type: "Priority", id: 8, name: "High", isActive: true });
    expect(priority).toEqual({ id: 8, name: "High", isActive: true, isDefault: undefined, color: undefined });

    const user = normalizeUser({ _type: "User", id: 4, name: "Admin", login: "admin", email: "a@b.com", admin: true });
    expect(user).toEqual({ id: 4, name: "Admin", login: "admin", email: "a@b.com", admin: true, status: undefined });
  });

  test("unpacks collection with pagination metadata", () => {
    const rawCollection: HalCollection = {
      _type: "Collection",
      total: 100,
      count: 2,
      pageSize: 2,
      offset: 1,
      _embedded: {
        elements: [
          { _type: "Status", id: 1, name: "New", isClosed: false },
          { _type: "Status", id: 2, name: "Closed", isClosed: true },
        ],
      },
    };

    const unpacked = unpackCollection(rawCollection, normalizeStatus);
    expect(unpacked.total).toBe(100);
    expect(unpacked.count).toBe(2);
    expect(unpacked.pageSize).toBe(2);
    expect(unpacked.offset).toBe(1);
    expect(unpacked.items.length).toBe(2);
    expect(unpacked.items[0]?.name).toBe("New");
    expect(unpacked.items[1]?.name).toBe("Closed");
  });

  test("unpackHalResource strips noisy operational links", () => {
    const raw: HalResource = {
      _type: "WorkPackage",
      id: 1,
      subject: "Test",
      _links: {
        self: { href: "/api/v3/work_packages/1" },
        update: { href: "/api/v3/work_packages/1/form", method: "post" },
        delete: { href: "/api/v3/work_packages/1", method: "delete" },
        schema: { href: "/api/v3/work_packages/schemas/1" },
        project: { href: "/api/v3/projects/4", title: "Project 4" },
      },
    };

    const stripped = unpackHalResource(raw);
    expect(stripped._type).toBe("WorkPackage");
    expect(stripped.id).toBe(1);
    expect(stripped.subject).toBe("Test");
    expect(stripped.links).toEqual({
      project: { id: 4, title: "Project 4" },
    });
  });
});

// =============================================================================
// 5. OpenProjectClient HTTP & Error Sanitization (Unit Tests with Mock Fetch)
// =============================================================================

describe("OpenProjectClient (Mocked Unit Tests)", () => {
  test("injects Basic Auth header and JSON Accept headers", async () => {
    let capturedHeaders: Headers | undefined;

    const mockFetch = async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      capturedHeaders = new Headers(init?.headers);
      return new Response(JSON.stringify({ _type: "Project", id: 1, name: "P1" }), {
        status: 200,
        headers: { "Content-Type": "application/hal+json" },
      });
    };

    const client = new OpenProjectClient({
      baseUrl: "http://example.com",
      apiKey: "super-secret-token",
      fetchFn: mockFetch,
    });

    const result = await client.get<{ id: number }>("/api/v3/projects/1");
    expect(result.id).toBe(1);
    expect(capturedHeaders?.get("Authorization")).toBe(`Basic ${btoa("apikey:super-secret-token")}`);
    expect(capturedHeaders?.get("Accept")).toContain("application/hal+json");
  });

  test("sanitizes API credentials from error messages", async () => {
    const secretKey = "super-secret-key-xyz-999";
    const mockFetch = async (): Promise<Response> => {
      return new Response(
        JSON.stringify({
          _type: "Error",
          errorIdentifier: "urn:openproject-org:api:v3:errors:Unauthenticated",
          message: `Authentication failed for key ${secretKey} and header Basic ${btoa("apikey:" + secretKey)}`,
        }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    };

    const client = new OpenProjectClient({
      baseUrl: "http://example.com",
      apiKey: secretKey,
      fetchFn: mockFetch,
    });

    try {
      await client.get("/api/v3/projects");
      expect(true).toBe(false); // Should not reach
    } catch (err) {
      expect(err).toBeInstanceOf(OpenProjectAuthenticationError);
      const msg = (err as Error).message;
      expect(msg).not.toContain(secretKey);
      expect(msg).toContain("[REDACTED_API_KEY]");
      expect(msg).toContain("[REDACTED_AUTH]");
    }
  });

  test("maps HTTP status codes to appropriate error classes", async () => {
    const createMockClient = (status: number, body: unknown, headers?: Record<string, string>) => {
      const mockFetch = async (): Promise<Response> => {
        return new Response(JSON.stringify(body), {
          status,
          headers: { "Content-Type": "application/json", ...headers },
        });
      };
      return new OpenProjectClient({
        baseUrl: "http://example.com",
        apiKey: "dummy-key",
        fetchFn: mockFetch,
      });
    };

    // 403 Forbidden
    await expect(
      createMockClient(403, { message: "No permission" }).get("/res")
    ).rejects.toBeInstanceOf(OpenProjectForbiddenError);

    // 404 Not Found
    await expect(
      createMockClient(404, { message: "Item not found" }).get("/res")
    ).rejects.toBeInstanceOf(OpenProjectNotFoundError);

    // 409 Conflict
    await expect(
      createMockClient(409, { message: "Lock version mismatch" }).get("/res")
    ).rejects.toBeInstanceOf(OpenProjectConflictError);

    // 422 Validation
    await expect(
      createMockClient(422, { message: "Invalid attribute" }).get("/res")
    ).rejects.toBeInstanceOf(OpenProjectValidationError);

    // 429 Rate Limit
    try {
      await createMockClient(429, { message: "Slow down" }, { "retry-after": "60" }).get("/res");
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(OpenProjectRateLimitError);
      expect((e as OpenProjectRateLimitError).retryAfter).toBe(60);
    }

    // 500 Server Error
    await expect(
      createMockClient(500, { message: "Server crashed" }).get("/res")
    ).rejects.toBeInstanceOf(OpenProjectServerError);
  });
});

// =============================================================================
// 6. Live OpenProject Container Integration Tests
// =============================================================================

describe("OpenProject Live API Integration (Local Container)", () => {
  const liveBaseUrl = process.env.OPENPROJECT_BASE_URL || "http://localhost:8080";
  const liveApiKey = process.env.OPENPROJECT_API_KEY;

  test("fetches projects and work packages against live instance", async () => {
    if (!liveApiKey) {
      console.warn("Skipping live container test: OPENPROJECT_API_KEY not set");
      return;
    }

    const client = new OpenProjectClient({
      baseUrl: liveBaseUrl,
      apiKey: liveApiKey,
    });

    // 1. Fetch projects
    const projectsHal = await client.get<HalCollection>("/api/v3/projects");
    expect(projectsHal._type).toBe("Collection");
    const unpackedProjects = unpackCollection(projectsHal, normalizeProjectSummary);
    expect(unpackedProjects.items.length).toBeGreaterThan(0);

    const testProj = unpackedProjects.items.find((p) => p.identifier === "mcp-test-project");
    expect(testProj).toBeDefined();
    expect(testProj?.name).toBe("MCP Test Project");

    // 2. Fetch single project detail
    const projectDetailHal = await client.get<HalResource>(`/api/v3/projects/${testProj!.id}`);
    const projectDetail = normalizeProject(projectDetailHal);
    expect(projectDetail.identifier).toBe("mcp-test-project");

    // 3. Fetch work packages with open status filter
    const openWpsHal = await client.get<HalCollection>("/api/v3/work_packages", {
      filters: serializeFilters(buildWorkPackageFilters({ status: "open" })),
    });
    expect(["Collection", "WorkPackageCollection"]).toContain(openWpsHal._type);
    const unpackedWps = unpackCollection(openWpsHal, normalizeWorkPackageSummary);
    expect(unpackedWps.items.length).toBeGreaterThan(0);

    // 4. Fetch taxonomies (statuses, types, priorities)
    const statusesHal = await client.get<HalCollection>("/api/v3/statuses");
    const statuses = unpackCollection(statusesHal, normalizeStatus);
    expect(statuses.items.length).toBeGreaterThan(0);
    expect(statuses.items.some((s) => s.name === "New")).toBe(true);

    const typesHal = await client.get<HalCollection>("/api/v3/types");
    const types = unpackCollection(typesHal, normalizeType);
    expect(types.items.length).toBeGreaterThan(0);
    expect(types.items.some((t) => t.name === "Task")).toBe(true);

    const prioritiesHal = await client.get<HalCollection>("/api/v3/priorities");
    const priorities = unpackCollection(prioritiesHal, normalizePriority);
    expect(priorities.items.length).toBeGreaterThan(0);
  });

  test("live 401 authentication failure with invalid key", async () => {
    const client = new OpenProjectClient({
      baseUrl: liveBaseUrl,
      apiKey: "definitely-invalid-key-9999",
    });

    await expect(client.get("/api/v3/projects")).rejects.toBeInstanceOf(
      OpenProjectAuthenticationError
    );
  });

  test("live 404 not found failure with non-existent project", async () => {
    if (!liveApiKey) return;

    const client = new OpenProjectClient({
      baseUrl: liveBaseUrl,
      apiKey: liveApiKey,
    });

    await expect(client.get("/api/v3/projects/9999999")).rejects.toBeInstanceOf(
      OpenProjectNotFoundError
    );
  });
});
