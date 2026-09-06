import { describe, expect, test } from "bun:test";
import {
  formatToolSuccess,
  formatToolError,
  registerTool,
  type ToolDefinition,
} from "../src/tools/common";
import {
  listProjectsShape,
  handleListProjects,
  getProjectShape,
  handleGetProject,
  projectTools,
  registerProjectTools,
} from "../src/tools/projects";
import {
  listWorkPackagesShape,
  handleListWorkPackages,
  getWorkPackageShape,
  handleGetWorkPackage,
  workPackageTools,
  registerWorkPackageTools,
} from "../src/tools/work-packages";
import {
  listQueriesShape,
  handleListQueries,
  getQueryShape,
  handleGetQuery,
  queryTools,
  registerQueryTools,
} from "../src/tools/queries";
import { OpenProjectNotFoundError } from "../src/client/errors";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { runWithContext } from "../src/context";
import type { OpenProjectClient } from "../src/client/api-client";


describe("Tool Utilities", () => {
  test("formatToolSuccess formats data into MCP text response", () => {
    const data = { id: 1, name: "Test" };
    const response = formatToolSuccess(data);
    expect(response.isError).toBeUndefined();
    expect(response.content).toHaveLength(1);
    expect(response.content[0]?.type).toBe("text");
    expect(JSON.parse(response.content[0]?.text ?? "{}")).toEqual(data);
  });

  test("formatToolError formats error into MCP isError response", () => {
    const error = new OpenProjectNotFoundError("Project 99 not found");
    const response = formatToolError(error);
    expect(response.isError).toBe(true);
    expect(response.content).toHaveLength(1);
    expect(response.content[0]?.type).toBe("text");
    expect(response.content[0]?.text).toContain("Project 99 not found");
  });

  test("formatToolError handles non-Error unknown values", () => {
    const response = formatToolError("unexpected failure string");
    expect(response.isError).toBe(true);
    expect(response.content).toHaveLength(1);
    expect(response.content[0]?.type).toBe("text");
    expect(response.content[0]?.text).toContain("unexpected failure string");
  });

  test("OpenProjectNotFoundError retains OPENPROJECT_NOT_FOUND code when errorIdentifier is provided", () => {
    const error = new OpenProjectNotFoundError("Project 99 not found", {
      errorIdentifier: "urn:openproject-org:api:v3:errors:NotFound",
    });
    expect(error.code).toBe("OPENPROJECT_NOT_FOUND");
    expect(error.errorIdentifier).toBe("urn:openproject-org:api:v3:errors:NotFound");

    const response = formatToolError(error);
    expect(response.isError).toBe(true);
    expect(response.content[0]?.text).toBe("Error [OPENPROJECT_NOT_FOUND]: Project 99 not found");
  });

  test("registerTool registers tool with parameters on McpServer", async () => {
    const server = new McpServer({ name: "test-server", version: "1.0.0" });
    const tool: ToolDefinition<{ id: z.ZodNumber }, { id: number }> = {
      name: "test_tool_with_params",
      description: "A test tool with parameters",
      parameters: { id: z.number() },
      readOnly: true,
      execute: async (args: { id: number }) => formatToolSuccess({ doubled: args.id * 2 }),
    };

    registerTool(server, tool);

    const registeredTools = (
      server as unknown as {
        _registeredTools: Record<
          string,
          {
            description?: string;
            handler: (args: Record<string, unknown>) => Promise<{
              content: Array<{ type: string; text: string }>;
              isError?: boolean;
            }>;
          }
        >;
      }
    )._registeredTools;

    const registered = registeredTools[tool.name];
    expect(registered).toBeDefined();
    expect(registered?.description).toBe("A test tool with parameters");

    const executionResult = await registered?.handler({ id: 21 });
    expect(executionResult).toBeDefined();
    expect(executionResult?.isError).toBeUndefined();
    expect(JSON.parse(executionResult?.content[0]?.text ?? "{}")).toEqual({ doubled: 42 });
  });

  test("registerTool registers parameterless tool on McpServer", async () => {
    const server = new McpServer({ name: "test-server", version: "1.0.0" });
    const tool: ToolDefinition = {
      name: "test_tool_no_params",
      description: "A test tool without parameters",
      readOnly: true,
      execute: async () => formatToolSuccess({ ok: true }),
    };

    registerTool(server, tool);

    const registeredTools = (
      server as unknown as {
        _registeredTools: Record<
          string,
          {
            description?: string;
            handler: (args: Record<string, unknown>) => Promise<{
              content: Array<{ type: string; text: string }>;
              isError?: boolean;
            }>;
          }
        >;
      }
    )._registeredTools;

    const registered = registeredTools[tool.name];
    expect(registered).toBeDefined();
    expect(registered?.description).toBe("A test tool without parameters");

    const executionResult = await registered?.handler({});
    expect(executionResult).toBeDefined();
    expect(executionResult?.isError).toBeUndefined();
    expect(JSON.parse(executionResult?.content[0]?.text ?? "{}")).toEqual({ ok: true });
  });
});

