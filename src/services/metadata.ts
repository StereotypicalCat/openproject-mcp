/**
 * Metadata & Taxonomies Domain Service.
 */

import type { OpenProjectClient } from "../client/api-client.ts";
import {
  normalizePriority,
  normalizeStatus,
  normalizeType,
  normalizeUser,
  unpackCollection,
} from "../client/hal-parser.ts";
import type {
  HalCollection,
  HalResource,
  PaginatedResult,
  PriorityItem,
  StatusItem,
  TypeItem,
  UserItem,
} from "../client/types.ts";
import { resolveClient } from "./helper.ts";

export interface ListTypesParams {
  projectId?: number | string;
}

export interface ListUsersParams {
  pageSize?: number;
  offset?: number;
  status?: string;
}

/**
 * Lists all work package statuses available in the system.
 */
export async function listStatuses(
  client?: OpenProjectClient
): Promise<StatusItem[]> {
  const opClient = resolveClient(client);
  const response = await opClient.get<HalCollection<HalResource>>("statuses");
  const unpacked = unpackCollection(response, normalizeStatus);
  return unpacked.items;
}

/**
 * Lists work package types, optionally filtered to those enabled for a specific project.
 */
export async function listTypes(
  params?: ListTypesParams,
  client?: OpenProjectClient
): Promise<TypeItem[]> {
  const opClient = resolveClient(client);
  const path = params?.projectId !== undefined ? `projects/${params.projectId}/types` : "types";
  const response = await opClient.get<HalCollection<HalResource>>(path);
  const unpacked = unpackCollection(response, normalizeType);
  return unpacked.items;
}

/**
 * Lists issue priority levels configured in the system.
 */
export async function listPriorities(
  client?: OpenProjectClient
): Promise<PriorityItem[]> {
  const opClient = resolveClient(client);
  const response = await opClient.get<HalCollection<HalResource>>("priorities");
  const unpacked = unpackCollection(response, normalizePriority);
  return unpacked.items;
}

/**
 * Lists users in the OpenProject instance with pagination.
 */
export async function listUsers(
  params?: ListUsersParams,
  client?: OpenProjectClient
): Promise<PaginatedResult<UserItem>> {
  const opClient = resolveClient(client);
  const query: Record<string, string | number | boolean | undefined> = {};

  if (params?.pageSize !== undefined) query.pageSize = params.pageSize;
  if (params?.offset !== undefined) query.offset = params.offset;
  if (params?.status !== undefined) query.status = params.status;

  const response = await opClient.get<HalCollection<HalResource>>("users", query);
  return unpackCollection(response, normalizeUser);
}
