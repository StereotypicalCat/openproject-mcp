
/**
 * Request Context and AsyncLocalStorage Scoping for Multi-User Safety.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import type { OpenProjectClient } from "./client/api-client.ts";

export interface RequestContext {
  client: OpenProjectClient;
  isReadOnly: boolean;
  sessionId?: string;
  userId?: string;
}

const asyncLocalStorage = new AsyncLocalStorage<RequestContext>();

/**
 * Retrieves the current request context for the active asynchronous execution chain.
 * Throws an error if called outside of a runWithContext() scope.
 */
export function getRequestContext(): RequestContext {
  const context = asyncLocalStorage.getStore();
  if (!context) {
    throw new Error(
      "No active RequestContext found. Operations must be executed within runWithContext()."
    );
  }
  return context;
}

/**
 * Attempts to retrieve the current request context, returning undefined if outside scope.
 */
export function tryGetRequestContext(): RequestContext | undefined {
  return asyncLocalStorage.getStore();
}

/**
 * Executes a function within the scope of a specific RequestContext.
 *
 * @param context - Request context holding the isolated OpenProject client and options
 * @param fn - Asynchronous or synchronous callback to execute
 */
export function runWithContext<T>(
  context: RequestContext,
  fn: () => T
): T {
  return asyncLocalStorage.run(context, fn);
}
