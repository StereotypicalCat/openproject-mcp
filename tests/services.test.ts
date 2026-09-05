import { describe, expect, test } from "bun:test";
import { resolveClient } from "../src/services/helper.ts";
import { listProjects, getProject, getProjectSchema } from "../src/services/projects.ts";
import {
  listWorkPackages,
  getWorkPackage,
  searchWorkPackages,
} from "../src/services/work-packages.ts";
import { listQueries, getQuery, getQueryResults } from "../src/services/queries.ts";
import { OpenProjectClient } from "../src/client/api-client.ts";
import { runWithContext, type RequestContext } from "../src/context.ts";

describe("Domain Services Helper", () => {
  test("resolveClient returns explicit client if provided", () => {
    const customClient = new OpenProjectClient({
      baseUrl: "http://example.com",
      apiKey: "custom-key",
    });
    const result = resolveClient(customClient);
    expect(result).toBe(customClient);
  });

  test("resolveClient falls back to getRequestContext().client when omitted", () => {
    const ambientClient = new OpenProjectClient({
      baseUrl: "http://example.com",
      apiKey: "ambient-key",
    });
    const context: RequestContext = {
      client: ambientClient,
      isReadOnly: false,
    };

    runWithContext(context, () => {
      const result = resolveClient();
      expect(result).toBe(ambientClient);
    });
  });

  test("resolveClient throws error when called without client and outside context", () => {
    expect(() => resolveClient()).toThrow("No active RequestContext found");
  });
});

describe("Projects Service", () => {
  const sampleProjectHal = {
    _type: "Project",
    id: 4,
    identifier: "mcp-test-project",
    name: "MCP Test Project",
    active: true,
    public: true,
    description: { format: "markdown", raw: "Dedicated test project" },
    _links: {
      self: { href: "/api/v3/projects/4", title: "MCP Test Project" },
      parent: { href: "/api/v3/projects/1", title: "Parent Project" },
    },
  };

  test("listProjects sends correct parameters and returns paginated ProjectSummary items", async () => {
    let requestedUrl = "";
    const mockFetch = async (input: string | URL | Request) => {
      requestedUrl = String(input);
      return new Response(
        JSON.stringify({
          _type: "Collection",
          total: 1,
          count: 1,
          pageSize: 10,
          offset: 1,
          _embedded: {
            elements: [sampleProjectHal],
          },
        }),
        { headers: { "Content-Type": "application/hal+json" } }
      );
    };

    const client = new OpenProjectClient({
      baseUrl: "http://example.com",
      apiKey: "test-key",
      fetchFn: mockFetch,
    });

    const result = await listProjects({ pageSize: 10, offset: 1, sortBy: '[["name","asc"]]' }, client);

    expect(requestedUrl).toContain("/api/v3/projects");
    expect(requestedUrl).toContain("pageSize=10");
    expect(requestedUrl).toContain("offset=1");
    expect(requestedUrl).toContain("sortBy=");
    expect(result.total).toBe(1);
    expect(result.items[0].id).toBe(4);
    expect(result.items[0].identifier).toBe("mcp-test-project");
    expect(result.items[0].name).toBe("MCP Test Project");
  });

  test("getProject retrieves project detail by id or identifier", async () => {
    let requestedUrl = "";
    const mockFetch = async (input: string | URL | Request) => {
      requestedUrl = String(input);
      return new Response(JSON.stringify(sampleProjectHal), {
        headers: { "Content-Type": "application/hal+json" },
      });
    };

    const client = new OpenProjectClient({
      baseUrl: "http://example.com",
      apiKey: "test-key",
      fetchFn: mockFetch,
    });

    const result = await getProject("mcp-test-project", client);
    expect(requestedUrl).toContain("/api/v3/projects/mcp-test-project");
    expect(result.id).toBe(4);
    expect(result.parentId).toBe(1);
    expect(result.parentName).toBe("Parent Project");
  });

  test("getProjectSchema retrieves project schema definition", async () => {
    const mockFetch = async () => {
      return new Response(JSON.stringify({ _type: "Schema", name: { type: "String" } }), {
        headers: { "Content-Type": "application/json" },
      });
    };

    const client = new OpenProjectClient({
      baseUrl: "http://example.com",
      apiKey: "test-key",
      fetchFn: mockFetch,
    });

    const result = await getProjectSchema(client);
    expect(result._type).toBe("Schema");
  });
});

