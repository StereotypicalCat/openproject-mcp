/**
 * Model Context Protocol (MCP) Tools Registry and Barrel Export.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTool, type ToolDefinition } from "./common";
import { projectTools } from "./projects";
import { workPackageTools } from "./work-packages";
import { queryTools } from "./queries";
import { metadataTools } from "./metadata";

export * from "./common";
export * from "./projects";
export * from "./work-packages";
export * from "./queries";
export * from "./metadata";

export type AnyToolDefinition =
  | (typeof projectTools)[number]
  | (typeof workPackageTools)[number]
  | (typeof queryTools)[number]
  | (typeof metadataTools)[number];

export const allTools: AnyToolDefinition[] = [
  ...projectTools,
  ...workPackageTools,
  ...queryTools,
  ...metadataTools,
];

export interface RegisterToolsOptions {
  readOnly?: boolean;
}

/**
 * Registers all OpenProject tools with the given McpServer instance.
 * If options.readOnly is true, tools not marked as readOnly are skipped.
 */
export function registerAllTools(
  server: McpServer,
  options?: RegisterToolsOptions
): void {
  const isReadOnly = options?.readOnly ?? false;

  for (const tool of allTools) {
    // If server is in read-only mode, skip any non-read-only tools
    if (isReadOnly && !tool.readOnly) {
      continue;
    }
    registerTool(server, tool);
  }
}
