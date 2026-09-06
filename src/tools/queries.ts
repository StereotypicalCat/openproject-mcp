/**
 * Query Tools for OpenProject MCP.
 * Implements openproject_list_queries and openproject_get_query tools.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  formatToolSuccess,
  formatToolError,
  registerTool,
  type McpToolResponse,
  type ToolDefinition,
} from "./common";
import { listQueries, getQuery, getQueryResults } from "../services/queries";

export const listQueriesShape = {
  projectId: z
    .union([z.number().int().positive(), z.string().min(1)])
    .optional()
    .describe("Optional project ID or identifier to scope saved queries"),
  pageSize: z
    .number()
    .int()
    .positive()
    .max(100)
    .optional()
    .describe("Number of queries to return per page (max 100, default 20)"),
  offset: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Page number to retrieve (1-based, default 1)"),
};

export type ListQueriesArgs = z.infer<z.ZodObject<typeof listQueriesShape>>;

/**
 * Tool execution handler for openproject_list_queries.
 */
export async function handleListQueries(
  args: ListQueriesArgs
): Promise<McpToolResponse> {
  try {
    const result = await listQueries({
      projectId: args.projectId,
      pageSize: args.pageSize,
      offset: args.offset,
    });

    return formatToolSuccess({
      queries: result.items,
      total: result.total,
      count: result.count,
      pageSize: result.pageSize,
      offset: result.offset,
    });
  } catch (error) {
    return formatToolError(error);
  }
}

export const getQueryShape = {
  queryId: z
    .number()
    .int()
    .positive()
    .describe("The numeric ID of the saved query"),
  pageSize: z
    .number()
    .int()
    .positive()
    .max(100)
    .optional()
    .describe(
      "Maximum number of result work packages to return (max 100, default 20)"
    ),
  offset: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Page number of results to retrieve (1-based, default 1)"),
};

export type GetQueryArgs = z.infer<z.ZodObject<typeof getQueryShape>>;

/**
 * Tool execution handler for openproject_get_query.
 */
export async function handleGetQuery(
  args: GetQueryArgs
): Promise<McpToolResponse> {
  try {
    const [query, results] = await Promise.all([
      getQuery(args.queryId),
      getQueryResults(args.queryId, {
        pageSize: args.pageSize,
        offset: args.offset,
      }),
    ]);

    return formatToolSuccess({
      query,
      results: {
        workPackages: results.items,
        total: results.total,
        count: results.count,
        pageSize: results.pageSize,
        offset: results.offset,
      },
    });
  } catch (error) {
    return formatToolError(error);
  }
}

export const listQueriesTool: ToolDefinition<
  typeof listQueriesShape,
  ListQueriesArgs
> = {
  name: "openproject_list_queries",
  description:
    "List saved queries (custom views, filter sets) accessible to the user, optionally filtered by project",
  parameters: listQueriesShape,
  readOnly: true,
  execute: handleListQueries,
};

export const getQueryTool: ToolDefinition<
  typeof getQueryShape,
  GetQueryArgs
> = {
  name: "openproject_get_query",
  description:
    "Retrieve metadata and work package results for a saved query",
  parameters: getQueryShape,
  readOnly: true,
  execute: handleGetQuery,
};

export const queryTools = [listQueriesTool, getQueryTool];

/**
 * Registers all query tools with an McpServer instance.
 */
export function registerQueryTools(server: McpServer): void {
  registerTool(server, listQueriesTool);
  registerTool(server, getQueryTool);
}
