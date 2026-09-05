/**
 * Common Model Context Protocol (MCP) Tool Utilities and Types.
 */

import type { ZodRawShape } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { OpenProjectError } from "../client/errors";

export interface McpToolResponse {
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
export interface ToolDefinition<TShape extends ZodRawShape = ZodRawShape> {
  name: string;
  description: string;
  parameters?: TShape;
  readOnly: boolean;
  execute: (args: any) => Promise<McpToolResponse>;
}

/**
 * Registers a ToolDefinition instance on an McpServer instance.
 */
export function registerTool(server: McpServer, tool: ToolDefinition<any>): void {
  if (tool.parameters) {
    server.tool(tool.name, tool.description, tool.parameters, async (args: any) => {
      return tool.execute(args);
    });
  } else {
    server.tool(tool.name, tool.description, async () => {
      return tool.execute({});
    });
  }
}
