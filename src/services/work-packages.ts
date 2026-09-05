/**
 * Work Packages Domain Service.
 */

import type { OpenProjectClient } from "../client/api-client.ts";
import { buildWorkPackageFilters } from "../client/filter-builder.ts";
import {
  normalizeWorkPackage,
  normalizeWorkPackageSummary,
  unpackCollection,
} from "../client/hal-parser.ts";
import type {
  HalCollection,
  HalResource,
  PaginatedResult,
  WorkPackageDetail,
  WorkPackageFilterParams,
  WorkPackageSummary,
} from "../client/types.ts";
import { resolveClient, resolveProjectId } from "./helper.ts";

export interface ListWorkPackagesParams extends WorkPackageFilterParams {
  pageSize?: number;
  offset?: number;
  sortBy?: string;
}

export interface SearchWorkPackagesOptions {
  projectId?: number | string;
  pageSize?: number;
  offset?: number;
}

/**
 * Lists work packages matching filters and pagination options.
 */
export async function listWorkPackages(
  params?: ListWorkPackagesParams,
  client?: OpenProjectClient
): Promise<PaginatedResult<WorkPackageSummary>> {
  const opClient = resolveClient(client);
  const query: Record<string, string | number | boolean | undefined> = {};

  if (params?.pageSize !== undefined) query.pageSize = params.pageSize;
  if (params?.offset !== undefined) query.offset = params.offset;
  if (params?.sortBy !== undefined) query.sortBy = params.sortBy;

  if (params) {
    let filterParams = params;
    if (params.projectId !== undefined && params.projectId !== "") {
      const numericProjectId = await resolveProjectId(params.projectId, opClient);
      filterParams = { ...params, projectId: numericProjectId };
    }
    const filters = buildWorkPackageFilters(filterParams);
    if (filters.length > 0) {
      query.filters = JSON.stringify(filters);
    }
  }

  const response = await opClient.get<HalCollection<HalResource>>("work_packages", query);
  return unpackCollection(response, normalizeWorkPackageSummary);
}

/**
 * Retrieves details for a specific work package by its numeric ID.
 */
export async function getWorkPackage(
  id: number,
  client?: OpenProjectClient
): Promise<WorkPackageDetail> {
  const opClient = resolveClient(client);
  const response = await opClient.get<HalResource>(`work_packages/${id}`);
  return normalizeWorkPackage(response);
}

/**
 * Convenience helper to search work packages by subject text, optionally within a project.
 */
export async function searchWorkPackages(
  query: string,
  options?: SearchWorkPackagesOptions,
  client?: OpenProjectClient
): Promise<PaginatedResult<WorkPackageSummary>> {
  return listWorkPackages(
    {
      subject: query,
      projectId: options?.projectId,
      pageSize: options?.pageSize,
      offset: options?.offset,
    },
    client
  );
}
