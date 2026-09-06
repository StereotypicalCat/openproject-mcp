/**
 * OpenAPI 3.0 Introspection Domain Service.
 */

import type { OpenProjectClient } from "../client/api-client.ts";
import { OpenProjectNotFoundError } from "../client/errors.ts";
import { resolveClient } from "./helper.ts";

export interface OpenApiQueryOptions {
  path?: string;
  tag?: string;
  schema?: string;
  full?: boolean;
  refresh?: boolean;
}

export interface OpenApiSummary {
  title: string;
  version: string;
  openapi: string;
  totalPaths: number;
  tags: Array<{ name: string; endpointCount: number }>;
  availablePaths: string[];
  instructions: string;
}

interface RawOpenApiOperation {
  tags?: string[];
  summary?: string;
  operationId?: string;
  parameters?: Array<{ name: string; in?: string; [key: string]: unknown }>;
  responses?: Record<string, unknown>;
  [key: string]: unknown;
}

interface RawOpenApiDoc {
  openapi: string;
  info: { title: string; version: string; description?: string };
  paths: Record<string, Record<string, RawOpenApiOperation>>;
  components?: {
    schemas?: Record<string, unknown>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

// In-memory cache keyed by baseUrl
const openApiCache = new Map<string, RawOpenApiDoc>();

/**
 * Clears the in-memory OpenAPI cache.
 */
export function clearOpenApiCache(): void {
  openApiCache.clear();
}

/**
 * Normalizes an API path for flexible querying.
 */
function normalizePath(path: string): string {
  let clean = path.trim();
  if (!clean.startsWith("/")) {
    clean = `/${clean}`;
  }
  if (!clean.startsWith("/api/v3")) {
    clean = `/api/v3${clean}`;
  }
  return clean.toLowerCase();
}

/**
 * Fetches and filters OpenProject OpenAPI 3.0 specification.
 */
export async function getOpenApiSpec(
  options?: OpenApiQueryOptions,
  client?: OpenProjectClient
): Promise<unknown> {
  const activeClient = resolveClient(client);
  const cacheKey = activeClient.baseUrl;

  if (options?.refresh) {
    openApiCache.delete(cacheKey);
  }

  let doc = openApiCache.get(cacheKey);
  if (!doc) {
    doc = await activeClient.get<RawOpenApiDoc>("openapi.json");
    openApiCache.set(cacheKey, doc);
  }

  // 1. Full mode
  if (options?.full) {
    return doc;
  }

  const allPaths = Object.keys(doc.paths || {});

  // 2. Specific path lookup
  if (options?.path) {
    const target = normalizePath(options.path);
    const matchedKey =
      allPaths.find((p) => p.toLowerCase() === target) ||
      allPaths.find((p) => p.toLowerCase().endsWith(target.replace(/^\/api\/v3/, "")));

    if (!matchedKey || !doc.paths[matchedKey]) {
      const sample = allPaths.slice(0, 10).join(", ");
      throw new OpenProjectNotFoundError(
        `OpenAPI path '${options.path}' not found. Available paths include: ${sample}...`,
        { errorIdentifier: "urn:openproject-org:api:v3:errors:NotFound" }
      );
    }

    return {
      path: matchedKey,
      operations: doc.paths[matchedKey],
    };
  }

  // 3. Tag filtering
  if (options?.tag) {
    const targetTag = options.tag.trim().toLowerCase();
    const matchedPaths: Record<string, unknown> = {};

    for (const [pathKey, methods] of Object.entries(doc.paths || {})) {
      let pathMatched = false;
      for (const op of Object.values(methods)) {
        if (
          op &&
          typeof op === "object" &&
          Array.isArray(op.tags) &&
          op.tags.some((t: string) => t.toLowerCase() === targetTag)
        ) {
          pathMatched = true;
          break;
        }
      }
      if (pathMatched) {
        matchedPaths[pathKey] = methods;
      }
    }

    const matchedCount = Object.keys(matchedPaths).length;
    if (matchedCount === 0) {
      const availableTags = Array.from(
        new Set(
          Object.values(doc.paths || {}).flatMap((methods) =>
            Object.values(methods).flatMap((op) =>
              op && typeof op === "object" && Array.isArray(op.tags) ? op.tags : []
            )
          )
        )
      ).sort();
      throw new OpenProjectNotFoundError(
        `OpenAPI tag '${options.tag}' not found. Available tags include: ${availableTags.slice(0, 15).join(", ")}...`,
        { errorIdentifier: "urn:openproject-org:api:v3:errors:NotFound" }
      );
    }

    return {
      tag: options.tag,
      totalPaths: matchedCount,
      paths: matchedPaths,
    };
  }

  // 4. Schema model lookup
  if (options?.schema) {
    const targetSchema = options.schema.trim().toLowerCase();
    const schemas = doc.components?.schemas || {};
    const matchedKey = Object.keys(schemas).find((s) => s.toLowerCase() === targetSchema);

    if (!matchedKey || !schemas[matchedKey]) {
      const availableSchemas = Object.keys(schemas).slice(0, 15).join(", ");
      throw new OpenProjectNotFoundError(
        `OpenAPI schema '${options.schema}' not found in components.schemas. Available schemas include: ${availableSchemas}...`,
        { errorIdentifier: "urn:openproject-org:api:v3:errors:NotFound" }
      );
    }

    return {
      schemaName: matchedKey,
      schema: schemas[matchedKey],
    };
  }

  // 5. Default: Summary Overview
  const tagCounts = new Map<string, number>();
  for (const methods of Object.values(doc.paths || {})) {
    const seenInPath = new Set<string>();
    for (const op of Object.values(methods)) {
      if (op && typeof op === "object" && Array.isArray(op.tags)) {
        for (const t of op.tags) {
          seenInPath.add(t);
        }
      }
    }
    for (const t of seenInPath) {
      tagCounts.set(t, (tagCounts.get(t) || 0) + 1);
    }
  }

  const sortedTags = Array.from(tagCounts.entries())
    .map(([name, endpointCount]) => ({ name, endpointCount }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const summary: OpenApiSummary = {
    title: doc.info?.title || "OpenProject API V3",
    version: doc.info?.version || "3",
    openapi: doc.openapi || "3.0.0",
    totalPaths: allPaths.length,
    tags: sortedTags,
    availablePaths: allPaths,
    instructions:
      "Call openproject_get_openapi_spec with 'path' (e.g. '/api/v3/work_packages'), 'tag' (e.g. 'Work Packages'), or 'schema' (e.g. 'WorkPackageModel') to inspect detailed schemas and operations without requesting the full payload.",
  };

  return summary;
}
