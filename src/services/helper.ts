/**
 * Shared helper utilities for domain services.
 */

import { getRequestContext } from "../context.ts";
import type { OpenProjectClient } from "../client/api-client.ts";

/**
 * Resolves an OpenProjectClient instance.
 * Prefers an explicitly passed client; falls back to the ambient RequestContext.
 */
export function resolveClient(client?: OpenProjectClient): OpenProjectClient {
  return client ?? getRequestContext().client;
}

/**
 * Resolves a numeric project ID from either a number or string identifier.
 * If the value is a number or integer string, returns the parsed integer.
 * Otherwise, queries the OpenProject API for the project by identifier to get its numeric ID.
 */
export async function resolveProjectId(
  projectId: number | string,
  client?: OpenProjectClient
): Promise<number> {
  if (typeof projectId === "number") {
    return projectId;
  }
  const trimmed = projectId.trim();
  if (/^\d+$/.test(trimmed)) {
    return parseInt(trimmed, 10);
  }
  const opClient = resolveClient(client);
  const response = await opClient.get<{ id: number }>(`projects/${encodeURIComponent(trimmed)}`);
  return response.id;
}