describe("Work Packages Service", () => {
  const sampleWpHal = {
    _type: "WorkPackage",
    id: 38,
    subject: "Implement MCP Server Core Protocol",
    description: { format: "markdown", raw: "Build stdio transport" },
    startDate: "2026-09-01",
    dueDate: "2026-09-10",
    lockVersion: 3,
    _links: {
      self: { href: "/api/v3/work_packages/38", title: "Implement MCP Server Core Protocol" },
      project: { href: "/api/v3/projects/4", title: "MCP Test Project" },
      type: { href: "/api/v3/types/1", title: "Task" },
      status: { href: "/api/v3/statuses/2", title: "In progress" },
      priority: { href: "/api/v3/priorities/8", title: "High" },
      author: { href: "/api/v3/users/1", title: "Admin User" },
      assignee: { href: "/api/v3/users/1", title: "Admin User" },
      parent: { href: "/api/v3/work_packages/30", title: "Epic Parent" },
      children: [
        { href: "/api/v3/work_packages/39", title: "Subtask 1" },
        { href: "/api/v3/work_packages/40", title: "Subtask 2" },
      ],
    },
  };

  test("listWorkPackages applies filter parameters and normalizes collection", async () => {
    let requestedUrl = "";
    const mockFetch = async (input: string | URL | Request) => {
      requestedUrl = String(input);
      return new Response(
        JSON.stringify({
          _type: "Collection",
          total: 1,
          count: 1,
          pageSize: 25,
          offset: 1,
          _embedded: { elements: [sampleWpHal] },
        }),
        { headers: { "Content-Type": "application/hal+json" } }
      );
    };

    const client = new OpenProjectClient({
      baseUrl: "http://example.com",
      apiKey: "test-key",
      fetchFn: mockFetch,
    });

    const result = await listWorkPackages(
      { projectId: 4, status: "open", typeId: 1, pageSize: 25 },
      client
    );

    expect(requestedUrl).toContain("/api/v3/work_packages");
    expect(requestedUrl).toContain("filters=");
    expect(requestedUrl).toContain("pageSize=25");
    expect(result.total).toBe(1);
    expect(result.items[0].id).toBe(38);
    expect(result.items[0].subject).toBe("Implement MCP Server Core Protocol");
    expect(result.items[0].status).toBe("In progress");
    expect(result.items[0].type).toBe("Task");
  });

  test("getWorkPackage returns full details with parent and children", async () => {
    const mockFetch = async () => {
      return new Response(JSON.stringify(sampleWpHal), {
        headers: { "Content-Type": "application/hal+json" },
      });
    };

    const client = new OpenProjectClient({
      baseUrl: "http://example.com",
      apiKey: "test-key",
      fetchFn: mockFetch,
    });

    const wp = await getWorkPackage(38, client);
    expect(wp.id).toBe(38);
    expect(wp.subject).toBe("Implement MCP Server Core Protocol");
    expect(wp.parent?.id).toBe(30);
    expect(wp.parent?.subject).toBe("Epic Parent");
    expect(wp.children?.length).toBe(2);
    expect(wp.children?.[0].id).toBe(39);
    expect(wp.lockVersion).toBe(3);
  });

  test("searchWorkPackages sets subject query filter", async () => {
    let requestedUrl = "";
    const mockFetch = async (input: string | URL | Request) => {
      requestedUrl = String(input);
      return new Response(
        JSON.stringify({
          _type: "Collection",
          total: 1,
          count: 1,
          pageSize: 10,
          offset: 1,
          _embedded: { elements: [sampleWpHal] },
        }),
        { headers: { "Content-Type": "application/hal+json" } }
      );
    };

    const client = new OpenProjectClient({
      baseUrl: "http://example.com",
      apiKey: "test-key",
      fetchFn: mockFetch,
    });

    await searchWorkPackages("MCP Server", { projectId: 4 }, client);
    expect(requestedUrl).toContain("filters=");
    // Filter must include substring operator for subject
    const decodedUrl = decodeURIComponent(requestedUrl.replace(/\+/g, " "));
    expect(decodedUrl).toContain('"subject"');
    expect(decodedUrl).toContain("MCP Server");
  });
});

