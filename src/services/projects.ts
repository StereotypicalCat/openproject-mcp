/**
 * Projects Domain Service.
 */

import type { OpenProjectClient } from "../client/api-client.ts";
import {
  normalizeProject,
  normalizeProjectSummary,
  unpackCollection,
} from "../client/hal-parser.ts";
import type {
  FilterElement,
  HalCollection,
  HalResource,
  PaginatedResult,
  ProjectDetail,
  ProjectSummary,
} from "../client/types.ts";
import { resolveClient } from "./helper.ts";

export interface ListProjectsParams {
  pageSize?: number;
  offset?: number;
  sortBy?: string;
  filters?: FilterElement[];
}

/**
 * Lists projects accessible to the authenticated user.
 */
export async function listProjects(
  params?: ListProjectsParams,
  client?: OpenProjectClient
): Promise<PaginatedResult<ProjectSummary>> {
  const opClient = resolveClient(client);
  const query: Record<string, string | number | boolean | undefined> = {};

  if (params?.pageSize !== undefined) query.pageSize = params.pageSize;
  if (params?.offset !== undefined) query.offset = params.offset;
  if (params?.sortBy !== undefined) query.sortBy = params.sortBy;
  if (params?.filters && params.filters.length > 0) {
    query.filters = JSON.stringify(params.filters);
  }

  const response = await opClient.get<HalCollection<HalResource>>("projects", query);
  return unpackCollection(response, normalizeProjectSummary);
}

/**
 * Retrieves a single project by its numeric ID or string identifier.
 */
export async function getProject(
  idOrIdentifier: number | string,
  client?: OpenProjectClient
): Promise<ProjectDetail> {
  const opClient = resolveClient(client);
  const response = await opClient.get<HalResource>(`projects/${idOrIdentifier}`);
  return normalizeProject(response);
}

/**
 * Retrieves the schema definition for projects.
 */
export async function getProjectSchema(
  client?: OpenProjectClient
): Promise<Record<string, unknown>> {
  const opClient = resolveClient(client);
  return opClient.get<Record<string, unknown>>("projects/schema");
}
