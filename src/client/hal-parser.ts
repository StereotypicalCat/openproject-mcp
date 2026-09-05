/**
 * HAL+JSON Normalization and Parsing Utilities.
 * Unpacks nested HAL links and embedded data into token-efficient JSON models.
 */

import type {
  HalCollection,
  HalLink,
  HalResource,
  PaginatedResult,
  PriorityItem,
  ProjectDetail,
  ProjectSummary,
  QueryDetail,
  QuerySummary,
  StatusItem,
  TypeItem,
  UserItem,
  WorkPackageDetail,
  WorkPackageSummary,
} from "./types.ts";

/**
 * Extracts a numeric entity ID from an OpenProject HAL href URL.
 * e.g. "/api/v3/projects/4" -> 4
 */
export function extractIdFromHref(href?: string | null): number | undefined {
  if (!href) return undefined;
  const match = href.match(/\/(\d+)(?:[/?#]|$)/);
  if (match && match[1]) {
    return parseInt(match[1], 10);
  }
  return undefined;
}

/**
 * Resolves a HAL link into its extracted ID, title, and href.
 */
export function resolveLink(
  link?: HalLink | null
): { id?: number; title?: string; href?: string } | undefined {
  if (!link || !link.href) return undefined;
  return {
    id: extractIdFromHref(link.href),
    title: link.title,
    href: link.href,
  };
}

/**
 * Extracts raw plain text from an OpenProject formatted text field.
 */
export function extractRawText(field: unknown): string {
  if (!field) return "";
  if (typeof field === "string") return field;
  if (typeof field === "object" && field !== null) {
    const obj = field as Record<string, unknown>;
    if (typeof obj.raw === "string") return obj.raw;
    if (typeof obj.html === "string") return obj.html;
  }
  return String(field);
}

/**
 * Unpacks a HAL Collection into a standard PaginatedResult using a transformer function.
 */
export function unpackCollection<TItem = HalResource, TResult = unknown>(
  collection: HalCollection<TItem>,
  itemTransformer: (item: TItem) => TResult
): PaginatedResult<TResult> {
  const rawElements = collection._embedded?.elements ?? [];
  return {
    items: rawElements.map(itemTransformer),
    total: collection.total ?? rawElements.length,
    count: collection.count ?? rawElements.length,
    pageSize: collection.pageSize ?? rawElements.length,
    offset: collection.offset ?? 1,
  };
}

/**
 * Normalizes a project HAL resource into a token-efficient ProjectSummary.
 */
export function normalizeProjectSummary(resource: HalResource): ProjectSummary {
  const selfHref = (resource._links?.self as HalLink | undefined)?.href;
  return {
    id: resource.id ?? extractIdFromHref(selfHref) ?? 0,
    identifier: String(resource.identifier ?? ""),
    name: String(resource.name ?? ""),
    active: Boolean(resource.active),
    public: Boolean(resource.public),
    description: extractRawText(resource.description),
    createdAt: typeof resource.createdAt === "string" ? resource.createdAt : undefined,
    updatedAt: typeof resource.updatedAt === "string" ? resource.updatedAt : undefined,
  };
}

/**
 * Normalizes a project HAL resource into a complete ProjectDetail.
 */
export function normalizeProject(resource: HalResource): ProjectDetail {
  const summary = normalizeProjectSummary(resource);
  const parentLink = resource._links?.parent as HalLink | undefined;
  const statusLink = resource._links?.status as HalLink | undefined;

  return {
    ...summary,
    parentId: extractIdFromHref(parentLink?.href) ?? null,
    parentName: parentLink?.title ?? null,
    status: statusLink?.title ?? (typeof resource.status === "string" ? resource.status : null),
    statusExplanation: extractRawText(resource.statusExplanation) || null,
  };
}

/**
 * Normalizes a work package HAL resource into a token-efficient WorkPackageSummary.
 */
export function normalizeWorkPackageSummary(resource: HalResource): WorkPackageSummary {
  const links = resource._links ?? {};
  const selfHref = (links.self as HalLink | undefined)?.href;
  const typeLink = links.type as HalLink | undefined;
  const statusLink = links.status as HalLink | undefined;
  const priorityLink = links.priority as HalLink | undefined;
  const projectLink = links.project as HalLink | undefined;
  const authorLink = links.author as HalLink | undefined;
  const assigneeLink = links.assignee as HalLink | undefined;

  return {
    id: resource.id ?? extractIdFromHref(selfHref) ?? 0,
    subject: String(resource.subject ?? ""),
    type: typeLink?.title ?? "",
    typeId: extractIdFromHref(typeLink?.href),
    status: statusLink?.title ?? "",
    statusId: extractIdFromHref(statusLink?.href),
    priority: priorityLink?.title,
    priorityId: extractIdFromHref(priorityLink?.href),
    project: projectLink?.title ?? "",
    projectId: extractIdFromHref(projectLink?.href),
    author: authorLink?.title,
    authorId: extractIdFromHref(authorLink?.href),
    assignee: assigneeLink?.title,
    assigneeId: extractIdFromHref(assigneeLink?.href),
    startDate: typeof resource.startDate === "string" ? resource.startDate : null,
    dueDate: typeof resource.dueDate === "string" ? resource.dueDate : null,
    estimatedTime: typeof resource.estimatedTime === "string" ? resource.estimatedTime : null,
    spentTime: typeof resource.spentTime === "string" ? resource.spentTime : null,
    percentageDone: typeof resource.percentageDone === "number" ? resource.percentageDone : null,
    createdAt: typeof resource.createdAt === "string" ? resource.createdAt : undefined,
    updatedAt: typeof resource.updatedAt === "string" ? resource.updatedAt : undefined,
  };
}

/**
 * Normalizes a work package HAL resource into a complete WorkPackageDetail.
 */
export function normalizeWorkPackage(resource: HalResource): WorkPackageDetail {
  const summary = normalizeWorkPackageSummary(resource);
  const links = resource._links ?? {};
  const parentLink = links.parent as HalLink | undefined;

  let parent: { id: number; subject?: string } | null = null;
  if (parentLink?.href) {
    const parentId = extractIdFromHref(parentLink.href);
    if (parentId !== undefined) {
      parent = {
        id: parentId,
        subject: parentLink.title,
      };
    }
  }

  const children: Array<{ id: number; subject?: string }> = [];
  const rawChildren = links.children;
  if (Array.isArray(rawChildren)) {
    for (const child of rawChildren) {
      const childLink = child as HalLink;
      const childId = extractIdFromHref(childLink.href);
      if (childId !== undefined) {
        children.push({
          id: childId,
          subject: childLink.title,
        });
      }
    }
  }

  // Extract custom fields if present (customFieldX keys)
  const customFields: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(resource)) {
    if (key.startsWith("customField")) {
      customFields[key] = val;
    }
  }

  return {
    ...summary,
    description: extractRawText(resource.description),
    parent,
    children: children.length > 0 ? children : undefined,
    lockVersion: typeof resource.lockVersion === "number" ? resource.lockVersion : 0,
    customFields: Object.keys(customFields).length > 0 ? customFields : undefined,
  };
}

/**
 * Normalizes a query HAL resource into a QuerySummary.
 */
export function normalizeQuerySummary(resource: HalResource): QuerySummary {
  const selfHref = (resource._links?.self as HalLink | undefined)?.href;
  const projectLink = resource._links?.project as HalLink | undefined;

  return {
    id: resource.id ?? extractIdFromHref(selfHref) ?? 0,
    name: String(resource.name ?? ""),
    public: Boolean(resource.public),
    starred: typeof resource.starred === "boolean" ? resource.starred : undefined,
    projectId: extractIdFromHref(projectLink?.href) ?? null,
    projectName: projectLink?.title ?? null,
  };
}

/**
 * Normalizes a query HAL resource into a complete QueryDetail.
 */
export function normalizeQuery(resource: HalResource): QueryDetail {
  const summary = normalizeQuerySummary(resource);
  const links = resource._links ?? {};

  // Extract columns
  const columns: string[] = [];
  const rawColumns = links.columns;
  if (Array.isArray(rawColumns)) {
    for (const col of rawColumns) {
      const link = col as HalLink;
      columns.push(link.title ?? link.href?.split("/").pop() ?? "");
    }
  }

  // Extract sortBy
  const sortBy: Array<{ attribute: string; direction: "asc" | "desc" }> = [];
  const rawSortBy = links.sortBy;
  if (Array.isArray(rawSortBy)) {
    for (const item of rawSortBy) {
      const link = item as HalLink;
      const title = link.title ?? "";
      const isDesc = title.toLowerCase().includes("descending") || link.href?.endsWith("-desc");
      const attr = link.href?.split("/").pop()?.replace(/-asc|-desc/, "") ?? title;
      sortBy.push({ attribute: attr, direction: isDesc ? "desc" : "asc" });
    }
  }

  // Extract filters
  const filters: Array<{ field: string; operator: string; values: string[] }> = [];
  if (Array.isArray(resource.filters)) {
    for (const f of resource.filters as Array<Record<string, unknown>>) {
      const fLinks = (f._links ?? {}) as Record<string, unknown>;
      const opLink = fLinks.operator as HalLink | undefined;
      const filterLink = fLinks.filter as HalLink | undefined;
      const field = filterLink?.title ?? String(f.name ?? "");
      const operator = opLink?.title ?? opLink?.href?.split("/").pop() ?? "";
      const values: string[] = [];
      if (Array.isArray(f.values)) {
        values.push(...f.values.map(String));
      }
      filters.push({ field, operator, values });
    }
  }

  const resultsLink = links.results as HalLink | undefined;

  return {
    ...summary,
    columns,
    sortBy: sortBy.length > 0 ? sortBy : undefined,
    filters,
    resultsHref: resultsLink?.href ?? undefined,
  };
}

/**
 * Normalizes a Status HAL resource.
 */
export function normalizeStatus(resource: HalResource): StatusItem {
  return {
    id: resource.id ?? extractIdFromHref((resource._links?.self as HalLink | undefined)?.href) ?? 0,
    name: String(resource.name ?? ""),
    isClosed: Boolean(resource.isClosed),
    isDefault: typeof resource.isDefault === "boolean" ? resource.isDefault : undefined,
    color: typeof resource.color === "string" ? resource.color : undefined,
  };
}

/**
 * Normalizes a Type HAL resource.
 */
export function normalizeType(resource: HalResource): TypeItem {
  return {
    id: resource.id ?? extractIdFromHref((resource._links?.self as HalLink | undefined)?.href) ?? 0,
    name: String(resource.name ?? ""),
    isMilestone: Boolean(resource.isMilestone),
    isDefault: typeof resource.isDefault === "boolean" ? resource.isDefault : undefined,
    color: typeof resource.color === "string" ? resource.color : undefined,
  };
}

/**
 * Normalizes a Priority HAL resource.
 */
export function normalizePriority(resource: HalResource): PriorityItem {
  return {
    id: resource.id ?? extractIdFromHref((resource._links?.self as HalLink | undefined)?.href) ?? 0,
    name: String(resource.name ?? ""),
    isActive: typeof resource.isActive === "boolean" ? resource.isActive : true,
    isDefault: typeof resource.isDefault === "boolean" ? resource.isDefault : undefined,
    color: typeof resource.color === "string" ? resource.color : undefined,
  };
}

/**
 * Normalizes a User HAL resource.
 */
export function normalizeUser(resource: HalResource): UserItem {
  return {
    id: resource.id ?? extractIdFromHref((resource._links?.self as HalLink | undefined)?.href) ?? 0,
    name: String(resource.name ?? ""),
    login: typeof resource.login === "string" ? resource.login : undefined,
    email: typeof resource.email === "string" ? resource.email : undefined,
    admin: typeof resource.admin === "boolean" ? resource.admin : undefined,
    status: typeof resource.status === "string" ? resource.status : undefined,
  };
}

/**
 * Low-level cleaner that strips operational action links and flattens
 * generic HAL resources for general token-efficient LLM consumption.
 */
export function unpackHalResource(resource: HalResource): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  const operationalLinks = new Set([
    "self", "schema", "update", "updateImmediately", "delete", "createWorkPackage",
    "editWorkPackage", "createWorkPackageImmediate", "addAttachment", "addWatcher",
    "removeWatcher", "addRelation", "addChild", "changeParent", "addComment",
    "previewMarkup", "logTime", "move", "copy", "pdf", "generate_pdf", "atom",
    "configureForm", "star", "unstar", "watch", "unwatch", "favor", "unfavor",
  ]);

  for (const [key, value] of Object.entries(resource)) {
    if (key === "_links") {
      const links = value as Record<string, HalLink | HalLink[] | undefined>;
      const cleanedLinks: Record<string, unknown> = {};

      for (const [linkRel, linkVal] of Object.entries(links)) {
        if (operationalLinks.has(linkRel) || !linkVal) {
          continue;
        }

        if (Array.isArray(linkVal)) {
          cleanedLinks[linkRel] = linkVal.map((l) => ({
            id: extractIdFromHref(l.href),
            title: l.title ?? undefined,
          }));
        } else if (linkVal.href) {
          cleanedLinks[linkRel] = {
            id: extractIdFromHref(linkVal.href),
            title: linkVal.title ?? undefined,
          };
        }
      }

      if (Object.keys(cleanedLinks).length > 0) {
        result.links = cleanedLinks;
      }
    } else if (key === "_embedded") {
      const embedded = value as Record<string, unknown>;
      result.embedded = embedded;
    } else if (key === "description" || key === "statusExplanation") {
      result[key] = extractRawText(value);
    } else {
      result[key] = value;
    }
  }

  return result;
}
