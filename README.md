# openproject-mcp

`openproject-mcp` is a Model Context Protocol (MCP) server that connects AI assistants (such as Claude Desktop, Cursor, and Antigravity) to [OpenProject](https://github.com/opf/openproject) via OpenProject's REST API v3.

It allows agents to browse, query, and reason about OpenProject workspaces using personal API keys over standard MCP transports (stdio and HTTP/SSE).

---

## Features

- **Project Discovery**: List accessible projects, inspect hierarchies, and retrieve project details.
- **Work Package Browsing**: Query work packages with status, type, assignee, priority, and custom filters; inspect work package details and parent/child relationships.
- **Activities & Comment History**: Inspect full timeline events and discussions for work packages with comments-only filtering.
- **Meetings & Agendas**: List meetings, inspect detailed agendas with section timings and outcomes, and perform deep keyword searches across meetings and agenda notes.
- **Wikis & Documentation**: Discover and search wiki pages with smart discovery caching, view page metadata, inspect file attachments, and trace work package links.
- **Saved Queries (Views)**: Discover and execute saved project and global queries.
- **Taxonomies & Metadata**: Query work package types (Tasks, Bugs, Features), statuses, priorities, and users to enable structured agent reasoning.
- **OpenAPI Schema Introspection**: Query dynamic endpoint specifications, parameter schemas, and data models directly from the connected OpenProject instance with in-memory caching.
- **HAL+JSON Normalization**: Converts OpenProject's verbose HAL+JSON representations into concise, token-efficient structures.
- **Secure Authentication**: Uses OpenProject Personal API tokens via HTTP Basic Auth (`apikey:<token>`) with zero credential storage inside the codebase.
- **Multi-Platform Docker Images**: Official multi-architecture images (`linux/amd64` and `linux/arm64`) published to GitHub Container Registry (`ghcr.io`).
- **Hosted Remote MCP Server**: Run as a shared multi-tenant server over HTTP/SSE with Docker Compose, allowing multiple users and AI clients (Cursor, Claude Desktop, autonomous agents) to connect with their own personal API keys.

---

## Project Documentation

- [AGENTS.md](AGENTS.md): Guidelines, coding standards, and workflow instructions for AI coding agents.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): System architecture, layer diagrams, tool schemas, and technical design.
- [docs/DECISIONS.md](docs/DECISIONS.md): Architectural Decision Records (ADRs) documenting stack choices, protocols, and designs.
- [docs/TODO.md](docs/TODO.md): Task tracking, roadmap, and agent check-in policies.

---

## Obtaining an OpenProject API Token

To connect `openproject-mcp` to your OpenProject instance, generate a personal API token:

1. Log in to your OpenProject web interface.
2. In the top-right corner, click on your **user avatar** and select **My account**.
3. In the left navigation menu, click on **Access tokens**.
4. In the **API** row, click **Generate** (or **Reset** if an existing token was lost).
5. Copy the generated API token (it starts with `opapi_` or similar hex/alphanumeric string).
6. Keep this token safe; you will pass it via `OPENPROJECT_API_KEY`.

---

## Running openproject-mcp

You can run `openproject-mcp` using either **Docker** (no local dependencies required) or **Bun** (local development).

### Method 1: Docker (Recommended)

Official multi-architecture container images are published to GitHub Container Registry (`ghcr.io`).

#### Interactive Execution
```bash
docker run -i --rm \
  -e OPENPROJECT_BASE_URL="https://openproject.example.com" \
  -e OPENPROJECT_API_KEY="your-api-key" \
  ghcr.io/stereotypicalcat/openproject-mcp:latest
```

#### Read-Only Mode
To strictly restrict capabilities to read-only browsing:
```bash
docker run -i --rm \
  -e OPENPROJECT_BASE_URL="https://openproject.example.com" \
  -e OPENPROJECT_API_KEY="your-api-key" \
  ghcr.io/stereotypicalcat/openproject-mcp:latest --read-only
```
*(Alternatively, pass `-e OPENPROJECT_READ_ONLY=true`.)*

---

