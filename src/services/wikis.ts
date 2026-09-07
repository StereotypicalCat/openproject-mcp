/**
 * Wikis Domain Service.
 * Provides functions to inspect, search, and list OpenProject wiki pages and wiki page links.
 */

import {
  OpenProjectAuthenticationError,
  type OpenProjectClient,
} from "../client/api-client.ts";
import { extractIdFromHref } from "../client/hal-parser.ts";
import type { HalCollection, HalLink, HalResource } from "../client/types.ts";
import { resolveClient, resolveProjectId } from "./helper.ts";

export interface WikiPageAttachment {
  id: number;
  fileName: string;
  fileSize: number;
  contentType: string;
  downloadUrl: string;
}

export interface WikiPageDetail {
  id: number;
  title: string;
  project: { id: number; identifier?: string; name?: string };
  attachments: WikiPageAttachment[];
}

export interface WikiPageSummary {
  id: number;
  title: string;
  project: { id: number; identifier?: string; name?: string };
  attachmentsCount: number;
}

export interface WikiPageLink {
  id: number;
  pageTitle?: string;
  pageUrl?: string;
  provider?: string;
  workPackage?: { id: number; title?: string };
}

export interface PaginatedResult<T> {
  total: number;
  count: number;
  pageSize: number;
  offset: number;
  elements: T[];
  items?: T[];
}

export interface ListWikiPageLinksParams {
  workPackageId?: number;
  offset?: number;
  pageSize?: number;
}

export interface SearchWikiPagesParams {
  query?: string;
  projectId?: string | number;
  limit?: number;
  refreshCache?: boolean;
}

// In-memory cache for discovered wiki pages keyed by client cache key
const wikiPagesCache = new Map<string, Map<number, WikiPageDetail>>();
const discoveredCacheKeys = new Set<string>();

/**
 * Clears the in-memory wiki discovery cache.
 */
export function clearWikiCache(): void {
  wikiPagesCache.clear();
  discoveredCacheKeys.clear();
}

/**
 * Normalizes a raw HAL attachment resource into a WikiPageAttachment.
 */
export function normalizeWikiAttachment(element: HalResource): WikiPageAttachment {
  const links = (element._links ?? {}) as Record<string, HalLink | undefined>;
  const downloadHref =
    (links.downloadLocation as HalLink | undefined)?.href ??
    (links.self as HalLink | undefined)?.href ??
    "";

  return {
    id: element.id ?? extractIdFromHref(downloadHref) ?? 0,
    fileName: String(element.fileName ?? element.name ?? ""),
    fileSize: Number(element.fileSize ?? element.size ?? 0),
    contentType: String(element.contentType ?? element.mimeType ?? ""),
    downloadUrl: downloadHref,
  };
}

/**
 * Normalizes a raw HAL WikiPage resource and its attachments into a WikiPageDetail.
 */
export function normalizeWikiPageDetail(
  resource: HalResource,
  attachments: WikiPageAttachment[] = []
): WikiPageDetail {
  const links = (resource._links ?? {}) as Record<string, HalLink | undefined>;
  const projectLink = links.project;
  const embedded = (resource._embedded ?? {}) as Record<string, unknown>;
  const embeddedProject = embedded.project as { id?: number; identifier?: string; name?: string } | undefined;

  const projectId = extractIdFromHref(projectLink?.href) ?? embeddedProject?.id ?? 0;
  const projectName = projectLink?.title ?? embeddedProject?.name;
  const projectIdentifier =
    embeddedProject?.identifier ?? (projectLink as { identifier?: string } | undefined)?.identifier;

  const project: { id: number; identifier?: string; name?: string } = {
    id: projectId,
    ...(projectIdentifier ? { identifier: projectIdentifier } : {}),
    ...(projectName ? { name: projectName } : {}),
  };

  const id = resource.id ?? extractIdFromHref(links.self?.href) ?? 0;
  const title = String(resource.title ?? "");

  return {
    id,
    title,
    project,
    attachments,
  };
}

/**
 * Converts a WikiPageDetail into a token-efficient WikiPageSummary.
 */
export function toWikiPageSummary(detail: WikiPageDetail): WikiPageSummary {
  return {
    id: detail.id,
    title: detail.title,
    project: detail.project,
    attachmentsCount: detail.attachments.length,
  };
}

/**
 * Normalizes a raw HAL WikiPageLink resource into a clean WikiPageLink.
 */
