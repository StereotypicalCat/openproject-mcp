/**
 * Project Tools for OpenProject MCP.
 * Implements openproject_list_projects and openproject_get_project tools.
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
import { listProjects, getProject } from "../services/projects";
import type { FilterElement } from "../client/types";

export const listProjectsShape = {
  pageSize: z
    .number()
    .int()
    .positive()
    .max(100)
    .optional()
    .describe("Number of projects to return per page (max 100, default 20)"),
  offset: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Page number to retrieve (1-based, default 1)"),
  sortBy: z
    .string()
    .optional()
    .describe("Sorting criteria (e.g. 'name:asc', 'id:desc')"),
  filters: z
    .string()
    .optional()
    .describe("Optional raw OpenProject JSON filters string"),
};

export type ListProjectsArgs = z.infer<z.ZodObject<typeof listProjectsShape>>;

export async function handleListProjects(
  args: ListProjectsArgs
): Promise<McpToolResponse> {
  try {
    let filters: FilterElement[] | undefined;
    if (args.filters) {
      filters = JSON.parse(args.filters) as FilterElement[];
    }

    const result = await listProjects({
      pageSize: args.pageSize,
      offset: args.offset,
      sortBy: args.sortBy,
      filters,
    });

    return formatToolSuccess({
      projects: result.items,
      total: result.total,
      count: result.count,
      pageSize: result.pageSize,
      offset: result.offset,
    });
  } catch (error) {
    return formatToolError(error);
  }
}

export const getProjectShape = {
  projectId: z
    .union([z.number().int().positive(), z.string()])
    .describe("Numeric project ID or string identifier/slug"),
};

export type GetProjectArgs = z.infer<z.ZodObject<typeof getProjectShape>>;

export async function handleGetProject(
  args: GetProjectArgs
): Promise<McpToolResponse> {
  try {
    const result = await getProject(args.projectId);
    return formatToolSuccess(result);
  } catch (error) {
    return formatToolError(error);
  }
}

export const listProjectsTool: ToolDefinition<
  typeof listProjectsShape,
  ListProjectsArgs
> = {
  name: "openproject_list_projects",
  description:
    "List OpenProject projects accessible to the authenticated user with optional pagination and sorting",
  parameters: listProjectsShape,
  readOnly: true,
  execute: handleListProjects,
};

export const getProjectTool: ToolDefinition<
  typeof getProjectShape,
  GetProjectArgs
> = {
  name: "openproject_get_project",
  description:
    "Retrieve detailed information for a single project by its numeric ID or string identifier (slug)",
  parameters: getProjectShape,
  readOnly: true,
  execute: handleGetProject,
};

export const projectTools = [listProjectsTool, getProjectTool];

export function registerProjectTools(server: McpServer): void {
  registerTool(server, listProjectsTool);
  registerTool(server, getProjectTool);
}
