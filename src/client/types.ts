/**
 * OpenProject REST API v3 Types and Domain Interfaces.
 */

// =============================================================================
// HAL+JSON Primitive Interfaces
// =============================================================================

export interface HalLink {
  href: string | null;
  title?: string;
  templated?: boolean;
  method?: string;
  type?: string;
  payload?: Record<string, unknown>;
  [key: string]: unknown;
}

export type HalLinks = Record<string, HalLink | HalLink[] | undefined>;

export interface HalResource {
  _type: string;
  id?: number;
  _links?: HalLinks;
  _embedded?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface HalCollection<T = HalResource> extends HalResource {
  _type: "Collection" | "WorkPackageCollection" | string;
  total: number;
  count: number;
  pageSize: number;
  offset: number;
  _embedded: {
    elements: T[];
    [key: string]: unknown;
  };
}

export interface OpenProjectApiErrorPayload {
  _type?: string;
  errorIdentifier?: string;
  message?: string;
  errors?: Record<string, unknown> | unknown[];
}

// =============================================================================
// Normalized Domain Models (Token-Efficient LLM Representations)
// =============================================================================

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  count: number;
  pageSize: number;
  offset: number;
}

export interface ProjectSummary {
  id: number;
  identifier: string;
  name: string;
  active: boolean;
  public: boolean;
  description?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ProjectDetail extends ProjectSummary {
  parentId?: number | null;
  parentName?: string | null;
  status?: string | null;
  statusExplanation?: string | null;
}

export interface WorkPackageSummary {
  id: number;
  subject: string;
  type: string;
  typeId?: number;
  status: string;
  statusId?: number;
  priority?: string;
  priorityId?: number;
  project: string;
  projectId?: number;
  author?: string;
  authorId?: number;
  assignee?: string;
  assigneeId?: number;
  startDate?: string | null;
  dueDate?: string | null;
  estimatedTime?: string | null;
  spentTime?: string | null;
  percentageDone?: number | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface WorkPackageDetail extends WorkPackageSummary {
  description?: string;
  parent?: { id: number; subject?: string } | null;
  children?: Array<{ id: number; subject?: string }>;
  lockVersion: number;
  customFields?: Record<string, unknown>;
}

export interface QuerySummary {
  id: number;
  name: string;
  public: boolean;
  starred?: boolean;
  projectId?: number | null;
  projectName?: string | null;
}

export interface QueryDetail extends QuerySummary {
  columns: string[];
  sortBy?: Array<{ attribute: string; direction: "asc" | "desc" }>;
  filters: Array<{ field: string; operator: string; values: string[] }>;
  resultsHref?: string;
}

export interface StatusItem {
  id: number;
  name: string;
  isClosed: boolean;
  isDefault?: boolean;
  color?: string;
}

export interface TypeItem {
  id: number;
  name: string;
  isMilestone: boolean;
  isDefault?: boolean;
  color?: string;
}

export interface PriorityItem {
  id: number;
  name: string;
  isActive: boolean;
  isDefault?: boolean;
  color?: string;
}

export interface UserItem {
  id: number;
  name: string;
  login?: string;
  email?: string;
  admin?: boolean;
  status?: string;
}

// =============================================================================
// Filter Criteria Interfaces
// =============================================================================

export type FilterOperator =
  | "="
  | "!"
  | "!="
  | "~"
  | "!~"
  | ">="
  | "<="
  | "o" // open
  | "c" // closed
  | "*" // any / all
  | "t" // today
  | "w" // this week
  | "nd" // next days
  | string;

export interface FilterElement {
  [property: string]: {
    operator: FilterOperator;
    values: string[];
  };
}

export interface WorkPackageFilterParams {
  projectId?: number | string;
  status?: "open" | "closed" | string | number;
  typeId?: number | string;
  assigneeId?: number | string;
  authorId?: number | string;
  priorityId?: number | string;
  subject?: string;
  customFilters?: FilterElement[];
}
