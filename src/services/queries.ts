/**
 * Queries Domain Service.
 */

import type { OpenProjectClient } from "../client/api-client.ts";
import {
  normalizeQuery,
  normalizeQuerySummary,
  normalizeWorkPackageSummary,
  unpackCollection,
} from "../client/hal-parser.ts";
import type {
  HalCollection,
  HalResource,
  PaginatedResult,
  QueryDetail,
  QuerySummary,
  WorkPackageSummary,
} from "../client/types.ts";
import { resolveClient } from "./helper.ts";

export interface ListQueriesParams {
  projectId?: number | string;
  pageSize?: number;
  offset?: number;
}

export interface QueryResultsParams {
  pageSize?: number;
  offset?: number;
}

/**
 * Lists saved queries, optionally filtered by project.
 */
export async function listQueries(
  params?: ListQueriesParams,
  client?: OpenProjectClient
): Promise<PaginatedResult<QuerySummary>> {
  const opClient = resolveClient(client);
  const query: Record<string, string | number | boolean | undefined> = {};

  if (params?.pageSize !== undefined) query.pageSize = params.pageSize;
  if (params?.offset !== undefined) query.offset = params.offset;

  if (params?.projectId !== undefined) {
    query.filters = JSON.stringify([
      { project: { operator: "=", values: [String(params.projectId)] } },
    ]);
  }

  const response = await opClient.get<HalCollection<HalResource>>("queries", query);
  return unpackCollection(response, normalizeQuerySummary);
}

/**
 * Retrieves details and structure of a saved query by its ID.
 */
export async function getQuery(
  id: number,
  client?: OpenProjectClient
): Promise<QueryDetail> {
  const opClient = resolveClient(client);
  const response = await opClient.get<HalResource>(`queries/${id}`);
  return normalizeQuery(response);
}

/**
 * Executes a saved query and returns its resulting work packages.
 */
export async function getQueryResults(
  id: number,
  params?: QueryResultsParams,
  client?: OpenProjectClient
): Promise<PaginatedResult<WorkPackageSummary>> {
  const opClient = resolveClient(client);
  const query: Record<string, string | number | boolean | undefined> = {};

  if (params?.pageSize !== undefined) query.pageSize = params.pageSize;
  if (params?.offset !== undefined) query.offset = params.offset;

  const response = await opClient.get<HalCollection<HalResource>>(
    `queries/${id}/results`,
    query
  );
  return unpackCollection(response, normalizeWorkPackageSummary);
}