describe("Queries Service", () => {
  const sampleQueryHal = {
    _type: "Query",
    id: 30,
    name: "MCP Active Tasks",
    public: true,
    starred: false,
    _links: {
      self: { href: "/api/v3/queries/30", title: "MCP Active Tasks" },
      project: { href: "/api/v3/projects/4", title: "MCP Test Project" },
      results: { href: "/api/v3/queries/30/results" },
      columns: [
        { href: "/api/v3/queries/columns/id", title: "ID" },
        { href: "/api/v3/queries/columns/subject", title: "Subject" },
        { href: "/api/v3/queries/columns/status", title: "Status" },
      ],
      sortBy: [
        { href: "/api/v3/queries/sort_bys/id-asc", title: "ID ascending" },
      ],
    },
    filters: [
      {
        _links: {
          operator: { href: "/api/v3/queries/operators/=", title: "is" },
          filter: { href: "/api/v3/queries/filters/status", title: "Status" },
        },
        name: "status",
        values: ["open"],
      },
    ],
  };

  test("listQueries filters by project when provided", async () => {
    let requestedUrl = "";
    const mockFetch = async (input: string | URL | Request) => {
      requestedUrl = String(input);
      return new Response(
        JSON.stringify({
          _type: "Collection",
          total: 1,
          count: 1,
          pageSize: 20,
          offset: 1,
          _embedded: { elements: [sampleQueryHal] },
        }),
        { headers: { "Content-Type": "application/hal+json" } }
      );
    };

    const client = new OpenProjectClient({
      baseUrl: "http://example.com",
      apiKey: "test-key",
      fetchFn: mockFetch,
    });

    const result = await listQueries({ projectId: 4, pageSize: 20 }, client);
    expect(requestedUrl).toContain("/api/v3/queries");
    expect(requestedUrl).toContain("pageSize=20");
    const decodedUrl = decodeURIComponent(requestedUrl);
    expect(decodedUrl).toContain('"project"');
    expect(result.items[0].id).toBe(30);
    expect(result.items[0].name).toBe("MCP Active Tasks");
    expect(result.items[0].projectId).toBe(4);
  });

  test("getQuery returns normalized details with columns and filters", async () => {
    const mockFetch = async () => {
      return new Response(JSON.stringify(sampleQueryHal), {
        headers: { "Content-Type": "application/hal+json" },
      });
    };

    const client = new OpenProjectClient({
      baseUrl: "http://example.com",
      apiKey: "test-key",
      fetchFn: mockFetch,
    });

    const query = await getQuery(30, client);
    expect(query.id).toBe(30);
    expect(query.name).toBe("MCP Active Tasks");
    expect(query.columns).toContain("ID");
    expect(query.columns).toContain("Subject");
    expect(query.sortBy?.[0].attribute).toBe("id");
    expect(query.sortBy?.[0].direction).toBe("asc");
    expect(query.filters?.[0].field).toBe("Status");
    expect(query.resultsHref).toBe("/api/v3/queries/30/results");
  });

  test("getQueryResults fetches work packages produced by saved query", async () => {
    let requestedUrl = "";
    const mockFetch = async (input: string | URL | Request) => {
      requestedUrl = String(input);
      return new Response(
        JSON.stringify({
          _type: "Collection",
          total: 1,
          count: 1,
          pageSize: 10,
          offset: 1,
          _embedded: {
            elements: [
              {
                _type: "WorkPackage",
                id: 38,
                subject: "Implement MCP Server Core Protocol",
                _links: {
                  self: { href: "/api/v3/work_packages/38" },
                  type: { title: "Task" },
                  status: { title: "In progress" },
                },
              },
            ],
          },
        }),
        { headers: { "Content-Type": "application/hal+json" } }
      );
    };

    const client = new OpenProjectClient({
      baseUrl: "http://example.com",
      apiKey: "test-key",
      fetchFn: mockFetch,
    });

    const result = await getQueryResults(30, { pageSize: 10 }, client);
    expect(requestedUrl).toContain("/api/v3/queries/30/results");
    expect(requestedUrl).toContain("pageSize=10");
    expect(result.items[0].id).toBe(38);
    expect(result.items[0].subject).toBe("Implement MCP Server Core Protocol");
  });
});
