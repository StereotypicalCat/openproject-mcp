import { describe, expect, test } from "bun:test";
import {
  formatToolSuccess,
  formatToolError,
  registerTool,
  type ToolDefinition,
} from "../src/tools/common";
import { OpenProjectNotFoundError } from "../src/client/errors";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

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
