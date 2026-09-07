/**
 * Wiki Tools for OpenProject MCP.
 * Implements openproject_get_wiki_page, openproject_search_wiki_pages, and openproject_list_wiki_page_links tools.
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
  getWikiPage,
  searchWikiPages,
  listWikiPageLinks,
} from "../services/wikis";

export const getWikiPageShape = {
  id: z
    .number()
    .int()
    .positive()
    .describe("Numeric ID of the wiki page"),
};

export type GetWikiPageArgs = z.input<z.ZodObject<typeof getWikiPageShape>>;

/**
 * Tool execution handler for openproject_get_wiki_page.
 */
export async function handleGetWikiPage(
  args: GetWikiPageArgs
): Promise<McpToolResponse> {
  try {
    const result = await getWikiPage(args.id);
    return formatToolSuccess(result);
  } catch (error) {
    return formatToolError(error);
  }
}

export const searchWikiPagesShape = {
  query: z
    .string()
    .optional()
    .describe("Substring keyword to match in wiki page title"),
  projectId: z
    .union([z.number().int().positive(), z.string().min(1)])
    .optional()
    .describe("Project ID or identifier to scope search"),
  limit: z
    .number()
    .int()
    .positive()
    .max(100)
    .optional()
    .default(20)
    .describe("Maximum results to return"),
  refreshCache: z
    .boolean()
    .optional()
    .default(false)
    .describe("Force cache refresh"),
};

export type SearchWikiPagesArgs = z.input<z.ZodObject<typeof searchWikiPagesShape>>;

/**
 * Tool execution handler for openproject_search_wiki_pages.
 */
export async function handleSearchWikiPages(
  args: SearchWikiPagesArgs
): Promise<McpToolResponse> {
  try {
    const result = await searchWikiPages(args);
    return formatToolSuccess(result);
  } catch (error) {
    return formatToolError(error);
  }
}

export const listWikiPageLinksShape = {
  workPackageId: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Work package ID to scope links"),
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
    .default(30)
    .describe("Number of items per page (max 100, default 30)"),
};

export type ListWikiPageLinksArgs = z.input<
  z.ZodObject<typeof listWikiPageLinksShape>
>;

/**
 * Tool execution handler for openproject_list_wiki_page_links.
 */
export async function handleListWikiPageLinks(
  args: ListWikiPageLinksArgs
): Promise<McpToolResponse> {
  try {
    const result = await listWikiPageLinks(args);
    return formatToolSuccess(result);
  } catch (error) {
    return formatToolError(error);
  }
}

export const getWikiPageTool: ToolDefinition<
  typeof getWikiPageShape,
  GetWikiPageArgs
> = {
  name: "openproject_get_wiki_page",
  description: "Retrieve wiki page metadata, project, and attachments by numeric ID.",
  parameters: getWikiPageShape,
  readOnly: true,
  execute: handleGetWikiPage,
};

export const searchWikiPagesTool: ToolDefinition<
  typeof searchWikiPagesShape,
  SearchWikiPagesArgs
> = {
  name: "openproject_search_wiki_pages",
  description: "Discover and search wiki pages matching keywords or project.",
  parameters: searchWikiPagesShape,
  readOnly: true,
  execute: handleSearchWikiPages,
};

export const listWikiPageLinksTool: ToolDefinition<
  typeof listWikiPageLinksShape,
  ListWikiPageLinksArgs
> = {
  name: "openproject_list_wiki_page_links",
  description: "List links connecting work packages to wiki pages.",
  parameters: listWikiPageLinksShape,
  readOnly: true,
  execute: handleListWikiPageLinks,
};

export const wikisTools = [
  getWikiPageTool,
  searchWikiPagesTool,
  listWikiPageLinksTool,
];

/**
 * Registers all wikis tools with an McpServer instance.
 */
export function registerWikisTools(server: McpServer): void {
  registerTool(server, getWikiPageTool);
  registerTool(server, searchWikiPagesTool);
  registerTool(server, listWikiPageLinksTool);
}