describe("Project Tools", () => {
  const dummyClient = {
    get: async (path: string) => {
      if (path === "projects/4" || path === "/api/v3/projects/4") {
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
        count: 1,
        pageSize: 20,
        offset: 1,
      };
    },
  } as unknown as OpenProjectClient;

  test("listProjects validates schema and executes successfully", async () => {
    const schema = z.object(listProjectsShape);
    const parsed = schema.parse({ pageSize: 10, offset: 1 });
    const response = await runWithContext(
      { client: dummyClient, isReadOnly: false },
      () => handleListProjects(parsed)
    );

    expect(response.isError).toBeUndefined();
    const result = JSON.parse(response.content[0]?.text ?? "{}");
    expect(result.projects).toHaveLength(1);
    expect(result.projects[0].id).toBe(4);
    expect(result.total).toBe(1);
  });

  test("listProjects handles raw JSON string filters", async () => {
    const schema = z.object(listProjectsShape);
    const parsed = schema.parse({
      filters: JSON.stringify([{ active: { operator: "=", values: ["t"] } }]),
    });
    const response = await runWithContext(
      { client: dummyClient, isReadOnly: false },
      () => handleListProjects(parsed)
    );

    expect(response.isError).toBeUndefined();
    const result = JSON.parse(response.content[0]?.text ?? "{}");
    expect(result.projects).toHaveLength(1);
  });

  test("listProjects rejects invalid schema arguments", () => {
    const schema = z.object(listProjectsShape);
    expect(() => schema.parse({ pageSize: 500 })).toThrow();
    expect(() => schema.parse({ pageSize: -5 })).toThrow();
    expect(() => schema.parse({ offset: 0 })).toThrow();
  });

  test("handleListProjects catches JSON parsing errors and returns error response", async () => {
    const response = await runWithContext(
      { client: dummyClient, isReadOnly: false },
      () => handleListProjects({ filters: "{invalid-json" })
    );
    expect(response.isError).toBe(true);
    expect(response.content[0]?.text).toContain("Error");
  });

  test("getProject validates schema and retrieves single project", async () => {
    const schema = z.object(getProjectShape);
    const parsed = schema.parse({ projectId: 4 });
    const response = await runWithContext(
      { client: dummyClient, isReadOnly: false },
      () => handleGetProject(parsed)
    );

    expect(response.isError).toBeUndefined();
    const result = JSON.parse(response.content[0]?.text ?? "{}");
    expect(result.id).toBe(4);
    expect(result.identifier).toBe("mcp-test-project");
  });

  test("getProject catches errors and formats error response", async () => {
    const failingClient = {
      get: async () => {
        throw new Error("Network timeout");
      },
    } as unknown as OpenProjectClient;

    const response = await runWithContext(
      { client: failingClient, isReadOnly: false },
      () => handleGetProject({ projectId: 999 })
    );

    expect(response.isError).toBe(true);
    expect(response.content[0]?.text).toContain("Network timeout");
  });

  test("registerProjectTools registers tools on McpServer", () => {
    const server = new McpServer({ name: "test-mcp", version: "1.0.0" });
    registerProjectTools(server);

    expect(projectTools).toHaveLength(2);
    expect(projectTools.map((t) => t.name)).toEqual([
      "openproject_list_projects",
      "openproject_get_project",
    ]);

    const registeredTools = (
      server as unknown as {
        _registeredTools: Record<string, unknown>;
      }
    )._registeredTools;

    expect(registeredTools["openproject_list_projects"]).toBeDefined();
    expect(registeredTools["openproject_get_project"]).toBeDefined();
  });
});

