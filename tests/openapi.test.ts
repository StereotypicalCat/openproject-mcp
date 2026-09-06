import { describe, expect, test, beforeEach } from "bun:test";
import {
  getOpenApiSpec,
  clearOpenApiCache,
  type OpenApiSummary,
} from "../src/services/openapi.ts";
import { OpenProjectClient } from "../src/client/api-client.ts";
import { OpenProjectNotFoundError } from "../src/client/errors.ts";
import { runWithContext } from "../src/context.ts";

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

  test("resolves ambient client from RequestContext when client is omitted", async () => {
    const res = await runWithContext({ client: mockClient, isReadOnly: true }, async () => {
      return getOpenApiSpec({});
    });
    expect((res as OpenApiSummary).title).toBe("OpenProject API V3 (Test)");
  });

  test("path mode does not falsely match root /api/v3 via empty suffix", async () => {
    // If /api/v3 itself is not a path key, requesting it must throw OpenProjectNotFoundError
    expect(getOpenApiSpec({ path: "/api/v3" }, mockClient)).rejects.toThrow(
      OpenProjectNotFoundError
    );
  });
});
