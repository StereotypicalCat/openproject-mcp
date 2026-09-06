# Specification: Hosted Remote MCP Server (HTTP/SSE Transport) & Multi-Tenant Scoping

## 1. Overview & Objectives

Currently, `openproject-mcp` runs as a local subprocess communicating via standard input/output (stdio) transports. Every user must have Docker or Bun installed locally and run their own MCP process.

This specification introduces a **Hosted Remote MCP Server** capability. Organizations can deploy a single hosted instance of `openproject-mcp` (e.g. at `https://mcp.example.com`). Individual users and their AI clients (Claude Desktop, Cursor, web agents) connect directly to the hosted server over the standard Model Context Protocol HTTP/SSE (Server-Sent Events) transport, supplying their own personal OpenProject API keys.

### Primary Objectives
1. **Hosted Multi-Tenant Remote Server**: Provide an HTTP/SSE server implementation based on native `Bun.serve` and `@modelcontextprotocol/sdk`.
2. **Dual-Transport Entrypoint**: Preserve existing local stdio operation by default; activate HTTP/SSE transport when `PORT` (e.g., `PORT=3000`) or `--port` is supplied.
3. **Flexible Credential Scoping**: Extract the user's OpenProject API key from incoming client requests via:
   - `Authorization: Bearer <key>`
   - `X-OpenProject-Api-Key: <key>`
   - URL query parameter `?apiKey=<key>`
4. **Single-Instance Multi-User Isolation**: Target a shared OpenProject base URL (`OPENPROJECT_BASE_URL`) configured on the server, while strictly isolating each client's requests inside `RequestContext` (`AsyncLocalStorage`) using their respective personal API key.
5. **Unauthorized Rejection**: Return clean HTTP 401 Unauthorized responses if a client connects without an API key.
6. **Docker Compose Deployment**: Provide a `docker-compose.server.yml` file and `README.md` guide for hosting the server with health checks.

---

## 2. Architecture & Data Flow

```
+------------------------------------+      +------------------------------------+
| User A (Cursor / Claude Desktop)   |      | User B (Claude Desktop / Agent)    |
| Headers: X-OpenProject-Api-Key: keyA|     | URL: /sse?apiKey=keyB              |
+-----------------+------------------+      +-----------------+------------------+
                  | (GET /sse)                                | (GET /sse)
                  +-----------------------+-------------------+
                                          |
                                          v
                           +------------------------------+
                           | Hosted openproject-mcp Server |
                           | (Bun.serve on PORT=3000)     |
                           +--------------+---------------+
                                          |
                        +-----------------+-----------------+
                        | Session A                         | Session B
                        | Client A (key: keyA)              | Client B (key: keyB)
                        | McpServer A (runWithContext)      | McpServer B (runWithContext)
                        +-----------------+-----------------+
                                          |
                                          v
                           +------------------------------+
                           | OpenProject 17 REST API v3   |
                           | (Shared OPENPROJECT_BASE_URL)|
                           +------------------------------+
```

### 2.1 HTTP Endpoints

1. **`GET /health`**:
   - Responds with HTTP 200:
     ```json
     {
       "status": "ok",
       "mode": "remote-mcp",
       "openproject": "https://openproject.example.com",
       "readOnly": false
     }
     ```
   - Used by load balancers, Kubernetes probes, and Docker health checks.

2. **`GET /sse`**:
   - Establishes a persistent Server-Sent Events (SSE) connection with the client.
   - Extracts the API key from:
     1. `Authorization: Bearer <token>`
     2. `X-OpenProject-Api-Key: <token>`
     3. Query parameter `?apiKey=<token>`
   - If missing: Rejects immediately with HTTP 401 and JSON error message:
     ```json
     { "error": "Missing OpenProject API key. Provide via Authorization header, X-OpenProject-Api-Key header, or ?apiKey= query parameter." }
     ```
   - If present:
     - Generates a cryptographically random `sessionId`.
     - Creates an isolated `OpenProjectClient({ baseUrl, apiKey })`.
     - Creates an `SSEServerTransport` bound to `/messages?sessionId=${sessionId}`.
     - Creates an `McpServer` instance with all tools registered and wrapped with `runWithContext`.
     - Stores the session in `activeSessions: Map<string, SessionData>`.
     - Streams the initial `endpoint` SSE event to the client.

