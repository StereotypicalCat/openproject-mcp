# Design Specification: MCP Tool Definitions & Schema Registration

**Date**: 2026-09-06
**Status**: Approved
**Scope**: Phase 1 Task 3 - MCP Tool Definitions & Schema Registration

---

## 1. Executive Summary

This specification defines the Model Context Protocol (MCP) tool interfaces, input validation schemas (via Zod), execution handlers, error handling, and server registration for OpenProject MCP.

Building on the Domain Services layer established in Phase 1 Task 2, these tools expose OpenProject capabilities to LLM clients (such as Claude Desktop, Cursor, and Antigravity) adhering to the MCP 1.6+ specification using `@modelcontextprotocol/sdk`.

---

## 2. Architecture & Design Principles

### 2.1 Layer Separation
- **Domain Services Layer (`src/services/`)**: Implements business logic, API calls, and HAL data normalization. Remains independent of MCP transport and protocol types.
- **MCP Tools Layer (`src/tools/`)**: Validates input arguments using Zod schemas, extracts ambient `RequestContext`, invokes domain services, formats results as standard MCP tool responses (`{ content: [{ type: "text", text: string }], isError?: boolean }`), and catches/sanitizes errors.
- **MCP Server Layer (`src/server.ts`, Phase 1 Task 4)**: Mounts tool definitions onto the `@modelcontextprotocol/sdk` `McpServer` and binds to `StdioServerTransport`.

```
+-------------------------------------------------------------+
|                     MCP Client (LLM)                        |
+-------------------------------------------------------------+
                              |
                     tools/call, tools/list
                              v
+-------------------------------------------------------------+
|                  src/tools/ (This Spec)                     |
|  - Zod Input Schemas                                        |
|  - Tool Definitions (Metadata, Descriptions)                |
|  - Handlers (Validation -> Service Call -> MCP Content)     |
|  - Error Formatting (Friendly text, isError: true)          |
+-------------------------------------------------------------+
                              |
                              v
+-------------------------------------------------------------+
|                src/services/ (Domain Services)              |
|  - projects, work-packages, queries, metadata               |
+-------------------------------------------------------------+
                              |
                              v
+-------------------------------------------------------------+
|             src/client/ & OpenProject REST API v3           |
+-------------------------------------------------------------+
```

### 2.2 Multi-User Concurrency & Ambient Context
Per ADR-003 and ADR-004, tool handlers do NOT store global client references. Instead, each tool execution resolves the ambient `OpenProjectClient` via `RequestContext` (`AsyncLocalStorage`), enabling safe multi-user and multi-session concurrency.

### 2.3 Read-Only Safety
All Phase 1 tools are read-only (`readOnly: true`). When `OPENPROJECT_READ_ONLY=true` or `--read-only` is active, read-only tools remain accessible while mutating tools (in Phase 2) are filtered out and rejected with `SERVER_READ_ONLY`.

---

## 3. Tool Specifications

All tool names are prefixed with `openproject_` using `snake_case` in accordance with AGENTS.md conventions.

### 3.1 `openproject_list_projects`
- **Description**: List OpenProject projects accessible to the authenticated user with optional pagination and sorting.
- **Parameters**:
  - `pageSize` (optional integer, 1-100, default: 20): Number of projects to return per page.
  - `offset` (optional integer, >= 1, default: 1): Page number to retrieve.
  - `sortBy` (optional string): OpenProject sorting expression (e.g. `[["name","asc"]]` or `name:asc`).
  - `filters` (optional string): Raw OpenProject JSON filter string array.

### 3.2 `openproject_get_project`
- **Description**: Retrieve detailed information for a single project by its numeric ID or string identifier (slug).
- **Parameters**:
  - `projectId` (required number or string): Numeric ID (e.g. `4`) or identifier slug (e.g. `"mcp-test-project"`).

### 3.3 `openproject_list_work_packages`
- **Description**: Browse and filter work packages (tasks, bugs, milestones, features) across projects or within a specific project.
- **Parameters**:
  - `projectId` (optional number or string): Scope work packages to a specific project by numeric ID or slug identifier.
  - `status` (optional string or number): Filter by status: `"open"`, `"closed"`, or numeric status ID.
  - `type` (optional number): Filter by work package type ID (e.g. 1 for Task, 2 for Milestone).
  - `assigneeId` (optional number): Filter by assignee user ID.
  - `subject` (optional string): Filter by substring search in work package subject.
  - `pageSize` (optional integer, 1-100, default: 20): Number of items per page.
  - `offset` (optional integer, >= 1, default: 1): Page number to retrieve.
  - `sortBy` (optional string): Sorting expression (e.g. `[["id","asc"]]`).
  - `filters` (optional string): Raw OpenProject JSON filter string array overriding individual filters.

