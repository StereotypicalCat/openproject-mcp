/**
 * Metadata Tools for OpenProject MCP.
 * Implements tools for inspecting OpenProject taxonomies and users:
 * - openproject_list_types
 * - openproject_list_statuses
 * - openproject_list_priorities
 * - openproject_list_users
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
  listTypes,
  listStatuses,
  listPriorities,
  listUsers,
} from "../services/metadata";

export const listTypesShape = {
  projectId: z
    .union([z.number().int().positive(), z.string().min(1)])
    .optional()
    .describe("Optional numeric project ID or identifier to scope types"),
};

export type ListTypesArgs = z.infer<z.ZodObject<typeof listTypesShape>>;

/**
 * Tool execution handler for openproject_list_types.
 */
export async function handleListTypes(
  args: ListTypesArgs = {}
): Promise<McpToolResponse> {
  try {
    const result = await listTypes(
      args.projectId !== undefined ? { projectId: args.projectId } : undefined
    );
    return formatToolSuccess({
      types: result,
    });
  } catch (error) {
    return formatToolError(error);
  }
}

export const listStatusesShape = {};

export type ListStatusesArgs = Record<string, unknown>;

/**
 * Tool execution handler for openproject_list_statuses.
 */
export async function handleListStatuses(
  _args: ListStatusesArgs = {}
): Promise<McpToolResponse> {
  try {
    const result = await listStatuses();
    return formatToolSuccess({
      statuses: result,
    });
  } catch (error) {
    return formatToolError(error);
  }
}

export const listPrioritiesShape = {};

export type ListPrioritiesArgs = Record<string, unknown>;

/**
 * Tool execution handler for openproject_list_priorities.
 */
export async function handleListPriorities(
  _args: ListPrioritiesArgs = {}
): Promise<McpToolResponse> {
  try {
    const result = await listPriorities();
    return formatToolSuccess({
      priorities: result,
    });
  } catch (error) {
    return formatToolError(error);
  }
}

export const listUsersShape = {
  pageSize: z
    .number()
    .int()
    .positive()
    .max(100)
    .optional()
    .describe("Number of users to return per page (max 100, default 20)"),
  offset: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Page number to retrieve (1-based, default 1)"),
  status: z
    .string()
    .optional()
    .describe("Filter users by status (e.g. 'active', 'locked', 'invited')"),
};

export type ListUsersArgs = z.infer<z.ZodObject<typeof listUsersShape>>;

/**
 * Tool execution handler for openproject_list_users.
 */
export async function handleListUsers(
  args: ListUsersArgs = {}
): Promise<McpToolResponse> {
  try {
    const result = await listUsers(args);
    return formatToolSuccess({
      users: result.items,
      total: result.total,
      count: result.count,
      pageSize: result.pageSize,
      offset: result.offset,
    });
  } catch (error) {
    return formatToolError(error);
  }
}

export const listTypesTool: ToolDefinition<
  typeof listTypesShape,
  ListTypesArgs
> = {
  name: "openproject_list_types",
  description:
    "List all available work package types (Task, Bug, Milestone, Feature, etc.), optionally scoped to a project",
  parameters: listTypesShape,
  readOnly: true,
  execute: handleListTypes,
};

export const listStatusesTool: ToolDefinition<
  typeof listStatusesShape,
  ListStatusesArgs
> = {
  name: "openproject_list_statuses",
  description:
    "List all available work package statuses (New, In Progress, Closed, etc.)",
  parameters: listStatusesShape,
  readOnly: true,
  execute: handleListStatuses,
};

export const listPrioritiesTool: ToolDefinition<
  typeof listPrioritiesShape,
  ListPrioritiesArgs
> = {
  name: "openproject_list_priorities",
  description: "List all priority levels (Low, Normal, High, Immediate)",
  parameters: listPrioritiesShape,
  readOnly: true,
  execute: handleListPriorities,
};

export const listUsersTool: ToolDefinition<
  typeof listUsersShape,
  ListUsersArgs
> = {
  name: "openproject_list_users",
  description: "List users in the OpenProject instance with optional pagination",
  parameters: listUsersShape,
  readOnly: true,
  execute: handleListUsers,
};

export const metadataTools = [
  listTypesTool,
  listStatusesTool,
  listPrioritiesTool,
  listUsersTool,
];

/**
 * Registers all metadata tools with an McpServer instance.
 */
export function registerMetadataTools(server: McpServer): void {
  registerTool(server, listTypesTool);
  registerTool(server, listStatusesTool);
  registerTool(server, listPrioritiesTool);
  registerTool(server, listUsersTool);
}
