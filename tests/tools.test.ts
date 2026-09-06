import { describe, expect, test } from "bun:test";
import {
  allTools,
  registerAllTools,
  type RegisterToolsOptions,
  type AnyToolDefinition,
} from "../src/tools/index";
import {
  formatToolSuccess,
  formatToolError,
  registerTool,
  type ToolDefinition,
  type RegisterToolOptions,
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
import { OpenProjectNotFoundError } from "../src/client/errors";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { runWithContext } from "../src/context";
import { OpenProjectClient } from "../src/client/api-client";


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

  test("handleListProjects catches non-array JSON filters and returns error response", async () => {
    const response = await runWithContext(
      { client: dummyClient, isReadOnly: false },
      () => handleListProjects({ filters: '{"not":"an array"}' })
    );
    expect(response.isError).toBe(true);
    expect(response.content[0]?.text).toContain(
      "filters parameter must be a JSON array string"
    );
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

  test("getProject rejects empty string projectId", () => {
    const schema = z.object(getProjectShape);
    expect(() => schema.parse({ projectId: "" })).toThrow();
    expect(() => schema.parse({ projectId: 0 })).toThrow();
    expect(() => schema.parse({ projectId: -1 })).toThrow();
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

describe("Metadata Tools", () => {
  const dummyClient = {
    get: async (path: string) => {
      if (
        path === "types" ||
        path === "/api/v3/types" ||
        path === "projects/4/types" ||
        path === "projects/mcp-test-project/types"
      ) {
        return {
          _embedded: {
            elements: [
              {
                id: 1,
                name: "Task",
                color: "#1a73e8",
                isDefault: true,
                isMilestone: false,
                _links: { self: { href: "/api/v3/types/1" } },
              },
            ],
          },
          total: 1,
          count: 1,
          pageSize: 20,
          offset: 1,
        };
      }
      if (path === "statuses" || path === "/api/v3/statuses") {
        return {
          _embedded: {
            elements: [
              {
                id: 1,
                name: "New",
                isClosed: false,
                isDefault: true,
                color: "#34a853",
                _links: { self: { href: "/api/v3/statuses/1" } },
              },
            ],
          },
          total: 1,
          count: 1,
          pageSize: 20,
          offset: 1,
        };
      }
      if (path === "priorities" || path === "/api/v3/priorities") {
        return {
          _embedded: {
            elements: [
              {
                id: 1,
                name: "Normal",
                isDefault: true,
                _links: { self: { href: "/api/v3/priorities/1" } },
              },
            ],
          },
          total: 1,
          count: 1,
          pageSize: 20,
          offset: 1,
        };
      }
      if (path === "users" || path === "/api/v3/users") {
        return {
          _embedded: {
            elements: [
              {
                id: 1,
                name: "OpenProject Admin",
                email: "admin@example.com",
                status: "active",
                admin: true,
                _links: { self: { href: "/api/v3/users/1" } },
              },
            ],
          },
          total: 1,
          count: 1,
          pageSize: 20,
          offset: 1,
        };
      }
      return { _embedded: { elements: [] }, total: 0, count: 0 };
    },
  } as unknown as OpenProjectClient;

  test("listTypes returns types collection", async () => {
    const response = await runWithContext(
      { client: dummyClient, isReadOnly: false },
      () => handleListTypes({})
    );
    expect(response.isError).toBeUndefined();
    const result = JSON.parse(response.content[0]?.text ?? "{}");
    expect(result.types).toHaveLength(1);
    expect(result.types[0].name).toBe("Task");
  });

  test("listTypes accepts string and numeric projectId", async () => {
    const schema = z.object(listTypesShape);
    const parsedNum = schema.parse({ projectId: 4 });
    const responseNum = await runWithContext(
      { client: dummyClient, isReadOnly: false },
      () => handleListTypes(parsedNum)
    );
    expect(responseNum.isError).toBeUndefined();
    const resultNum = JSON.parse(responseNum.content[0]?.text ?? "{}");
    expect(resultNum.types).toHaveLength(1);

    const parsedStr = schema.parse({ projectId: "mcp-test-project" });
    const responseStr = await runWithContext(
      { client: dummyClient, isReadOnly: false },
      () => handleListTypes(parsedStr)
    );
    expect(responseStr.isError).toBeUndefined();
    const resultStr = JSON.parse(responseStr.content[0]?.text ?? "{}");
    expect(resultStr.types).toHaveLength(1);
  });

  test("listTypes rejects invalid projectId schema arguments", () => {
    const schema = z.object(listTypesShape);
    expect(() => schema.parse({ projectId: 0 })).toThrow();
    expect(() => schema.parse({ projectId: -1 })).toThrow();
    expect(() => schema.parse({ projectId: "" })).toThrow();
  });

  test("handleListTypes catches errors and returns error response", async () => {
    const failingClient = {
      get: async () => {
        throw new Error("Types service failure");
      },
    } as unknown as OpenProjectClient;

    const response = await runWithContext(
      { client: failingClient, isReadOnly: false },
      () => handleListTypes({})
    );
    expect(response.isError).toBe(true);
    expect(response.content[0]?.text).toContain("Types service failure");
  });

  test("listStatuses returns status items", async () => {
    const response = await runWithContext(
      { client: dummyClient, isReadOnly: false },
      () => handleListStatuses({})
    );
    expect(response.isError).toBeUndefined();
    const result = JSON.parse(response.content[0]?.text ?? "{}");
    expect(result.statuses).toHaveLength(1);
    expect(result.statuses[0].name).toBe("New");
  });

  test("handleListStatuses catches errors and returns error response", async () => {
    const failingClient = {
      get: async () => {
        throw new Error("Statuses service failure");
      },
    } as unknown as OpenProjectClient;

    const response = await runWithContext(
      { client: failingClient, isReadOnly: false },
      () => handleListStatuses({})
    );
    expect(response.isError).toBe(true);
    expect(response.content[0]?.text).toContain("Statuses service failure");
  });

  test("listPriorities returns priority items", async () => {
    const response = await runWithContext(
      { client: dummyClient, isReadOnly: false },
      () => handleListPriorities({})
    );
    expect(response.isError).toBeUndefined();
    const result = JSON.parse(response.content[0]?.text ?? "{}");
    expect(result.priorities).toHaveLength(1);
    expect(result.priorities[0].name).toBe("Normal");
  });

  test("handleListPriorities catches errors and returns error response", async () => {
    const failingClient = {
      get: async () => {
        throw new Error("Priorities service failure");
      },
    } as unknown as OpenProjectClient;

    const response = await runWithContext(
      { client: failingClient, isReadOnly: false },
      () => handleListPriorities({})
    );
    expect(response.isError).toBe(true);
    expect(response.content[0]?.text).toContain("Priorities service failure");
  });

  test("listUsers returns paginated user list", async () => {
    const schema = z.object(listUsersShape);
    const parsed = schema.parse({ pageSize: 10, offset: 1 });
    const response = await runWithContext(
      { client: dummyClient, isReadOnly: false },
      () => handleListUsers(parsed)
    );
    expect(response.isError).toBeUndefined();
    const result = JSON.parse(response.content[0]?.text ?? "{}");
    expect(result.users).toHaveLength(1);
    expect(result.users[0].name).toBe("OpenProject Admin");
    expect(result.total).toBe(1);
    expect(result.count).toBe(1);
    expect(result.pageSize).toBe(20);
    expect(result.offset).toBe(1);
  });

  test("listUsers rejects invalid schema arguments", () => {
    const schema = z.object(listUsersShape);
    expect(() => schema.parse({ pageSize: 0 })).toThrow();
    expect(() => schema.parse({ pageSize: -1 })).toThrow();
    expect(() => schema.parse({ pageSize: 500 })).toThrow();
    expect(() => schema.parse({ offset: 0 })).toThrow();
    expect(() => schema.parse({ offset: -1 })).toThrow();
  });

  test("handleListUsers catches errors and returns error response", async () => {
    const failingClient = {
      get: async () => {
        throw new Error("Users service failure");
      },
    } as unknown as OpenProjectClient;

    const response = await runWithContext(
      { client: failingClient, isReadOnly: false },
      () => handleListUsers({ pageSize: 10 })
    );
    expect(response.isError).toBe(true);
    expect(response.content[0]?.text).toContain("Users service failure");
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

    const registeredTools = (
      server as unknown as {
        _registeredTools: Record<string, unknown>;
      }
    )._registeredTools;

    expect(registeredTools["openproject_list_types"]).toBeDefined();
    expect(registeredTools["openproject_list_statuses"]).toBeDefined();
    expect(registeredTools["openproject_list_priorities"]).toBeDefined();
    expect(registeredTools["openproject_list_users"]).toBeDefined();
  });
});

describe("Tool Registry", () => {
  test("allTools contains exactly 11 tools including OpenAPI spec", () => {
    expect(allTools).toHaveLength(11);
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
      "openproject_get_openapi_spec",
    ]);
  });

  test("all tools in Phase 1 are marked readOnly: true", () => {
    for (const tool of allTools) {
      expect(tool.readOnly).toBe(true);
    }
  });

  test("registerAllTools registers all 11 tools on McpServer", () => {
    const server = new McpServer({ name: "test-mcp", version: "1.0.0" });
    registerAllTools(server);

    const registeredTools = (
      server as unknown as {
        _registeredTools: Record<string, unknown>;
      }
    )._registeredTools;

    expect(Object.keys(registeredTools)).toHaveLength(11);
    for (const tool of allTools) {
      expect(registeredTools[tool.name]).toBeDefined();
    }
  });

  test("registerAllTools filters out non-readOnly tools when readOnly is true", () => {
    const server = new McpServer({ name: "test-mcp", version: "1.0.0" });
    const syntheticMutatingTool: ToolDefinition = {
      name: "openproject_synthetic_mutating_tool",
      description: "A synthetic mutating tool for testing readOnly filtering",
      readOnly: false,
      execute: async () => formatToolSuccess({ mutated: true }),
    };

    registerAllTools(server, {
      readOnly: true,
      tools: [
        ...allTools,
        syntheticMutatingTool as unknown as AnyToolDefinition,
      ],
    });

    const registeredTools = (
      server as unknown as {
        _registeredTools: Record<string, unknown>;
      }
    )._registeredTools;

    expect(
      registeredTools["openproject_synthetic_mutating_tool"]
    ).toBeUndefined();
    expect(Object.keys(registeredTools)).toHaveLength(11);
    for (const tool of allTools) {
      expect(registeredTools[tool.name]).toBeDefined();
    }
  });
});

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

    const registered = (
      server as unknown as {
        _registeredTools: Record<
          string,
          {
            handler: (args: Record<string, unknown>) => Promise<{
              content: Array<{ type: string; text: string }>;
              isError?: boolean;
            }>;
          }
        >;
      }
    )._registeredTools["wrapped_tool"];
    const result = await registered!.handler({});
    expect(wrapperCalled).toBe(true);
    expect(result.content[0]?.text).toBe("success");
  });

  test("registerTool passes tool definition and arguments to wrapExecute", async () => {
    const server = new McpServer({ name: "test", version: "1" });
    let capturedToolName = "";
    let capturedArgs: Record<string, unknown> = {};

    const dummyToolWithParams: ToolDefinition<{ id: z.ZodNumber }, { id: number }> = {
      name: "param_wrapped_tool",
      description: "Param wrapped tool",
      parameters: { id: z.number() },
      readOnly: true,
      execute: async (args: { id: number }) => ({
        content: [{ type: "text", text: `id: ${args.id}` }],
      }),
    };

    registerTool(server, dummyToolWithParams, {
      wrapExecute: async (fn, tool, args) => {
        capturedToolName = tool.name;
        capturedArgs = args as Record<string, unknown>;
        return fn();
      },
    });

    const registered = (
      server as unknown as {
        _registeredTools: Record<
          string,
          {
            handler: (args: Record<string, unknown>) => Promise<{
              content: Array<{ type: string; text: string }>;
              isError?: boolean;
            }>;
          }
        >;
      }
    )._registeredTools["param_wrapped_tool"];

    const result = await registered!.handler({ id: 123 });
    expect(capturedToolName).toBe("param_wrapped_tool");
    expect(capturedArgs).toEqual({ id: 123 });
    expect(result.content[0]?.text).toBe("id: 123");
  });

  test("registerAllTools forwards wrapExecute to registered tools", async () => {
    const server = new McpServer({ name: "test", version: "1" });
    const interceptedTools: string[] = [];

    registerAllTools(server, {
      wrapExecute: async (fn, tool) => {
        interceptedTools.push(tool.name);
        return fn();
      },
    });

    const registeredTools = (
      server as unknown as {
        _registeredTools: Record<
          string,
          {
            handler: (args: Record<string, unknown>) => Promise<{
              content: Array<{ type: string; text: string }>;
              isError?: boolean;
            }>;
          }
        >;
      }
    )._registeredTools;

    const listProjects = registeredTools["openproject_list_projects"];
    expect(listProjects).toBeDefined();

    const dummyClient = {
      get: async () => ({
        _embedded: { elements: [] },
        total: 0,
        count: 0,
        pageSize: 20,
        offset: 1,
      }),
    } as unknown as OpenProjectClient;

    await runWithContext({ client: dummyClient, isReadOnly: false }, () =>
      listProjects!.handler({})
    );

    expect(interceptedTools).toContain("openproject_list_projects");
  });
});


