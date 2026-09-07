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

export interface ActivityDetail {
  format: string;
  raw: string;
  html?: string;
}

export interface WorkPackageActivity {
  id: number;
  version: number;
  createdAt: string;
  user?: { id: number; name: string };
  comment?: string;
  details: ActivityDetail[];
  isComment: boolean;
}

export interface ListWorkPackageActivitiesOptions {
  workPackageId: number;
  onlyComments?: boolean;
}

/**
 * Lists activities (field changes, comments, status updates) for a specific work package.
 */
export async function listWorkPackageActivities(
  options: ListWorkPackageActivitiesOptions,
  client?: OpenProjectClient
): Promise<WorkPackageActivity[]> {
  const opClient = resolveClient(client);
  const response = await opClient.get<Record<string, unknown>>(
    `/api/v3/work_packages/${options.workPackageId}/activities`
  );

  const elements = (response._embedded as { elements?: unknown[] })?.elements ?? [];
  const activities: WorkPackageActivity[] = [];

  for (const item of elements) {
    const rawItem = item as Record<string, unknown>;
    const commentObj = rawItem.comment as { raw?: string } | undefined;
    const commentRaw = typeof commentObj?.raw === "string" ? commentObj.raw.trim() : "";
    const isComment = commentRaw.length > 0;

    if (options.onlyComments && !isComment) {
      continue;
    }

    const links = (rawItem._links as Record<string, { href?: string; title?: string }>) ?? {};
    const userLink = links.user;
    let user: { id: number; name: string } | undefined;
    if (userLink?.href) {
      const match = userLink.href.match(/\/users\/(\d+)/);
      if (match) {
        user = {
          id: Number(match[1]),
          name: userLink.title ?? `User #${match[1]}`
        };
      }
    }

    const rawDetails = (rawItem.details as Array<{ format?: string; raw?: string; html?: string }>) ?? [];
    const details: ActivityDetail[] = rawDetails.map((d) => ({
      format: d.format ?? "custom",
      raw: d.raw ?? "",
      html: d.html,
    }));

    activities.push({
      id: Number(rawItem.id),
      version: Number(rawItem.version ?? 1),
      createdAt: String(rawItem.createdAt ?? ""),
      user,
      comment: commentRaw || undefined,
      details,
      isComment,
    });
  }

  return activities;
}

