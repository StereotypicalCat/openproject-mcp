/**
 * Work Package Tools for OpenProject MCP.
 * Implements openproject_list_work_packages and openproject_get_work_package tools.
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
import {
  listWorkPackages,
  getWorkPackage,
  listWorkPackageActivities,
  searchWorkPackages,
} from "../services/work-packages";
import type { FilterElement } from "../client/types";

export const listWorkPackagesShape = {
  projectId: z
    .union([z.number().int().positive(), z.string().min(1)])
    .optional()
    .describe(
      "Scope work packages to a specific project by numeric ID or slug identifier"
    ),
  status: z
    .union([z.enum(["open", "closed"]), z.number().int().positive()])
    .optional()
    .describe("Filter by status: 'open', 'closed', or numeric status ID"),
  type: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "Filter by work package type ID (e.g. 1 for Task, 2 for Milestone)"
    ),
  assigneeId: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Filter by assignee user ID"),
  subject: z
    .string()
    .optional()
    .describe("Filter by substring search in work package subject"),
  pageSize: z
    .number()
    .int()
    .positive()
    .max(100)
    .optional()
    .describe("Number of items per page (max 100, default 20)"),
  offset: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Page number to retrieve (1-based, default 1)"),
  sortBy: z
    .string()
    .optional()
    .describe("Sorting criteria (e.g. 'id:asc', 'updatedAt:desc')"),
  filters: z
    .string()
    .optional()
    .describe(
      "Optional raw OpenProject JSON filter string array overriding individual filters"
    ),
};

export type ListWorkPackagesArgs = z.infer<
  z.ZodObject<typeof listWorkPackagesShape>
>;

/**
 * Tool execution handler for openproject_list_work_packages.
 */
export async function handleListWorkPackages(
  args: ListWorkPackagesArgs
): Promise<McpToolResponse> {
  try {
    let customFilters: FilterElement[] | undefined;
    if (args.filters) {
      const parsed = JSON.parse(args.filters);
      if (!Array.isArray(parsed)) {
        throw new Error("Filters must be a JSON array");
      }
      customFilters = parsed as FilterElement[];
    }

    const result = await listWorkPackages({
      projectId: args.projectId,
      status: args.status,
      typeId: args.type,
      assigneeId: args.assigneeId,
      subject: args.subject,
      pageSize: args.pageSize,
      offset: args.offset,
      sortBy: args.sortBy,
      customFilters,
    });

    return formatToolSuccess({
      workPackages: result.items,
      total: result.total,
      count: result.count,
      pageSize: result.pageSize,
      offset: result.offset,
    });
  } catch (error) {
    return formatToolError(error);
  }
}

export const getWorkPackageShape = {
  workPackageId: z
    .number()
    .int()
    .positive()
    .describe("The numeric ID of the work package"),
};

export type GetWorkPackageArgs = z.infer<
  z.ZodObject<typeof getWorkPackageShape>
>;

/**
 * Tool execution handler for openproject_get_work_package.
 */
export async function handleGetWorkPackage(
  args: GetWorkPackageArgs
): Promise<McpToolResponse> {
  try {
    const result = await getWorkPackage(args.workPackageId);
    return formatToolSuccess(result);
  } catch (error) {
    return formatToolError(error);
  }
}

export const listWorkPackagesTool: ToolDefinition<
  typeof listWorkPackagesShape,
  ListWorkPackagesArgs
> = {
  name: "openproject_list_work_packages",
  description:
    "Browse and filter work packages (tasks, bugs, milestones, features) across projects or within a specific project",
  parameters: listWorkPackagesShape,
  readOnly: true,
  execute: handleListWorkPackages,
};

export const getWorkPackageTool: ToolDefinition<
  typeof getWorkPackageShape,
  GetWorkPackageArgs
> = {
  name: "openproject_get_work_package",
  description:
    "Get full details of a specific work package by its numeric ID, including status, priority, assignee, parent, and child relations",
  parameters: getWorkPackageShape,
  readOnly: true,
  execute: handleGetWorkPackage,
};