describe("Work Package Tools", () => {
  const dummyClient = {
    get: async (path: string) => {
      if (path === "/api/v3/work_packages/38" || path === "work_packages/38") {
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
        count: 1,
        pageSize: 20,
        offset: 1,
      };
    },
  } as unknown as OpenProjectClient;

  test("listWorkPackages parses parameters and returns normalized list", async () => {
    const schema = z.object(listWorkPackagesShape);
    const parsed = schema.parse({ projectId: 4, status: "open" });
    const response = await runWithContext({ client: dummyClient, isReadOnly: false }, () =>
      handleListWorkPackages(parsed)
    );

    expect(response.isError).toBeUndefined();
    const result = JSON.parse(response.content[0]?.text ?? "{}");
    expect(result.workPackages).toHaveLength(1);
    expect(result.workPackages[0].id).toBe(38);
    expect(result.workPackages[0].subject).toBe("Seed Task 1");
    expect(result.total).toBe(1);
  });

  test("listWorkPackages accepts string projectId and filter options", async () => {
    const schema = z.object(listWorkPackagesShape);
    const parsed = schema.parse({
      projectId: "mcp-test-project",
      status: "closed",
      type: 1,
      assigneeId: 2,
      subject: "Seed",
      pageSize: 10,
      offset: 1,
      sortBy: "id:asc",
    });
    const response = await runWithContext({ client: dummyClient, isReadOnly: false }, () =>
      handleListWorkPackages(parsed)
    );

    expect(response.isError).toBeUndefined();
    const result = JSON.parse(response.content[0]?.text ?? "{}");
    expect(result.workPackages).toHaveLength(1);
  });

  test("listWorkPackages handles raw JSON string filters", async () => {
    const schema = z.object(listWorkPackagesShape);
    const parsed = schema.parse({
      filters: JSON.stringify([{ status_id: { operator: "o", values: [] } }]),
    });
    const response = await runWithContext({ client: dummyClient, isReadOnly: false }, () =>
      handleListWorkPackages(parsed)
    );

    expect(response.isError).toBeUndefined();
    const result = JSON.parse(response.content[0]?.text ?? "{}");
    expect(result.workPackages).toHaveLength(1);
  });

  test("listWorkPackages rejects invalid schema arguments", () => {
    const schema = z.object(listWorkPackagesShape);
    expect(() => schema.parse({ pageSize: 500 })).toThrow();
    expect(() => schema.parse({ pageSize: -1 })).toThrow();
    expect(() => schema.parse({ offset: 0 })).toThrow();
    expect(() => schema.parse({ projectId: "" })).toThrow();
    expect(() => schema.parse({ projectId: -4 })).toThrow();
    expect(() => schema.parse({ status: "invalid-status" })).toThrow();
  });

  test("handleListWorkPackages catches JSON parsing errors and returns error response", async () => {
    const response = await runWithContext({ client: dummyClient, isReadOnly: false }, () =>
      handleListWorkPackages({ filters: "{invalid-json" })
    );
    expect(response.isError).toBe(true);
    expect(response.content[0]?.text).toContain("Error");
  });

  test("handleListWorkPackages catches non-array JSON filters and returns error response", async () => {
    const response = await runWithContext({ client: dummyClient, isReadOnly: false }, () =>
      handleListWorkPackages({ filters: '{"not":"an array"}' })
    );
    expect(response.isError).toBe(true);
    expect(response.content[0]?.text).toContain("Filters must be a JSON array");
  });

  test("getWorkPackage parses numeric ID and returns details", async () => {
    const schema = z.object(getWorkPackageShape);
    const parsed = schema.parse({ workPackageId: 38 });
    const response = await runWithContext({ client: dummyClient, isReadOnly: false }, () =>
      handleGetWorkPackage(parsed)
    );

    expect(response.isError).toBeUndefined();
    const result = JSON.parse(response.content[0]?.text ?? "{}");
    expect(result.id).toBe(38);
    expect(result.subject).toBe("Seed Task 1");
    expect(result.project).toBe("MCP Test Project");
    expect(result.projectId).toBe(4);
  });

  test("getWorkPackage rejects non-positive or non-integer ID", () => {
    const schema = z.object(getWorkPackageShape);
    expect(() => schema.parse({ workPackageId: -1 })).toThrow();
    expect(() => schema.parse({ workPackageId: 0 })).toThrow();
    expect(() => schema.parse({ workPackageId: 3.14 })).toThrow();
    expect(() => schema.parse({ workPackageId: "38" })).toThrow();
  });

  test("getWorkPackage catches errors and formats error response", async () => {
    const failingClient = {
      get: async () => {
        throw new Error("Work package not found");
      },
    } as unknown as OpenProjectClient;

    const response = await runWithContext({ client: failingClient, isReadOnly: false }, () =>
      handleGetWorkPackage({ workPackageId: 999 })
    );

    expect(response.isError).toBe(true);
    expect(response.content[0]?.text).toContain("Work package not found");
  });

  test("registerWorkPackageTools registers tools on McpServer", () => {
    const server = new McpServer({ name: "test-mcp", version: "1.0.0" });
    registerWorkPackageTools(server);
    expect(workPackageTools).toHaveLength(2);
    expect(workPackageTools.map((t) => t.name)).toEqual([
      "openproject_list_work_packages",
      "openproject_get_work_package",
    ]);

    const registeredTools = (
      server as unknown as {
        _registeredTools: Record<string, unknown>;
      }
    )._registeredTools;

    expect(registeredTools["openproject_list_work_packages"]).toBeDefined();
    expect(registeredTools["openproject_get_work_package"]).toBeDefined();
  });
});

