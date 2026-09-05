/**
 * Filter Builder for OpenProject REST API v3 JSON filter syntax.
 */

import type {
  FilterElement,
  FilterOperator,
  WorkPackageFilterParams,
} from "./types.ts";

/**
 * Fluent builder for creating OpenProject API v3 filter arrays.
 */
export class FilterBuilder {
  private filters: FilterElement[] = [];

  /**
   * Adds an arbitrary property filter.
   */
  add(
    property: string,
    operator: FilterOperator,
    values: (string | number | boolean)[] = []
  ): this {
    this.filters.push({
      [property]: {
        operator,
        values: values.map(String),
      },
    });
    return this;
  }

  /**
   * Filters by project ID or identifier.
   */
  project(projectId: number | string): this {
    return this.add("project", "=", [projectId]);
  }

  /**
   * Filters by work package status.
   * Accepts "open", "closed", or specific numeric/string status IDs.
   */
  status(status: "open" | "closed" | string | number): this {
    if (status === "open") {
      return this.add("status", "o", []);
    }
    if (status === "closed") {
      return this.add("status", "c", []);
    }
    return this.add("status", "=", [status]);
  }

  /**
   * Filters by work package type ID.
   */
  type(typeId: number | string): this {
    return this.add("type", "=", [typeId]);
  }

  /**
   * Filters by assignee user ID or "me".
   */
  assignee(assigneeId: number | string): this {
    return this.add("assignee", "=", [assigneeId]);
  }

  /**
   * Filters by author user ID.
   */
  author(authorId: number | string): this {
    return this.add("author", "=", [authorId]);
  }

  /**
   * Filters by priority ID.
   */
  priority(priorityId: number | string): this {
    return this.add("priority", "=", [priorityId]);
  }

  /**
   * Filters by subject (substring match).
   */
  subject(text: string): this {
    return this.add("subject", "~", [text]);
  }

  /**
   * Returns the constructed filter array.
   */
  build(): FilterElement[] {
    return [...this.filters];
  }

  /**
   * Serializes the filter array into JSON string expected by OpenProject API v3.
   */
  toJSON(): string {
    return JSON.stringify(this.filters);
  }
}

/**
 * Builds an OpenProject API v3 filter array from a WorkPackageFilterParams object.
 */
export function buildWorkPackageFilters(
  params: WorkPackageFilterParams
): FilterElement[] {
  const builder = new FilterBuilder();

  if (params.projectId !== undefined && params.projectId !== "") {
    builder.project(params.projectId);
  }

  if (params.status !== undefined && params.status !== "") {
    builder.status(params.status);
  }

  if (params.typeId !== undefined && params.typeId !== "") {
    builder.type(params.typeId);
  }

  if (params.assigneeId !== undefined && params.assigneeId !== "") {
    builder.assignee(params.assigneeId);
  }

  if (params.authorId !== undefined && params.authorId !== "") {
    builder.author(params.authorId);
  }

  if (params.priorityId !== undefined && params.priorityId !== "") {
    builder.priority(params.priorityId);
  }

  if (params.subject !== undefined && params.subject.trim() !== "") {
    builder.subject(params.subject.trim());
  }

  if (params.customFilters && params.customFilters.length > 0) {
    for (const filter of params.customFilters) {
      for (const [prop, criteria] of Object.entries(filter)) {
        builder.add(prop, criteria.operator, criteria.values);
      }
    }
  }

  return builder.build();
}

/**
 * Serializes a filter array to a JSON string for use in query parameters.
 */
export function serializeFilters(filters: FilterElement[]): string {
  return JSON.stringify(filters);
}
