/**
 * Meeting Tools for OpenProject MCP.
 * Implements openproject_list_meetings, openproject_get_meeting, and openproject_search_meetings tools.
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
  listMeetings,
  getMeeting,
  searchMeetings,
} from "../services/meetings";

export const listMeetingsShape = {
  projectId: z
    .union([z.number().int().positive(), z.string().min(1)])
    .optional()
    .describe("Filter meetings by project ID or identifier"),
  time: z
    .string()
    .optional()
    .describe("Filter by meeting time context ('upcoming' or 'past')"),
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

export type ListMeetingsArgs = z.input<z.ZodObject<typeof listMeetingsShape>>;

/**
 * Tool execution handler for openproject_list_meetings.
 */
export async function handleListMeetings(
  args: ListMeetingsArgs
): Promise<McpToolResponse> {
  try {
    const result = await listMeetings(args);
    return formatToolSuccess(result);
  } catch (error) {
    return formatToolError(error);
  }
}

export const getMeetingShape = {
  id: z
    .number()
    .int()
    .positive()
    .describe("Numeric ID of the meeting"),
  includeAgendaItems: z
    .boolean()
    .optional()
    .default(true)
    .describe("Whether to include agenda items and outcomes (default true)"),
};

export type GetMeetingArgs = z.input<z.ZodObject<typeof getMeetingShape>>;

/**
 * Tool execution handler for openproject_get_meeting.
 */
export async function handleGetMeeting(
  args: GetMeetingArgs
): Promise<McpToolResponse> {
  try {
    const result = await getMeeting(args.id, {
      includeAgendaItems: args.includeAgendaItems ?? true,
    });
    return formatToolSuccess(result);
  } catch (error) {
    return formatToolError(error);
  }
}

export const searchMeetingsShape = {
  query: z
    .string()
    .min(1)
    .describe(
      "Search keywords to match across meeting titles, locations, and agenda item notes"
    ),
  projectId: z
    .union([z.number().int().positive(), z.string().min(1)])
    .optional()
    .describe("Scope search to a specific project by numeric ID or slug identifier"),
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

export type SearchMeetingsArgs = z.input<z.ZodObject<typeof searchMeetingsShape>>;

/**
 * Tool execution handler for openproject_search_meetings.
 */
export async function handleSearchMeetings(
  args: SearchMeetingsArgs
): Promise<McpToolResponse> {
  try {
    const result = await searchMeetings(args);
    return formatToolSuccess(result);
  } catch (error) {
    return formatToolError(error);
  }
}

export const listMeetingsTool: ToolDefinition<
  typeof listMeetingsShape,
  ListMeetingsArgs
> = {
  name: "openproject_list_meetings",
  description: "List and filter meetings visible to the user.",
  parameters: listMeetingsShape,
  readOnly: true,
  execute: handleListMeetings,
};

export const getMeetingTool: ToolDefinition<
  typeof getMeetingShape,
  GetMeetingArgs
> = {
  name: "openproject_get_meeting",
  description:
    "Retrieve detailed meeting information including agenda items, sections, notes, and participants.",
  parameters: getMeetingShape,
  readOnly: true,
  execute: handleGetMeeting,
};

export const searchMeetingsTool: ToolDefinition<
  typeof searchMeetingsShape,
  SearchMeetingsArgs
> = {
  name: "openproject_search_meetings",
  description: "Search across meetings and agenda items by keywords.",
  parameters: searchMeetingsShape,
  readOnly: true,
  execute: handleSearchMeetings,
};

export const meetingsTools = [
  listMeetingsTool,
  getMeetingTool,
  searchMeetingsTool,
];

/**
 * Registers all meetings tools with an McpServer instance.
 */
export function registerMeetingsTools(server: McpServer): void {
  registerTool(server, listMeetingsTool);
  registerTool(server, getMeetingTool);
  registerTool(server, searchMeetingsTool);
}