describe("Query Tools", () => {
  const dummyClient = {
    get: async (path: string) => {
      if (path === "queries/30" || path === "/api/v3/queries/30") {
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
            columns: [{ href: "/api/v3/queries/columns/id", title: "ID" }],
          },
        };
      }
      if (
        path === "queries/30/results" ||
        path === "/api/v3/queries/30/results"
      ) {
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
          count: 1,
          pageSize: 20,
          offset: 1,
        };
      }
      if (path === "queries" || path === "/api/v3/queries") {
        return {
          _embedded: {
            elements: [
              {
                id: 30,
                name: "MCP Active Tasks",
                public: true,
                starred: false,
                _links: {
                  self: { href: "/api/v3/queries/30" },
                  project: { href: "/api/v3/projects/4", title: "MCP Test Project" },
                },
              },
            ],
          },
          total: 1,
          count: 1,
          pageSize: 20,
          offset: 1,
        };
      }
      if (path === "projects/mcp-test-project" || path === "/api/v3/projects/mcp-test-project") {
        return { id: 4 };
      }
      throw new Error(`Unexpected path: ${path}`);
    },
  } as unknown as OpenProjectClient;

  test("listQueries parses parameters and returns normalized query list", async () => {
    const schema = z.object(listQueriesShape);
    const parsed = schema.parse({ projectId: 4, pageSize: 10, offset: 1 });
    const response = await runWithContext({ client: dummyClient, isReadOnly: false }, () =>
      handleListQueries(parsed)
    );

    expect(response.isError).toBeUndefined();
    const result = JSON.parse(response.content[0]?.text ?? "{}");
    expect(result.queries).toHaveLength(1);
    expect(result.queries[0].id).toBe(30);
    expect(result.queries[0].name).toBe("MCP Active Tasks");
    expect(result.total).toBe(1);
    expect(result.count).toBe(1);
    expect(result.pageSize).toBe(20);
    expect(result.offset).toBe(1);
  });

  test("listQueries accepts string projectId", async () => {
    const schema = z.object(listQueriesShape);
    const parsed = schema.parse({ projectId: "mcp-test-project" });
    const response = await runWithContext({ client: dummyClient, isReadOnly: false }, () =>
      handleListQueries(parsed)
    );

    expect(response.isError).toBeUndefined();
    const result = JSON.parse(response.content[0]?.text ?? "{}");
    expect(result.queries).toHaveLength(1);
    expect(result.queries[0].id).toBe(30);
  });

  test("listQueries rejects invalid schema arguments", () => {
    const schema = z.object(listQueriesShape);
    expect(() => schema.parse({ pageSize: 500 })).toThrow();
    expect(() => schema.parse({ pageSize: -1 })).toThrow();
    expect(() => schema.parse({ offset: 0 })).toThrow();
    expect(() => schema.parse({ projectId: "" })).toThrow();
    expect(() => schema.parse({ projectId: -4 })).toThrow();
  });

  test("handleListQueries catches errors and returns error response", async () => {
    const failingClient = {
      get: async () => {
        throw new Error("Queries service failure");
      },
    } as unknown as OpenProjectClient;

    const response = await runWithContext({ client: failingClient, isReadOnly: false }, () =>
      handleListQueries({})
    );

    expect(response.isError).toBe(true);
    expect(response.content[0]?.text).toContain("Queries service failure");
  });

  test("getQuery returns query details along with result work packages", async () => {
    const schema = z.object(getQueryShape);
    const parsed = schema.parse({ queryId: 30, pageSize: 20, offset: 1 });
    const response = await runWithContext({ client: dummyClient, isReadOnly: false }, () =>
      handleGetQuery(parsed)
    );

    expect(response.isError).toBeUndefined();
    const result = JSON.parse(response.content[0]?.text ?? "{}");
    expect(result.query.id).toBe(30);
    expect(result.query.name).toBe("MCP Active Tasks");
    expect(result.results.workPackages).toHaveLength(1);
    expect(result.results.workPackages[0].id).toBe(38);
    expect(result.results.workPackages[0].subject).toBe("Seed Task 1");
    expect(result.results.total).toBe(1);
    expect(result.results.count).toBe(1);
    expect(result.results.pageSize).toBe(20);
    expect(result.results.offset).toBe(1);
  });

  test("getQuery rejects invalid schema arguments", () => {
    const schema = z.object(getQueryShape);
    expect(() => schema.parse({ queryId: -1 })).toThrow();
    expect(() => schema.parse({ queryId: 0 })).toThrow();
    expect(() => schema.parse({ queryId: 3.14 })).toThrow();
    expect(() => schema.parse({ queryId: "30" })).toThrow();
    expect(() => schema.parse({ queryId: 30, pageSize: 500 })).toThrow();
    expect(() => schema.parse({ queryId: 30, offset: 0 })).toThrow();
  });

  test("handleGetQuery catches errors and returns error response", async () => {
    const failingClient = {
      get: async () => {
        throw new Error("Query not found");
      },
    } as unknown as OpenProjectClient;

    const response = await runWithContext({ client: failingClient, isReadOnly: false }, () =>
      handleGetQuery({ queryId: 999 })
    );

    expect(response.isError).toBe(true);
    expect(response.content[0]?.text).toContain("Query not found");
  });

  test("registerQueryTools registers tools on McpServer", () => {
    const server = new McpServer({ name: "test-mcp", version: "1.0.0" });
    registerQueryTools(server);
    expect(queryTools).toHaveLength(2);
    expect(queryTools.map((t) => t.name)).toEqual([
      "openproject_list_queries",
      "openproject_get_query",
    ]);

    const registeredTools = (
      server as unknown as {
        _registeredTools: Record<string, unknown>;
      }
    )._registeredTools;

    expect(registeredTools["openproject_list_queries"]).toBeDefined();
    expect(registeredTools["openproject_get_query"]).toBeDefined();
  });
});



