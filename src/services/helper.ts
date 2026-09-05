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
