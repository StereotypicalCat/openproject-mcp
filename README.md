# openproject-mcp

`openproject-mcp` is a Model Context Protocol (MCP) server that connects AI assistants (such as Claude Desktop, Cursor, and Antigravity) to [OpenProject](https://github.com/opf/openproject) via OpenProject's REST API v3.

It allows agents to browse, query, and reason about OpenProject workspaces using personal API keys over standard MCP transports (stdio and HTTP/SSE).

---

## Features

- **Project Discovery**: List accessible projects, inspect hierarchies, and retrieve project details.
- **Work Package Browsing**: Query work packages with status, type, assignee, priority, and custom filters; inspect work package details and parent/child relationships.
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
HOST_PORT=3000 \
docker compose -f docker-compose.server.yml up -d
```

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

`openproject-mcp` currently exposes 11 tools:

### Projects
- `openproject_list_projects`: List projects with pagination (`offset`, `pageSize`), sorting (`sortBy`), and filtering.
- `openproject_get_project`: Retrieve project details and metadata by ID or identifier (e.g. `projectId: "mcp-test-project"` or `projectId: 4`).

### Work Packages
- `openproject_list_work_packages`: Query work packages with high-level filters (`projectId`, `status`, `typeId`, `assigneeId`, `priorityId`, `subject`, `pageSize`, `offset`) or custom JSON filter expressions.
- `openproject_get_work_package`: Retrieve detailed information for a specific work package by ID (`workPackageId: 38`), including description, type, status, priority, author, dates, parent, and children.

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
- **Phase 2 (Upcoming)**: Mutating operations (create/update work packages, add comments, log time).
- **Phase 3**: Attachment reading and document resources.

---

## License

GNU General Public License v3.0 (aligned with OpenProject Community Edition).