describe("Live Container Integration (All 10 MCP Tools)", () => {
  const baseUrl = process.env.OPENPROJECT_BASE_URL || "http://localhost:8080";
  const apiKey = process.env.OPENPROJECT_API_KEY;
  const runLiveTests = apiKey ? test : test.skip;
  const liveClient = new OpenProjectClient({ baseUrl, apiKey: apiKey || "skip" });

  runLiveTests("live: list projects and get project tool execution", async () => {
    await runWithContext({ client: liveClient, isReadOnly: false }, async () => {
      const listRes = await handleListProjects({ pageSize: 5 });
      expect(listRes.isError).toBeUndefined();
      const listData = JSON.parse(listRes.content[0]!.text);
      expect(listData.projects.length).toBeGreaterThan(0);

      const targetProject =
        listData.projects.find(
          (p: { identifier?: string; id: number }) => p.identifier === "mcp-test-project"
        ) || listData.projects[0];
      const getRes = await handleGetProject({ projectId: targetProject.id });
      expect(getRes.isError).toBeUndefined();
      const getData = JSON.parse(getRes.content[0]!.text);
      expect(getData.id).toBe(targetProject.id);
    });
  });

  runLiveTests("live: list work packages and get work package tool execution", async () => {
    await runWithContext({ client: liveClient, isReadOnly: false }, async () => {
      const listRes = await handleListWorkPackages({ pageSize: 5 });
      expect(listRes.isError).toBeUndefined();
      const listData = JSON.parse(listRes.content[0]!.text);
      expect(listData.workPackages.length).toBeGreaterThan(0);

      const wpId = listData.workPackages[0].id;
      const getRes = await handleGetWorkPackage({ workPackageId: wpId });
      expect(getRes.isError).toBeUndefined();
      const getData = JSON.parse(getRes.content[0]!.text);
      expect(getData.id).toBe(wpId);
      expect(getData.subject).toBeDefined();
    });
  });

  runLiveTests("live: list queries and get query tool execution", async () => {
    await runWithContext({ client: liveClient, isReadOnly: false }, async () => {
      const listRes = await handleListQueries({});
      expect(listRes.isError).toBeUndefined();
      const listData = JSON.parse(listRes.content[0]!.text);
      expect(listData.queries.length).toBeGreaterThan(0);

      const queryId = listData.queries[0].id;
      const getRes = await handleGetQuery({ queryId });
      expect(getRes.isError).toBeUndefined();
      const getData = JSON.parse(getRes.content[0]!.text);
      expect(getData.query.id).toBe(queryId);
      expect(getData.results).toBeDefined();
    });
  });

  runLiveTests("live: metadata tools execution (types, statuses, priorities, users)", async () => {
    await runWithContext({ client: liveClient, isReadOnly: false }, async () => {
      const typesRes = await handleListTypes({});
      expect(typesRes.isError).toBeUndefined();
      const typesData = JSON.parse(typesRes.content[0]!.text);
      expect(typesData.types.length).toBeGreaterThan(0);

      const statusesRes = await handleListStatuses({});
      expect(statusesRes.isError).toBeUndefined();
      const statusesData = JSON.parse(statusesRes.content[0]!.text);
      expect(statusesData.statuses.length).toBeGreaterThan(0);

      const prioritiesRes = await handleListPriorities({});
      expect(prioritiesRes.isError).toBeUndefined();
      const prioritiesData = JSON.parse(prioritiesRes.content[0]!.text);
      expect(prioritiesData.priorities.length).toBeGreaterThan(0);

      const usersRes = await handleListUsers({ pageSize: 5 });
      expect(usersRes.isError).toBeUndefined();
      const usersData = JSON.parse(usersRes.content[0]!.text);
      expect(usersData.users.length).toBeGreaterThan(0);
    });
  });
});




