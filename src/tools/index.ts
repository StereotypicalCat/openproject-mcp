/**
 * Model Context Protocol (MCP) Tools Registry and Barrel Export.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  registerTool,
  type ToolDefinition,
  type RegisterToolOptions,
  type McpToolResponse,
} from "./common";
import { projectTools } from "./projects";
import { workPackageTools } from "./work-packages";
import { queryTools } from "./queries";
import { metadataTools } from "./metadata";
import { openApiTools } from "./openapi";

export * from "./common";
export * from "./projects";
export * from "./work-packages";
export * from "./queries";
export * from "./metadata";
export * from "./openapi";

export type AnyToolDefinition =
  | (typeof projectTools)[number]
  | (typeof workPackageTools)[number]
  | (typeof queryTools)[number]
  | (typeof metadataTools)[number]
  | (typeof openApiTools)[number];

export const allTools: AnyToolDefinition[] = [
  ...projectTools,
  ...workPackageTools,
  ...queryTools,
  ...metadataTools,
  ...openApiTools,
];

export interface RegisterToolsOptions {
  readOnly?: boolean;
  tools?: AnyToolDefinition[];
  wrapExecute?: (
    fn: () => Promise<McpToolResponse>,
    tool: AnyToolDefinition,
    args: Record<string, unknown>
  ) => Promise<McpToolResponse>;
}

/**
 * Registers all OpenProject tools with the given McpServer instance.
 * If options.readOnly is true, tools not marked as readOnly are skipped.
 * If options.wrapExecute is provided, tool execution is intercepted through the wrapper.
 */
export function registerAllTools(
  server: McpServer,
  options?: RegisterToolsOptions
): void {
  const isReadOnly = options?.readOnly ?? false;
  const toolsToRegister = options?.tools ?? allTools;

  for (const tool of toolsToRegister) {
    // If server is in read-only mode, skip any non-read-only tools
    if (isReadOnly && !tool.readOnly) {
      continue;
    }

    const toolOptions: RegisterToolOptions | undefined = options?.wrapExecute
      ? {
          wrapExecute: (fn, t, args) =>
            options.wrapExecute!(
              fn,
              t as unknown as AnyToolDefinition,
              args as Record<string, unknown>
            ),
        }
      : undefined;

    registerTool(server, tool as unknown as ToolDefinition, toolOptions);
  }
}

