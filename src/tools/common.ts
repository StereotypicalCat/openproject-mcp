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
 * Registers a ToolDefinition instance on an McpServer instance.
 */
export function registerTool<
  TShape extends ZodRawShape = ZodRawShape,
  TArgs = Record<string, unknown>,
>(server: McpServer, tool: ToolDefinition<TShape, TArgs>): void {
  if (tool.parameters) {
    server.tool(tool.name, tool.description, tool.parameters, async (args) => {
      return tool.execute(args as unknown as TArgs);
    });
  } else {
    server.tool(tool.name, tool.description, async () => {
      return tool.execute({} as unknown as TArgs);
    });
  }
}