export function normalizeWikiPageLink(resource: HalResource): WikiPageLink {
  const links = (resource._links ?? {}) as Record<string, HalLink | undefined>;
  const selfLink = links.self;
  const wpLink = links.workPackage;
  const wikiPageLink = links.wikiPage ?? links["wiki_page"];

  const embedded = (resource._embedded ?? {}) as Record<string, unknown>;
  const embeddedWp = embedded.workPackage as { id?: number; subject?: string; title?: string } | undefined;

  const id = resource.id ?? extractIdFromHref(selfLink?.href) ?? 0;
  const pageTitle =
    (typeof resource.pageTitle === "string" ? resource.pageTitle : undefined) ??
    (typeof resource.title === "string" ? resource.title : undefined) ??
    wikiPageLink?.title;

  const pageUrl =
    (typeof resource.pageUrl === "string" ? resource.pageUrl : undefined) ??
    (typeof resource.url === "string" ? resource.url : undefined) ??
    wikiPageLink?.href;

  const provider = typeof resource.provider === "string" ? resource.provider : undefined;

  const wpId = extractIdFromHref(wpLink?.href) ?? embeddedWp?.id;
  const wpTitle = wpLink?.title ?? embeddedWp?.title ?? embeddedWp?.subject;

  const workPackage =
    wpId !== undefined
      ? {
          id: wpId,
          ...(wpTitle ? { title: wpTitle } : {}),
        }
      : undefined;

  return {
    id,
    ...(pageTitle ? { pageTitle } : {}),
    ...(pageUrl ? { pageUrl } : {}),
    ...(provider ? { provider } : {}),
    ...(workPackage ? { workPackage } : {}),
  };
}

/**
 * Retrieves a single wiki page by ID including its attachments.
 */
export async function getWikiPage(
  id: number,
  client?: OpenProjectClient
): Promise<WikiPageDetail> {
  const opClient = resolveClient(client);
  const pageResource = await opClient.get<HalResource>(`/api/v3/wiki_pages/${id}`);

  let attachments: WikiPageAttachment[] = [];
  try {
    const attachmentsResponse = await opClient.get<HalCollection<HalResource>>(
      `/api/v3/wiki_pages/${id}/attachments`
    );
    if (attachmentsResponse._embedded?.elements) {
      attachments = attachmentsResponse._embedded.elements.map(normalizeWikiAttachment);
    }
  } catch {
    // If attachments collection cannot be retrieved, default to empty list
  }

  const detail = normalizeWikiPageDetail(pageResource, attachments);

  // Update in-memory cache for this client cache key if initialized
  const cacheKey = opClient.getCacheKey?.() ?? (opClient.baseUrl || "default");
  let cacheMap = wikiPagesCache.get(cacheKey);
  if (!cacheMap) {
    cacheMap = new Map<number, WikiPageDetail>();
    wikiPagesCache.set(cacheKey, cacheMap);
  }
  cacheMap.set(detail.id, detail);

  return detail;
}

/**
 * Lists wiki page links, optionally filtered by work package ID.
 */
export async function listWikiPageLinks(
  params?: ListWikiPageLinksParams,
  client?: OpenProjectClient
): Promise<PaginatedResult<WikiPageLink>> {
  const opClient = resolveClient(client);
  const path =
    params?.workPackageId !== undefined
      ? `/api/v3/work_packages/${params.workPackageId}/wiki_page_links`
      : `/api/v3/wiki_page_links`;

  const query: Record<string, string | number | boolean | undefined> = {};
  if (params?.offset !== undefined) query.offset = params.offset;
  if (params?.pageSize !== undefined) query.pageSize = params.pageSize;

  const response = await opClient.get<HalCollection<HalResource>>(path, query);
  const items = (response._embedded?.elements ?? []).map(normalizeWikiPageLink);

  return {
    total: response.total ?? items.length,
    count: response.count ?? items.length,
    pageSize: response.pageSize ?? items.length,
    offset: response.offset ?? 1,
    elements: items,
    items,
  };
}

/**
 * Searches wiki pages using in-memory caching and smart discovery scanning.
 */
