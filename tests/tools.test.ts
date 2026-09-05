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

  test("registerTool registers tool with parameters on McpServer", () => {
    const server = new McpServer({ name: "test-server", version: "1.0.0" });
    const tool: ToolDefinition<{ id: z.ZodNumber }> = {
      name: "test_tool_with_params",
      description: "A test tool with parameters",
      parameters: { id: z.number() },
      readOnly: true,
      execute: async (args: { id: number }) => formatToolSuccess({ doubled: args.id * 2 }),
    };

    registerTool(server, tool);
    expect(tool.name).toBe("test_tool_with_params");
  });

  test("registerTool registers parameterless tool on McpServer", () => {
    const server = new McpServer({ name: "test-server", version: "1.0.0" });
    const tool: ToolDefinition = {
      name: "test_tool_no_params",
      description: "A test tool without parameters",
      readOnly: true,
      execute: async () => formatToolSuccess({ ok: true }),
    };

    registerTool(server, tool);
    expect(tool.name).toBe("test_tool_no_params");
  });
});
