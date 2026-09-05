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