export async function searchWikiPages(
  params?: SearchWikiPagesParams,
  client?: OpenProjectClient
): Promise<WikiPageSummary[]> {
  const opClient = resolveClient(client);
  const cacheKey = opClient.getCacheKey?.() ?? (opClient.baseUrl || "default");

  let cacheMap = wikiPagesCache.get(cacheKey);
  const needsDiscovery = !cacheMap || !discoveredCacheKeys.has(cacheKey) || params?.refreshCache;

  if (params?.refreshCache && cacheMap) {
    cacheMap.clear();
  }

  if (!cacheMap) {
    cacheMap = new Map<number, WikiPageDetail>();
    wikiPagesCache.set(cacheKey, cacheMap);
  }

  if (needsDiscovery) {
    // 1. Check wiki_page_links to collect referenced wiki page IDs
    const discoveredIds = new Set<number>();
    try {
      const linksResponse = await opClient.get<HalCollection<HalResource>>("/api/v3/wiki_page_links", {
        pageSize: 100,
      });
      const elements = linksResponse._embedded?.elements ?? [];
      for (const element of elements) {
        const links = (element._links ?? {}) as Record<string, HalLink | undefined>;
        const wikiPageLink = links.wikiPage ?? links["wiki_page"];
        const idFromLink = extractIdFromHref(wikiPageLink?.href);
        if (idFromLink !== undefined) {
          discoveredIds.add(idFromLink);
        }
        if (element.pageUrl && typeof element.pageUrl === "string") {
          const idFromUrl = extractIdFromHref(element.pageUrl);
          if (idFromUrl !== undefined) {
            discoveredIds.add(idFromUrl);
          }
        }
      }
    } catch (err: unknown) {
      if (
        err instanceof OpenProjectAuthenticationError ||
        (err as { statusCode?: number })?.statusCode === 401 ||
        (err as { statusCode?: number })?.statusCode === 403 ||
        (err as { statusCode?: number })?.statusCode === 429
      ) {
        throw err;
      }
      // Ignore errors if wiki_page_links is not supported or accessible (e.g. 404)
    }

    // 2. Sequential probing of IDs 1..MAX_PROBE_ID with consecutive 404 cutoff
    const MAX_PROBE_ID = 50;
    const CONSECUTIVE_404_CUTOFF = 5;
    let consecutiveMisses = 0;

    for (let id = 1; id <= MAX_PROBE_ID; id++) {
      try {
        const pageDetail = await getWikiPage(id, opClient);
        cacheMap.set(id, pageDetail);
        consecutiveMisses = 0;
      } catch (err: unknown) {
        if (
          err instanceof OpenProjectAuthenticationError ||
          (err as { statusCode?: number })?.statusCode === 401 ||
          (err as { statusCode?: number })?.statusCode === 403 ||
          (err as { statusCode?: number })?.statusCode === 429
        ) {
          throw err;
        }
        if ((err as { statusCode?: number })?.statusCode === 404) {
          consecutiveMisses++;
        }
        if (consecutiveMisses >= CONSECUTIVE_404_CUTOFF) {
          break;
        }
      }
    }

    // Also fetch any referenced wiki page IDs discovered from wiki_page_links that weren't probed
    for (const id of discoveredIds) {
      if (!cacheMap.has(id)) {
        try {
          const pageDetail = await getWikiPage(id, opClient);
          cacheMap.set(id, pageDetail);
        } catch (err: unknown) {
          if (
            err instanceof OpenProjectAuthenticationError ||
            (err as { statusCode?: number })?.statusCode === 401 ||
            (err as { statusCode?: number })?.statusCode === 403 ||
            (err as { statusCode?: number })?.statusCode === 429
          ) {
            throw err;
          }
          // Ignore missing pages
        }
      }
    }

    discoveredCacheKeys.add(cacheKey);
  }

  // 3. Resolve target project ID if provided
  let targetProjectId: number | undefined;
  if (params?.projectId !== undefined) {
    targetProjectId = await resolveProjectId(params.projectId, opClient);
  }

  // 4. Filter cached pages
  const allPages = Array.from(cacheMap.values());
  const querySubstring = params?.query?.trim().toLowerCase();

  let filtered = allPages.filter((page) => {
    if (targetProjectId !== undefined && page.project.id !== targetProjectId) {
      return false;
    }
    if (querySubstring && !page.title.toLowerCase().includes(querySubstring)) {
      return false;
    }
    return true;
  });

  // 5. Apply limit
  if (params?.limit !== undefined && params.limit > 0) {
    filtered = filtered.slice(0, params.limit);
  }

  return filtered.map(toWikiPageSummary);
}