3. **`POST /messages`**:
   - URL contains `?sessionId=<id>`.
   - Looks up the session in `activeSessions`.
   - If session not found: Returns HTTP 404 Not Found.
   - Forwards the JSON-RPC request to the session transport's message handler, ensuring tool execution resolves the session's client via `runWithContext`.

4. **Session Eviction**:
   - On SSE connection close or error, `transport.onclose` evicts the session from `activeSessions` to prevent memory leaks.

---

## 3. Configuration & CLI Flags

### Configuration Extension (`src/config/index.ts`)
```typescript
export interface AppConfig {
  baseUrl: string;
  apiKey?: string; // Optional when running in hosted HTTP mode
  readOnly: boolean;
  port?: number;   // When present, launches HTTP/SSE server instead of stdio
  host?: string;   // Default: "0.0.0.0"
}
```

- When `port` is defined (`process.env.PORT` or `--port <num>`):
  - `apiKey` is optional at server startup because individual connecting users supply their own keys.
  - Server starts in HTTP mode.
- When `port` is undefined:
  - Server runs in stdio mode (requires `OPENPROJECT_API_KEY` in environment).

---

## 4. Docker Compose Setup (`docker-compose.server.yml`)

A ready-to-run Docker Compose file for deploying the hosted MCP server:

```yaml
version: "3.8"

services:
  openproject-mcp:
    image: ghcr.io/stereotypicalcat/openproject-mcp:latest
    container_name: openproject-mcp-hosted
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      - OPENPROJECT_BASE_URL=https://openproject.example.com
      - PORT=3000
      - OPENPROJECT_READ_ONLY=false
    healthcheck:
      test: ["CMD-SHELL", "bun -e 'fetch(\"http://localhost:3000/health\").then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))'"]
      interval: 30s
      timeout: 5s
      retries: 3
```

---

## 5. Client Configuration Examples

### Cursor
Add to `.cursor/mcp.json` (or Cursor Settings > Features > MCP):
```json
{
  "mcpServers": {
    "openproject": {
      "url": "https://mcp.example.com/sse",
      "headers": {
        "X-OpenProject-Api-Key": "your-personal-api-key"
      }
    }
  }
}
```
Or via URL query parameter:
```json
{
  "mcpServers": {
    "openproject": {
      "url": "https://mcp.example.com/sse?apiKey=your-personal-api-key"
    }
  }
}
```

### Claude Desktop
In clients that connect to remote SSE servers via standard proxy or direct URL:
```json
{
  "mcpServers": {
    "openproject": {
      "url": "https://mcp.example.com/sse?apiKey=your-personal-api-key"
    }
  }
}
```

---

## 6. Verification & Test Plan

1. **Unit & Protocol Tests (`tests/http-server.test.ts`)**:
   - `GET /health` returns HTTP 200 with status info.
   - `GET /sse` without credentials returns HTTP 401.
   - `GET /sse` with `Authorization: Bearer <key>` succeeds and returns SSE stream.
   - `GET /sse` with `X-OpenProject-Api-Key: <key>` succeeds.
   - `GET /sse` with `?apiKey=<key>` succeeds.
   - Concurrent clients with different API keys execute tools with their own respective credentials without bleed.
   - Disconnecting client evicts session from memory.
2. **CLI & Entrypoint Tests**:
   - `PORT=3000` boots the HTTP server.
   - CLI flags `--port 3000` boots the HTTP server.
3. **Docker Compose Validation**:
   - Validate `docker-compose.server.yml` configuration and verify container runs in HTTP mode.
4. **Documentation**:
   - Record ADR-016 in `docs/DECISIONS.md`.
   - Update `README.md` with Hosted Remote Server and Docker Compose deployment instructions.
