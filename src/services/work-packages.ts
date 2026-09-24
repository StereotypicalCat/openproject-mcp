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
import { isFatalSearchError, searchPipeline } from "../search/pipeline.ts";
import { rankRecords, type FieldSpec, type MatchMode } from "../search/rank.ts";

export interface ListWorkPackagesParams extends WorkPackageFilterParams {
  pageSize?: number;
  offset?: number;
  sortBy?: string;
}

export interface SearchWorkPackagesOptions {
  projectId?: number | string;
  pageSize?: number;
  offset?: number;
  status?: "open" | "closed" | string | number;
  typeId?: number | string;
  assigneeId?: number | string;
  matchMode?: MatchMode;
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

export interface WorkPackageSearchResult {
  workPackage: WorkPackageSummary;
  /** Relevance score in the range 0..1. */
  score: number;
  matchedFields: string[];
  snippet?: string;
}

/**
 * Search results are exposed under `elements` only. `items` is deliberately
 * omitted: the tool layer JSON-stringifies this whole object, so carrying the
 * same array twice doubles the token cost of every search response.
 */
export interface WorkPackageSearchPage
  extends Omit<PaginatedResult<WorkPackageSearchResult>, "items"> {
  elements: WorkPackageSearchResult[];
  degraded: boolean;
  enrichmentFailures: number;
}

interface WorkPackageDeepContent {
  id: number;
  description: string;
  comments: string[];
}

const MAX_WORK_PACKAGE_CANDIDATES = 250;
/**
 * OpenProject enforces a server-side maximum page size, and every tool shape
 * in this repo caps `pageSize` at 100. Asking for 250 in a single request
 * therefore risks silently receiving fewer candidates than the code assumes,
 * so the candidate window is paged in batches instead.
 */
const CANDIDATE_BATCH_SIZE = 100;

/**
 * Fetches the description and comment text for one work package.
 */
async function fetchWorkPackageDeepContent(
  workPackageId: number,
  client: OpenProjectClient
): Promise<WorkPackageDeepContent> {
  const [detail, activities] = await Promise.all([
    getWorkPackage(workPackageId, client),
    listWorkPackageActivities({ workPackageId, onlyComments: true }, client),
  ]);

  return {
    id: workPackageId,
    description: detail.description ?? "",
    comments: activities
      .map((activity) => activity.comment ?? "")
      .filter((comment) => comment.length > 0),
  };
}

/**
 * Searches work packages by subject, description, and comments using fuzzy
 * matching.
 *
 * Candidates come from the union of two parallel requests: the precise
 * server-side `subject ~ query` filter (so every result the old
 * implementation returned is still returned) and a broad recency-ordered
 * window (so fuzzy matching has something to rank). Fuzzy matching therefore
 * only ever adds results, never removes them.
 */
export async function searchWorkPackages(
  query: string,
  options?: SearchWorkPackagesOptions,
  client?: OpenProjectClient
): Promise<WorkPackageSearchPage> {
  const opClient = resolveClient(client);
  const matchMode = options?.matchMode ?? "fuzzy";

  const sharedFilters = {
    projectId: options?.projectId,
    status: options?.status,
    typeId: options?.typeId,
    assigneeId: options?.assigneeId,
  };

  // A non-fatal failure on one leg (e.g. a transient 500) must not kill the
  // whole search: the other leg's candidates are still worth ranking. A
  // fatal failure (401/403/429) must propagate rather than degrade into "0
  // candidates" — an expired token must not be reported to the model as "no
  // results found".
  const listCandidates = async (
    params: ListWorkPackagesParams
  ): Promise<{ items: WorkPackageSummary[]; total: number }> => {
    try {
      return await listWorkPackages(params, opClient);
    } catch (error: unknown) {
      if (isFatalSearchError(error)) {
        throw error;
      }
      return { items: [], total: 0 };
    }
  };

  /**
   * Accumulates one candidate leg in server-acceptable batches, up to the
   * shared 250 cap. Stops once the server says the collection is exhausted
   * (`collected.length >= total`) or hands back a short page.
   */
  const collectLeg = async (
    params: ListWorkPackagesParams
  ): Promise<WorkPackageSummary[]> => {
    const collected: WorkPackageSummary[] = [];
    let offset = 1;

    while (collected.length < MAX_WORK_PACKAGE_CANDIDATES) {
      const page = await listCandidates({
        ...params,
        pageSize: CANDIDATE_BATCH_SIZE,
        offset,
      });

      if (page.items.length === 0) {
        break;
      }
      collected.push(...page.items);

      if (collected.length >= page.total || page.items.length < CANDIDATE_BATCH_SIZE) {
        break;
      }
      offset += 1;
    }

    return collected.slice(0, MAX_WORK_PACKAGE_CANDIDATES);
  };

  // Both legs run in every match mode. Exact mode must not be restricted to
  // the server-side subject filter: the literal strings a caller reaches for
  // exact mode with (error codes, ticket refs, commit SHAs) overwhelmingly
  // live in descriptions and comments, which only the broad leg can surface.
  const fetchCandidates = async (): Promise<WorkPackageSummary[]> => {
    const [precise, broad] = await Promise.all([
      collectLeg({ ...sharedFilters, subject: query }),
      collectLeg({ ...sharedFilters, sortBy: '[["updatedAt","desc"]]' }),
    ]);

    // Precise leg first: on a collision the exact subject match wins the slot,
    // so exact matches always survive the 250 cap.
    const byId = new Map<number, WorkPackageSummary>();
    for (const item of [...precise, ...broad]) {
      byId.set(item.id, item);
    }
    return Array.from(byId.values()).slice(0, MAX_WORK_PACKAGE_CANDIDATES);
  };

  const shallowFields: FieldSpec<WorkPackageSummary>[] = [
    { name: "subject", weight: 3, extract: (wp) => wp.subject },
  ];

  const deepFields: FieldSpec<WorkPackageDeepContent>[] = [
    { name: "description", weight: 1, extract: (d) => d.description },
    { name: "comments", weight: 1, extract: (d) => d.comments },
  ];

  const result = await searchPipeline<WorkPackageSummary, WorkPackageDeepContent>(
    {
      fetchCandidates,
      shallowFields,
      enrich: (workPackage) => fetchWorkPackageDeepContent(workPackage.id, opClient),
      deepFields,
      recencyOf: (workPackage) => workPackage.updatedAt ?? "",
      idOf: (workPackage) => workPackage.id,
    },
    query,
    { matchMode }
  );

  const all: WorkPackageSearchResult[] = result.ranked.map((entry) => ({
    workPackage: entry.record,
    score: entry.score,
    matchedFields: entry.matches.map((match) => match.field),
    snippet: entry.matches[0]?.snippet,
  }));

  // `offset` is a 1-based PAGE number, as the tool schema documents and as the
  // rest of this codebase and the OpenProject API treat it — not an item index.
  const offset = options?.offset ?? 1;
  const pageSize = options?.pageSize ?? 20;
  const startIndex = Math.max(0, offset - 1) * pageSize;
  const paged = all.slice(startIndex, startIndex + pageSize);

  return {
    total: all.length,
    count: paged.length,
    pageSize,
    offset,
    elements: paged,
    degraded: result.degraded,
    enrichmentFailures: result.enrichmentFailures,
  };
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
  /** Ranks the fetched activities client-side. No extra API calls. */
  query?: string;
  matchMode?: MatchMode;
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

  const query = options.query?.trim() ?? "";
  if (query.length === 0) {
    return activities;
  }

  const fields: FieldSpec<WorkPackageActivity>[] = [
    { name: "comment", weight: 3, extract: (activity) => activity.comment },
    {
      name: "details",
      weight: 1,
      extract: (activity) => activity.details.map((detail) => detail.raw),
    },
  ];

  return rankRecords(activities, query, fields, {
    matchMode: options.matchMode ?? "fuzzy",
  }).map((entry) => entry.record);
}