export const listWorkPackageActivitiesShape = {
  workPackageId: z
    .number()
    .int()
    .positive()
    .describe("Numeric ID of the work package"),
  onlyComments: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      "When true, filters out property change audits and returns only comments"
    ),
  query: z
    .string()
    .optional()
    .describe(
      "Optional search text. FILTERS the activity list down to relevant " +
        "entries and ranks them by relevance — activities that do not match " +
        "are omitted, so the returned timeline is not the complete history. " +
        "Omit this parameter to get the full, unfiltered list. Matched " +
        "against comment text and change details; tolerates typos."
    ),
  matchMode: z
    .enum(["fuzzy", "exact"])
    .optional()
    .default("fuzzy")
    .describe(
      "Matching strategy. 'fuzzy' (default) tolerates typos, word reordering, and " +
        "partial words. Use 'exact' only for literal strings you know verbatim."
    ),
};

export type ListWorkPackageActivitiesArgs = z.infer<
  z.ZodObject<typeof listWorkPackageActivitiesShape>
>;

/**
 * Tool execution handler for openproject_list_work_package_activities.
 */
export async function handleListWorkPackageActivities(
  args: ListWorkPackageActivitiesArgs
): Promise<McpToolResponse> {
  try {
    const result = await listWorkPackageActivities({
      workPackageId: args.workPackageId,
      onlyComments: args.onlyComments,
      query: args.query,
      matchMode: args.matchMode,
    });
    return formatToolSuccess(result);
  } catch (error) {
    return formatToolError(error);
  }
}

export const listWorkPackageActivitiesTool: ToolDefinition<
  typeof listWorkPackageActivitiesShape,
  ListWorkPackageActivitiesArgs
> = {
  name: "openproject_list_work_package_activities",
  description:
    "Retrieve timeline activities and comments for a work package. Can optionally filter to only include user comments. Supplying 'query' filters the timeline to relevant entries and ranks them, rather than reordering the full history.",
  parameters: listWorkPackageActivitiesShape,
  readOnly: true,
  execute: handleListWorkPackageActivities,
};

export const searchWorkPackagesShape = {
  query: z
    .string()
    .min(1)
    .describe(
      "Search text matched against work package subjects, descriptions, and " +
        "comments. Natural-language phrasing works and typos are tolerated."
    ),
  projectId: z
    .union([z.number().int().positive(), z.string().min(1)])
    .optional()
    .describe("Scope search to a specific project by numeric ID or slug identifier"),
  status: z
    .union([z.enum(["open", "closed"]), z.number().int().positive()])
    .optional()
    .describe("Filter by status: 'open', 'closed', or numeric status ID"),
  matchMode: z
    .enum(["fuzzy", "exact"])
    .optional()
    .default("fuzzy")
    .describe(
      "Matching strategy. 'fuzzy' (default) tolerates typos, word reordering, and " +
        "partial words. Use 'exact' only for literal strings you know verbatim."
    ),
  offset: z
    .number()
    .int()
    .positive()
    .optional()
    .default(1)
    .describe("Page number to retrieve (1-based, default 1)"),
  pageSize: z
    .number()
    .int()
    .positive()
    .max(100)
    .optional()
    .default(20)
    .describe("Number of items per page (max 100, default 20)"),
};

export type SearchWorkPackagesArgs = z.input<z.ZodObject<typeof searchWorkPackagesShape>>;

/**
 * Tool execution handler for openproject_search_work_packages.
 */
export async function handleSearchWorkPackages(
  args: SearchWorkPackagesArgs
): Promise<McpToolResponse> {
  try {
    const result = await searchWorkPackages(args.query, {
      projectId: args.projectId,
      status: args.status,
      matchMode: args.matchMode,
      offset: args.offset,
      pageSize: args.pageSize,
    });
    return formatToolSuccess(result);
  } catch (error) {
    return formatToolError(error);
  }
}

export const searchWorkPackagesTool: ToolDefinition<
  typeof searchWorkPackagesShape,
  SearchWorkPackagesArgs
> = {
  name: "openproject_search_work_packages",
  description:
    "Search work packages by subject, description, and comments. Accepts " +
    "natural-language phrasing and tolerates typos. Returns results ranked by " +
    "relevance with matching excerpts.",
  parameters: searchWorkPackagesShape,
  readOnly: true,
  execute: handleSearchWorkPackages,
};

export const workPackageTools = [
  listWorkPackagesTool,
  getWorkPackageTool,
  listWorkPackageActivitiesTool,
  searchWorkPackagesTool,
];

/**
 * Registers all work package tools with an McpServer instance.
 */
export function registerWorkPackageTools(server: McpServer): void {
  registerTool(server, listWorkPackagesTool);
  registerTool(server, getWorkPackageTool);
  registerTool(server, listWorkPackageActivitiesTool);
  registerTool(server, searchWorkPackagesTool);
}
