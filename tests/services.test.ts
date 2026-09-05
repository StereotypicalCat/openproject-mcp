import { describe, expect, test } from "bun:test";
import { resolveClient } from "../src/services/helper.ts";
import { listProjects, getProject, getProjectSchema } from "../src/services/projects.ts";
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

