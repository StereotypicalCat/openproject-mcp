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
    "Retrieve timeline activities and comments for a work package. Can optionally filter to only include user comments.",
  parameters: listWorkPackageActivitiesShape,
  readOnly: true,
  execute: handleListWorkPackageActivities,
};

export const workPackageTools = [
  listWorkPackagesTool,
  getWorkPackageTool,
  listWorkPackageActivitiesTool,
];

/**
 * Registers all work package tools with an McpServer instance.
 */
export function registerWorkPackageTools(server: McpServer): void {
  registerTool(server, listWorkPackagesTool);
  registerTool(server, getWorkPackageTool);
  registerTool(server, listWorkPackageActivitiesTool);
}