### Method 2: Local Execution with Bun

If you prefer to run from source:

1. Install [Bun](https://bun.sh) (>= 1.2 / 1.3):
   ```bash
   curl -fsSL https://bun.sh/install | bash
   ```

2. Clone and install dependencies:
   ```bash
   git clone https://github.com/StereotypicalCat/openproject-mcp.git
   cd openproject-mcp
   bun install
   ```

3. Run the server:
   ```bash
   OPENPROJECT_BASE_URL="https://openproject.example.com" \
   OPENPROJECT_API_KEY="your-api-key" \
   bun run src/index.ts
   ```

   For read-only mode:
   ```bash
   OPENPROJECT_BASE_URL="https://openproject.example.com" \
   OPENPROJECT_API_KEY="your-api-key" \
   bun run src/index.ts --read-only
   ```

---

### Method 3: Hosted Remote Server (Docker Compose & HTTP/SSE)

Organizations can deploy `openproject-mcp` as a shared remote service. Multiple users and AI clients connect to a single hosted instance over HTTP/SSE, each authenticating with their own personal OpenProject API key.

#### Deploy with Docker Compose
Deploy `docker-compose.server.yml` with built-in health checking:

```bash
# Start hosted MCP server on port 3000
OPENPROJECT_BASE_URL="https://openproject.example.com" \
docker compose -f docker-compose.server.yml up -d

# Optionally override the published host port (e.g. host port 8080 -> container port 3000):
HOST_PORT=8080 OPENPROJECT_BASE_URL="https://openproject.example.com" \
docker compose -f docker-compose.server.yml up -d
```

> **Note on adding to an existing compose file**: Inside the container, the service requires `PORT=3000` (under `environment:`) to activate HTTP/SSE server mode. `HOST_PORT` in `docker-compose.server.yml` is solely used for the outer host-side port mapping (`${HOST_PORT:-3000}:3000`).

#### Run with Bun (from source)
```bash
OPENPROJECT_BASE_URL="https://openproject.example.com" \
PORT=3000 \
bun run src/index.ts
```

In hosted mode:
- The server exposes `GET /health` for container orchestration and uptime monitoring.
- Clients connect via `GET /sse` passing their personal API key via `Authorization: Bearer <key>`, `X-OpenProject-Api-Key: <key>`, or URL parameter `?apiKey=<key>`.
- Each connection establishes an isolated session with dynamic `RequestContext` scoping—no credentials bleed across sessions or persist globally.

---

## MCP Client Configuration

### Claude Desktop

Edit your `claude_desktop_config.json`:
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **Linux**: `~/.config/Claude/claude_desktop_config.json`

#### Option A: Docker (Zero Installation)
```json
{
  "mcpServers": {
    "openproject": {
      "command": "docker",
      "args": [
        "run",
        "-i",
        "--rm",
        "-e", "OPENPROJECT_BASE_URL=https://openproject.example.com",
        "-e", "OPENPROJECT_API_KEY=your-api-key",
        "ghcr.io/stereotypicalcat/openproject-mcp:latest",
        "--read-only"
      ]
    }
  }
}
```

#### Option B: Bun (From Source)
```json
{
  "mcpServers": {
    "openproject": {
      "command": "bun",
      "args": [
        "run",
        "/path/to/openproject-mcp/src/index.ts",
        "--read-only"
      ],
      "env": {
        "OPENPROJECT_BASE_URL": "https://openproject.example.com",
        "OPENPROJECT_API_KEY": "your-api-key"
      }
    }
  }
}
```

---

### Cursor

Add the configuration in `.cursor/mcp.json` (or under **Cursor Settings > Features > MCP**):

#### Docker Configuration
```json
{
  "mcpServers": {
    "openproject": {
      "command": "docker",
      "args": [
        "run",
        "-i",
        "--rm",
        "-e", "OPENPROJECT_BASE_URL=https://openproject.example.com",
        "-e", "OPENPROJECT_API_KEY=your-api-key",
        "ghcr.io/stereotypicalcat/openproject-mcp:latest",
        "--read-only"
      ]
    }
  }
}
```

#### Bun Configuration
```json
{
  "mcpServers": {
    "openproject": {
      "command": "bun",
      "args": [
        "run",
        "/absolute/path/to/openproject-mcp/src/index.ts",
        "--read-only"
      ],
      "env": {
        "OPENPROJECT_BASE_URL": "https://openproject.example.com",
        "OPENPROJECT_API_KEY": "your-api-key"
      }
    }
  }
}
```

---

### Remote Connection to Hosted Server (Cursor & Claude Desktop)

When connecting to an organization's hosted `openproject-mcp` remote server (e.g. `https://mcp.example.com` or `http://localhost:3000`):

#### Cursor (`.cursor/mcp.json`)
Using custom HTTP headers:
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

Or using URL query parameter:
```json
{
  "mcpServers": {
    "openproject": {
      "url": "https://mcp.example.com/sse?apiKey=your-personal-api-key"
    }
  }
}
```

#### Claude Desktop
In `claude_desktop_config.json` or clients connecting directly via SSE URL:
```json
{
  "mcpServers": {
    "openproject": {
      "url": "https://mcp.example.com/sse?apiKey=your-personal-api-key"
    }
  }
}
```

### Open WebUI

Open WebUI supports two connection modes for `openproject-mcp`:

#### Option 1: MCP (Streamable HTTP) — Recommended
1. Navigate to **Admin Panel > Settings > External Tools** (or **User Settings > Tools**).
2. Click **+** (Add Connection).
3. Select **Type**: `MCP (Streamable HTTP)`.
4. Set **URL**:
   - In Docker Compose on shared network: `http://openproject-mcp:3000/mcp` (or `http://openproject-mcp:3000/sse`)
   - From host machine: `http://localhost:3000/mcp`
5. Set **Auth** (optional): `Bearer <your-openproject-api-key>` if multi-user, or leave blank if `OPENPROJECT_API_KEY` is configured in the container.
6. Click **Verify Connection**.

#### Option 2: OpenAPI Mode
If your Open WebUI installation connects to tool servers using OpenAPI:
1. Click **+** (Add Connection).
2. Select **Type**: `OpenAPI`.
3. Set **URL**:
   - In Docker Compose on shared network: `http://openproject-mcp:3000/openapi.json`
   - From host machine: `http://localhost:3000/openapi.json`
4. Set **Auth Header** (optional): `Bearer <your-openproject-api-key>`.
5. Click **Verify Connection**.

---

### Hosted Server Endpoints Reference

When running `openproject-mcp` as an HTTP server (`PORT=3000`), the following endpoints are exposed:

| Endpoint | Method | Protocol / Client | Description |
| :--- | :--- | :--- | :--- |
| `/mcp` | POST, GET, DELETE | MCP Streamable HTTP | Primary endpoint for Open WebUI, Python MCP SDK, and modern Streamable HTTP clients |
| `/sse` | GET, POST, DELETE | MCP SSE & Streamable HTTP | Dual-purpose: `GET` establishes classic SSE stream (Cursor, Claude Desktop); `POST` handles Streamable HTTP |
| `/messages` | POST | Classic MCP SSE | Message posting endpoint for established SSE sessions (`?sessionId=...`) |
| `/openapi.json` | GET | OpenAPI 3.1.0 | OpenAPI specification for Open WebUI (OpenAPI mode), Swagger UI, and REST integrations |
| `/swagger.json` | GET | OpenAPI 3.1.0 | Alias for `/openapi.json` |
| `/api/tools/{name}` | POST | REST Tool Execution | Executes an individual tool with JSON arguments and returns structured JSON output |
| `/health` | GET | Health Check | Service health check returning `{ status: "ok", mode: "remote-mcp" }` |

---

## Interactive Testing with MCP Inspector

You can visually test and debug tool calls, explore parameter schemas, and inspect raw JSON payloads using the official MCP Inspector:

```bash
# Using Bun directly
OPENPROJECT_BASE_URL="http://localhost:8080" \
OPENPROJECT_API_KEY="your-api-key" \
bunx @modelcontextprotocol/inspector bun run src/index.ts
```

Or test the published Docker image:
```bash
bunx @modelcontextprotocol/inspector docker run -i --rm \
  -e OPENPROJECT_BASE_URL="http://localhost:8080" \
  -e OPENPROJECT_API_KEY="your-api-key" \
  ghcr.io/stereotypicalcat/openproject-mcp:latest
```

This launches a local web UI (typically at `http://localhost:5173`) where you can trigger tools and review formatted outputs.

---

## Available MCP Tools

`openproject-mcp` currently exposes 18 tools:

### Projects
- `openproject_list_projects`: List projects with pagination (`offset`, `pageSize`), sorting (`sortBy`), and filtering.
- `openproject_get_project`: Retrieve project details and metadata by ID or identifier (e.g. `projectId: "mcp-test-project"` or `projectId: 4`).

### Work Packages & Activities
- `openproject_list_work_packages`: Query work packages with high-level filters (`projectId`, `status`, `typeId`, `assigneeId`, `priorityId`, `subject`, `pageSize`, `offset`) or custom JSON filter expressions.
- `openproject_get_work_package`: Retrieve detailed information for a specific work package by ID (`workPackageId: 38`), including description, type, status, priority, author, dates, parent, and children.
- `openproject_list_work_package_activities`: Retrieve timeline history, field change logs, and discussions for a work package (`workPackageId: 38`), with optional `onlyComments` filtering.

### Meetings
- `openproject_list_meetings`: List and filter meetings visible to the user by project (`projectId`) or time context (`time: "upcoming"` / `"past"`), with pagination (`offset`, `pageSize`).
- `openproject_get_meeting`: Retrieve detailed meeting information by ID (`id: 2`), including structured agenda items, sections, notes, outcomes, and participants.
- `openproject_search_meetings`: Deep search across meeting titles, locations, and agenda item notes by keyword (`query: "planning"`).

### Wikis
- `openproject_get_wiki_page`: Retrieve wiki page metadata, project, and attachments by numeric ID (`id: 1`).
- `openproject_search_wiki_pages`: Discover and search wiki pages matching keywords or project with smart caching discovery (`query: "architecture"`, `projectId: "demo-project"`).
- `openproject_list_wiki_page_links`: List links connecting work packages to wiki pages (`workPackageId: 38`, `offset`, `pageSize`).

### Saved Queries & Views
- `openproject_list_queries`: List saved queries/views accessible to the authenticated user, optionally scoped to a project.
- `openproject_get_query`: Retrieve saved query configuration and the work packages returned by that query (`queryId: 30`).

### Taxonomies & Metadata
- `openproject_list_types`: List all work package types (e.g., Task, Bug, Feature, Milestone), optionally scoped to a project.
- `openproject_list_statuses`: List all configured work package statuses (e.g., New, In progress, Closed) and their closed flags.
- `openproject_list_priorities`: List all configured priority levels (e.g., Low, Normal, High, Immediate).
- `openproject_list_users`: List users in the OpenProject instance with pagination and status filtering.

### OpenAPI Introspection
- `openproject_get_openapi_spec`: Inspect OpenProject REST API v3 documentation dynamically with in-memory caching.
  - Default / `summary: true`: Returns compact summary of available tags, paths, and usage instructions.
  - `path: "/api/v3/work_packages"`: Returns parameter and operation schemas for a specific endpoint.
  - `tag: "Work Packages"`: Returns all endpoints grouped under a tag.
  - `schema: "WorkPackageModel"`: Returns the JSON Schema definition for a component model.

---

## Example Prompts for AI Assistants

Once connected in Claude Desktop, Cursor, or your agent of choice, you can ask queries such as:

- *"List all projects in OpenProject and tell me which ones are active."*
- *"Show me all open bugs in the 'mcp-test-project' project."*
- *"What work packages are assigned to me, and what are their priorities?"*
- *"Get details for work package #38 including its child tasks."*
- *"Show all comments and discussion history on work package #38."*
- *"List upcoming meetings and show the agenda items for our weekly planning meeting."*
- *"Search our meeting notes to see if anyone discussed the new architecture."*
- *"Find wiki pages discussing 'architecture' or 'setup' and list their attachments."*
- *"What wiki pages are linked to work package #38?"*
- *"Show the saved queries available for project 4 and run 'MCP Active Tasks'."*
- *"What work package types and statuses are available in our OpenProject instance?"*
- *"Inspect the OpenAPI schema for creating work packages using openproject_get_openapi_spec."*

---

## Quickstart: Local OpenProject Test Stack

A complete OpenProject 17 environment with PostgreSQL 17 and Memcached is included via Docker Compose for local testing and agentic validation.

### Prerequisites

- Docker and Docker Compose (v2+)
- [Bun](https://bun.sh) (>= 1.2 / 1.3)

### 1. Start the Environment & Seed Data

Run the start script to boot the containers, wait for health checks, seed sample data, and generate a personal API token:

```bash
./scripts/start.sh
```

Or step-by-step:

```bash
# 1. Start the Docker Compose stack in the background
docker compose up -d

# 2. Wait for health checks, seed test data, and generate credentials
./scripts/seed.sh
```

This will automatically create `.env.test` and `.env.local` containing the generated credentials:

```env
OPENPROJECT_BASE_URL=http://localhost:8080
OPENPROJECT_API_KEY=opapi-...
OPENPROJECT_TEST_PROJECT=mcp-test-project
```

### 2. Verify OpenProject is Running

Once seeded, OpenProject is accessible at [http://localhost:8080](http://localhost:8080):
- **Username**: `admin`
- **Password**: `admin12345678`

Verify the API v3 connection directly using `curl`:

```bash
curl -u "apikey:$(grep OPENPROJECT_API_KEY .env.test | cut -d= -f2)" \
  http://localhost:8080/api/v3/projects
```

### 3. Stop the Stack

```bash
./scripts/stop.sh
# or
docker compose down
```

To also remove database and asset volumes:

```bash
docker compose down -v
```

---

## Configuration Reference

The MCP server accepts configuration through environment variables, CLI arguments, or a `.env` file:

| Variable | Description | Default |
| :--- | :--- | :--- |
| `OPENPROJECT_BASE_URL` | Base URL of the OpenProject instance | `http://localhost:8080` |
| `OPENPROJECT_API_KEY` | Personal API token (required in stdio mode; supplied per-client in HTTP mode) | - |
| `OPENPROJECT_READ_ONLY` | Run server in read-only mode (`true` / `false` or `--read-only`) | `false` |
| `PORT` | HTTP server port when running hosted MCP server, or web port for local dev stack | `3000` (MCP) / `8080` (test stack) |
| `HOST_PORT` | Optional environment fallback for `PORT`, and host-side port in `docker-compose.server.yml` | `3000` |
| `HOST` | Bind host for hosted HTTP server | `0.0.0.0` |
| `TAG` | OpenProject container image tag (local test stack) | `17-slim` |
| `POSTGRES_VERSION` | PostgreSQL container image tag (local test stack) | `17` |

---

## Development

```bash
# Install dependencies
bun install

# Run type checker
bun run typecheck

# Run test suite
bun test

# Run MCP server locally over stdio
bun run src/index.ts

# Run hosted MCP server locally over HTTP/SSE
PORT=3000 bun run src/index.ts
```

---

## Development Roadmap

- **Phase 1 (Completed)**: Read-only browsing tools for projects, work packages, queries, taxonomies, and OpenAPI introspection.
- **Phase 4 (Completed)**: Remote HTTP/SSE transport (`Bun.serve`) with multi-tenant per-session credential scoping and Docker Compose deployment.
- **Phase 3 Extension (Completed)**: Read-only collaboration tools across Meetings, Wikis, and Work Package Activities (18 tools total).
- **Phase 2 (Upcoming)**: Mutating operations (create/update work packages, add comments, log time).
- **Phase 3 (Future)**: Binary attachment downloading and resource streaming.

---

## License

GNU General Public License v3.0 (aligned with OpenProject Community Edition).