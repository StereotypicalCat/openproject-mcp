/**
 * OpenAPI Tools for OpenProject MCP.
 * Implements openproject_get_openapi_spec tool for dynamic API introspection.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getOpenApiSpec } from "../services/openapi";
import {
  formatToolSuccess,
  formatToolError,
  registerTool,
  type ToolDefinition,
  type RegisterToolOptions,
} from "./common";

export const getOpenApiSpecSchema = {
  path: z
    .string()
    .optional()
    .describe(
      "Specific endpoint path to inspect (e.g. '/api/v3/work_packages' or 'projects')."
    ),
  tag: z
    .string()
    .optional()
    .describe(
      "Tag or category to filter endpoints by (e.g. 'Work Packages', 'Queries', 'Projects')."
    ),
  schema: z
    .string()
    .optional()
    .describe(
      "Component schema model name to inspect (e.g. 'WorkPackageModel')."
    ),
  full: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      "Whether to return the complete raw OpenAPI 3.0 document. Warning: very large (~1.18 MB)."
    ),
  refresh: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      "Whether to bypass the in-memory cache and fetch a fresh specification from the server."
    ),
};

export type GetOpenApiSpecArgs = z.infer<
  z.ZodObject<typeof getOpenApiSpecSchema>
>;

export const getOpenApiSpecTool: ToolDefinition<
  typeof getOpenApiSpecSchema,
  GetOpenApiSpecArgs
> = {
  name: "openproject_get_openapi_spec",
  description:
    "Retrieve OpenProject API v3 OpenAPI 3.0 specification (/api/v3/openapi.json) for dynamic endpoint discovery, parameter schemas, and entity models. Supports smart filtering by path, tag, or schema, or returns a token-efficient summary overview when called without parameters.",
  readOnly: true,
  parameters: getOpenApiSpecSchema,
  execute: async (args: GetOpenApiSpecArgs) => {
    try {
      const data = await getOpenApiSpec(args);
      return formatToolSuccess(data);
    } catch (error) {
      return formatToolError(error);
    }
  },
};

export const openApiTools: ToolDefinition[] = [
  getOpenApiSpecTool as unknown as ToolDefinition,
];

/**
 * Registers all OpenAPI tools with an McpServer instance.
 */
export function registerOpenApiTools(
  server: McpServer,
  options?: RegisterToolOptions
): void {
  for (const tool of openApiTools) {
    registerTool(server, tool, options);
  }
}