### 3.4 `openproject_get_work_package`
- **Description**: Get full details of a specific work package by its numeric ID, including status, priority, assignee, parent, and child relations.
- **Parameters**:
  - `workPackageId` (required number, >= 1): The numeric ID of the work package.

### 3.5 `openproject_list_queries`
- **Description**: List saved queries (custom views, filter sets) accessible to the user, optionally filtered by project.
- **Parameters**:
  - `projectId` (optional number or string): Scope queries to a specific project by numeric ID or slug.
  - `pageSize` (optional integer, 1-100, default: 20): Number of queries to return per page.
  - `offset` (optional integer, >= 1, default: 1): Page number to retrieve.

### 3.6 `openproject_get_query`
- **Description**: Retrieve metadata and work package results for a saved query.
- **Parameters**:
  - `queryId` (required number, >= 1): The numeric ID of the saved query.
  - `pageSize` (optional integer, 1-100, default: 20): Maximum number of result work packages to return.
  - `offset` (optional integer, >= 1, default: 1): Page number of results.

### 3.7 `openproject_list_types`
- **Description**: List all work package types (Task, Bug, Milestone, Feature, etc.), optionally scoped to a project.
- **Parameters**:
  - `projectId` (optional number or string): Optional project ID or slug to retrieve types activated for that project.

### 3.8 `openproject_list_statuses`
- **Description**: List all available work package statuses (e.g. New, In Progress, Closed, Rejected).
- **Parameters**: None.

### 3.9 `openproject_list_priorities`
- **Description**: List all available work package priority levels (e.g. Low, Normal, High, Immediate).
- **Parameters**: None.

### 3.10 `openproject_list_users`
- **Description**: List users in the OpenProject instance with optional pagination.
- **Parameters**:
  - `pageSize` (optional integer, 1-100, default: 20): Number of users per page.
  - `offset` (optional integer, >= 1, default: 1): Page number to retrieve.

---

## 4. MCP Response & Error Handling

### 4.1 Success Response Contract
Responses follow standard MCP tool result format:
```json
{
  "content": [
    {
      "type": "text",
      "text": "{\n  \"projects\": [...],\n  \"total\": 1\n}"
    }
  ]
}
```
Payloads are formatted as indented JSON text strings, preserving token efficiency while remaining easily readable by LLMs.

### 4.2 Error Response Contract
If an exception occurs (validation error, OpenProject API error, 404 Not Found, etc.):
```json
{
  "content": [
    {
      "type": "text",
      "text": "Error [OPENPROJECT_NOT_FOUND]: Project 'non-existent' was not found."
    }
  ],
  "isError": true
}
```
All errors are sanitized via `OpenProjectError` logic (already implemented in `src/client/errors.ts`) to ensure API tokens and sensitive headers are never leaked.

---

## 5. File Structure

```
src/tools/
├── common.ts          # Response formatters, error formatters, tool definition types
├── projects.ts        # openproject_list_projects, openproject_get_project
├── work-packages.ts   # openproject_list_work_packages, openproject_get_work_package
├── queries.ts         # openproject_list_queries, openproject_get_query
├── metadata.ts        # openproject_list_types, openproject_list_statuses, openproject_list_priorities, openproject_list_users
└── index.ts           # registerAllTools, tool array exports, tool map
```

---

## 6. Testing Strategy

1. **Unit Tests (`tests/tools.test.ts`)**:
   - Parameter validation (Zod schema rejection on negative IDs, invalid page sizes, etc.).
   - Execution with mock responses verifying correct service calls and argument forwarding.
   - Error response formatting and `isError: true` flag.
2. **Integration Verification (`tests/tools.test.ts`)**:
   - Execute all 10 tools inside `runWithContext` against the local live OpenProject 17 Docker container.
   - Verify non-empty responses for `mcp-test-project` (ID: 4), seeded work packages (IDs 38-41), saved query (ID 30), types, statuses, priorities, and admin user.
