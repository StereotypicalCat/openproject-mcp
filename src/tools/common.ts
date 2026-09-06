/**
 * Common Model Context Protocol (MCP) Tool Utilities and Types.
 */

import type { ZodRawShape } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { OpenProjectError } from "../client/errors";

export interface McpToolResponse {
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

/**
 * Formats data into a standard MCP tool success text response.
 */
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

/**
 * Formats an error into a standard MCP tool error text response with error code.
 */
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

/**
 * Definition interface for OpenProject MCP tools.
 */
export interface ToolDefinition<
  TShape extends ZodRawShape = ZodRawShape,
  TArgs = Record<string, unknown>,
> {
  name: string;
  description: string;
  parameters?: TShape;
  readOnly: boolean;
  execute: (args: TArgs) => Promise<McpToolResponse>;
}

/**
 * Options for registering an individual tool on an McpServer instance.
 */
export interface RegisterToolOptions<
  TShape extends ZodRawShape = ZodRawShape,
  TArgs = Record<string, unknown>,
> {
  /**
   * Optional wrapper function to intercept tool execution, enabling
   * context injection (runWithContext) or execution guards (e.g. read-only checks).
   */
  wrapExecute?: (
    fn: () => Promise<McpToolResponse>,
    tool: ToolDefinition<TShape, TArgs>,
    args: TArgs
  ) => Promise<McpToolResponse>;
}

/**
 * Registers a ToolDefinition instance on an McpServer instance.
 *
 * @param server The McpServer instance to register the tool on.
 * @param tool The ToolDefinition describing the tool metadata, parameters, and handler.
 * @param options Optional registration options, such as an execution wrapper.
 */
export function registerTool<
  TShape extends ZodRawShape = ZodRawShape,
  TArgs = Record<string, unknown>,
>(
  server: McpServer,
  tool: ToolDefinition<TShape, TArgs>,
  options?: RegisterToolOptions<TShape, TArgs>
): void {
  const executeFn = (args: TArgs) => {
    if (options?.wrapExecute) {
      return options.wrapExecute(() => tool.execute(args), tool, args);
    }
    return tool.execute(args);
  };

  if (tool.parameters) {
    server.tool(tool.name, tool.description, tool.parameters as ZodRawShape, async (args) => {
      return executeFn(args as unknown as TArgs);
    });
  } else {
    server.tool(tool.name, tool.description, async () => {
      return executeFn({} as unknown as TArgs);
    });
  }
}

