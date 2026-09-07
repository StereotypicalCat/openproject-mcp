import { describe, expect, test, beforeEach } from "bun:test";
import {
  OpenProjectAuthenticationError,
  OpenProjectClient,
} from "../src/client/api-client.ts";
import { runWithContext, type RequestContext } from "../src/context.ts";
import {
  clearWikiCache,
  getWikiPage,
  listWikiPageLinks,
  searchWikiPages,
} from "../src/services/wikis.ts";

describe("Wikis Service", () => {
  beforeEach(() => {
    clearWikiCache();
  });

  test("getWikiPage retrieves page and attaches files", async () => {
    const mockClient = {
      baseUrl: "http://localhost:8080",
      get: async (path: string) => {
        if (path === "/api/v3/wiki_pages/1") {
          return {
            _type: "WikiPage",
            id: 1,
            title: "Project Wiki",
            _links: {
              project: { href: "/api/v3/projects/1", title: "Demo Project" },
            },
          };
        }
        if (path === "/api/v3/wiki_pages/1/attachments") {
          return {
            _type: "Collection",
            total: 1,
            _embedded: {
              elements: [
                {
                  _type: "Attachment",
                  id: 12,
                  fileName: "architecture.png",
                  fileSize: 45000,
                  contentType: "image/png",
                  _links: {
                    downloadLocation: { href: "/api/v3/attachments/12/content" },
                  },
                },
              ],
            },
          };
        }
        throw new Error(`Unexpected path: ${path}`);
      },
    } as unknown as OpenProjectClient;

    const page = await getWikiPage(1, mockClient);
    expect(page.id).toBe(1);
    expect(page.title).toBe("Project Wiki");
    expect(page.project.id).toBe(1);
    expect(page.attachments).toHaveLength(1);
    expect(page.attachments[0]!.fileName).toBe("architecture.png");
    expect(page.attachments[0]!.fileSize).toBe(45000);
    expect(page.attachments[0]!.contentType).toBe("image/png");
    expect(page.attachments[0]!.downloadUrl).toBe("/api/v3/attachments/12/content");
  });

  test("getWikiPage handles missing attachments collection gracefully", async () => {
    const mockClient = {
      baseUrl: "http://localhost:8080",
      get: async (path: string) => {
        if (path === "/api/v3/wiki_pages/2") {
          return {
            _type: "WikiPage",
            id: 2,
            title: "Quick Notes",
            _links: {
              project: { href: "/api/v3/projects/3", title: "Core App" },
            },
          };
        }
        if (path === "/api/v3/wiki_pages/2/attachments") {
          const err = new Error("Attachments not found");
          (err as unknown as { statusCode: number }).statusCode = 404;
          throw err;
        }
        throw new Error(`Unexpected path: ${path}`);
      },
    } as unknown as OpenProjectClient;

    const page = await getWikiPage(2, mockClient);
    expect(page.id).toBe(2);
    expect(page.title).toBe("Quick Notes");
    expect(page.project.id).toBe(3);
    expect(page.attachments).toEqual([]);
  });

  test("listWikiPageLinks retrieves global wiki page links when workPackageId is omitted", async () => {
    let requestedPath = "";
    let requestedQuery: Record<string, unknown> | undefined;

    const mockClient = {
      baseUrl: "http://localhost:8080",
      get: async (path: string, query?: Record<string, unknown>) => {
        requestedPath = path;
        requestedQuery = query;
        return {
          _type: "Collection",
          total: 1,
          count: 1,
          pageSize: 20,
          offset: 1,
          _embedded: {
            elements: [
              {
                _type: "WikiPageLink",
                id: 10,
                pageTitle: "Design Guidelines",
                pageUrl: "http://localhost:8080/projects/demo/wiki/design",
                provider: "openproject",
                _links: {
                  workPackage: { href: "/api/v3/work_packages/42", title: "Refactor UI" },
                  wikiPage: { href: "/api/v3/wiki_pages/5", title: "Design Guidelines" },
                },
              },
            ],
          },
        };
      },
    } as unknown as OpenProjectClient;

    const result = await listWikiPageLinks({ offset: 1, pageSize: 20 }, mockClient);
    expect(requestedPath).toBe("/api/v3/wiki_page_links");
    expect(requestedQuery?.offset).toBe(1);
    expect(requestedQuery?.pageSize).toBe(20);
    expect(result.total).toBe(1);
    expect(result.elements).toHaveLength(1);
    expect(result.elements[0]!.id).toBe(10);
    expect(result.elements[0]!.pageTitle).toBe("Design Guidelines");
    expect(result.elements[0]!.pageUrl).toBe("http://localhost:8080/projects/demo/wiki/design");
    expect(result.elements[0]!.workPackage?.id).toBe(42);
    expect(result.elements[0]!.workPackage?.title).toBe("Refactor UI");
    expect(result.items).toHaveLength(1);
  });

  test("listWikiPageLinks queries work package specific endpoint when workPackageId is provided", async () => {
    let requestedPath = "";

    const mockClient = {
      baseUrl: "http://localhost:8080",
      get: async (path: string) => {
        requestedPath = path;
        return {
          _type: "Collection",
          total: 0,
          count: 0,
          pageSize: 10,
          offset: 1,
          _embedded: {
            elements: [],
          },
        };
      },
    } as unknown as OpenProjectClient;

    const result = await listWikiPageLinks({ workPackageId: 99 }, mockClient);
    expect(requestedPath).toBe("/api/v3/work_packages/99/wiki_page_links");
    expect(result.total).toBe(0);
    expect(result.elements).toEqual([]);
  });

  test("searchWikiPages matches discovered pages by title substring", async () => {
    const mockClient = {
      baseUrl: "http://localhost:8080",
      get: async (path: string) => {
        if (path.startsWith("/api/v3/wiki_page_links")) {
          return { _type: "Collection", total: 0, _embedded: { elements: [] } };
        }
        if (path === "/api/v3/wiki_pages/1") {
          return {
            _type: "WikiPage",
            id: 1,
            title: "System Architecture",
            _links: { project: { href: "/api/v3/projects/1", title: "Demo" } },
          };
        }
        if (path === "/api/v3/wiki_pages/1/attachments") {
          return { _type: "Collection", total: 0, _embedded: { elements: [] } };
        }
        if (path === "/api/v3/wiki_pages/2") {
          return {
            _type: "WikiPage",
            id: 2,
            title: "Sprint Retrospective",
            _links: { project: { href: "/api/v3/projects/1", title: "Demo" } },
          };
        }
        if (path === "/api/v3/wiki_pages/2/attachments") {
          return { _type: "Collection", total: 0, _embedded: { elements: [] } };
        }
        const err = new Error("Not found");
        (err as unknown as { statusCode: number }).statusCode = 404;
        throw err;
      },
    } as unknown as OpenProjectClient;

    const results = await searchWikiPages({ query: "architecture" }, mockClient);
    expect(results).toHaveLength(1);
    expect(results[0]!.title).toBe("System Architecture");
    expect(results[0]!.id).toBe(1);
    expect(results[0]!.project.id).toBe(1);
    expect(results[0]!.attachmentsCount).toBe(0);
  });

  test("searchWikiPages filters by numeric projectId and string identifier", async () => {
    const mockClient = {
      baseUrl: "http://localhost:8080",
      get: async (path: string) => {
        if (path.startsWith("/api/v3/wiki_page_links")) {
          return { _type: "Collection", total: 0, _embedded: { elements: [] } };
        }
        if (path === "/api/v3/wiki_pages/1") {
          return {
            _type: "WikiPage",
            id: 1,
            title: "Project One Architecture",
            _links: { project: { href: "/api/v3/projects/1", title: "Project 1" } },
          };
        }
        if (path === "/api/v3/wiki_pages/1/attachments") {
          return { _type: "Collection", total: 0, _embedded: { elements: [] } };
        }
        if (path === "/api/v3/wiki_pages/2") {
          return {
            _type: "WikiPage",
            id: 2,
            title: "Project Two Architecture",
            _links: { project: { href: "/api/v3/projects/2", title: "Project 2" } },
          };
        }
        if (path === "/api/v3/wiki_pages/2/attachments") {
          return { _type: "Collection", total: 0, _embedded: { elements: [] } };
        }
        if (path === "projects/proj-two" || path === "/api/v3/projects/proj-two") {
          return { id: 2 };
        }
        const err = new Error("Not found");
        (err as unknown as { statusCode: number }).statusCode = 404;
        throw err;
      },
    } as unknown as OpenProjectClient;

    // Filter by numeric projectId = 1
    const resultsProject1 = await searchWikiPages({ projectId: 1 }, mockClient);
    expect(resultsProject1).toHaveLength(1);
    expect(resultsProject1[0]!.id).toBe(1);

    // Filter by string identifier "proj-two" (resolves to ID 2)
    const resultsProject2 = await searchWikiPages({ projectId: "proj-two" }, mockClient);
    expect(resultsProject2).toHaveLength(1);
    expect(resultsProject2[0]!.id).toBe(2);
  });

  test("searchWikiPages respects limit parameter", async () => {
    const mockClient = {
      baseUrl: "http://localhost:8080",
      get: async (path: string) => {
        if (path.startsWith("/api/v3/wiki_page_links")) {
          return { _type: "Collection", total: 0, _embedded: { elements: [] } };
        }
        if (path === "/api/v3/wiki_pages/1") {
          return {
            _type: "WikiPage",
            id: 1,
            title: "Docs Page 1",
            _links: { project: { href: "/api/v3/projects/1", title: "Project 1" } },
          };
        }
        if (path === "/api/v3/wiki_pages/1/attachments") {
          return { _type: "Collection", total: 0, _embedded: { elements: [] } };
        }
        if (path === "/api/v3/wiki_pages/2") {
          return {
            _type: "WikiPage",
            id: 2,
            title: "Docs Page 2",
            _links: { project: { href: "/api/v3/projects/1", title: "Project 1" } },
          };
        }
        if (path === "/api/v3/wiki_pages/2/attachments") {
          return { _type: "Collection", total: 0, _embedded: { elements: [] } };
        }
        const err = new Error("Not found");
        (err as unknown as { statusCode: number }).statusCode = 404;
        throw err;
      },
    } as unknown as OpenProjectClient;

    const results = await searchWikiPages({ query: "Docs", limit: 1 }, mockClient);
    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe(1);
  });

  test("searchWikiPages caches discovered pages and serves subsequent searches without probing", async () => {
    let probeCount = 0;
    const mockClient = {
      baseUrl: "http://localhost:8080",
      get: async (path: string) => {
        if (path.startsWith("/api/v3/wiki_page_links")) {
          return { _type: "Collection", total: 0, _embedded: { elements: [] } };
        }
        if (path === "/api/v3/wiki_pages/1") {
          probeCount++;
          return {
            _type: "WikiPage",
            id: 1,
            title: "API Architecture Guide",
            _links: { project: { href: "/api/v3/projects/1", title: "Demo" } },
          };
        }
        if (path === "/api/v3/wiki_pages/1/attachments") {
          return { _type: "Collection", total: 0, _embedded: { elements: [] } };
        }
        const err = new Error("Not found");
        (err as unknown as { statusCode: number }).statusCode = 404;
        throw err;
      },
    } as unknown as OpenProjectClient;

    // First search: performs discovery
    const firstResults = await searchWikiPages({ query: "Architecture" }, mockClient);
    expect(firstResults).toHaveLength(1);
    expect(probeCount).toBe(1);

    // Second search: served from in-memory cache without hitting /api/v3/wiki_pages/1 again
    const secondResults = await searchWikiPages({ query: "Guide" }, mockClient);
    expect(secondResults).toHaveLength(1);
    expect(secondResults[0]!.id).toBe(1);
    expect(probeCount).toBe(1);

    // Third search with refreshCache: true forces re-discovery
    const thirdResults = await searchWikiPages(
      { query: "Guide", refreshCache: true },
      mockClient
    );
    expect(thirdResults).toHaveLength(1);
    expect(probeCount).toBe(2);
  });

  test("resolves ambient RequestContext client when client parameter is omitted", async () => {
    const mockClient = {
      baseUrl: "http://localhost:8080",
      get: async (path: string) => {
        if (path === "/api/v3/wiki_pages/1") {
          return {
            _type: "WikiPage",
            id: 1,
            title: "Context Wiki",
            _links: { project: { href: "/api/v3/projects/1", title: "Demo" } },
          };
        }
        if (path === "/api/v3/wiki_pages/1/attachments") {
          return { _type: "Collection", total: 0, _embedded: { elements: [] } };
        }
        if (path.startsWith("/api/v3/wiki_page_links")) {
          return { _type: "Collection", total: 0, _embedded: { elements: [] } };
        }
        const err = new Error("Not found");
        (err as unknown as { statusCode: number }).statusCode = 404;
        throw err;
      },
    } as unknown as OpenProjectClient;

    const context: RequestContext = {
      client: mockClient,
      isReadOnly: false,
    };

    await runWithContext(context, async () => {
      const page = await getWikiPage(1);
      expect(page.title).toBe("Context Wiki");

      const searchRes = await searchWikiPages({ query: "Context" });
      expect(searchRes).toHaveLength(1);
      expect(searchRes[0]!.title).toBe("Context Wiki");
    });
  });

  test("searchWikiPages re-throws 401 authentication errors during discovery instead of swallowing", async () => {
    const mockClient = {
      baseUrl: "http://localhost:8080",
      get: async (path: string) => {
        if (path.startsWith("/api/v3/wiki_page_links")) {
          return { _type: "Collection", total: 0, _embedded: { elements: [] } };
        }
        const err = new OpenProjectAuthenticationError("Invalid API key provided");
        throw err;
      },
    } as unknown as OpenProjectClient;

    expect(searchWikiPages({}, mockClient)).rejects.toThrow("Invalid API key provided");
  });

  test("searchWikiPages re-throws 403 and 429 errors during discovery probe", async () => {
    const mockForbiddenClient = {
      baseUrl: "http://localhost:8080",
      get: async (path: string) => {
        if (path.startsWith("/api/v3/wiki_page_links")) {
          return { _type: "Collection", total: 0, _embedded: { elements: [] } };
        }
        const err = new Error("Access denied");
        (err as unknown as { statusCode: number }).statusCode = 403;
        throw err;
      },
    } as unknown as OpenProjectClient;

    expect(searchWikiPages({}, mockForbiddenClient)).rejects.toThrow("Access denied");

    const mockRateLimitClient = {
      baseUrl: "http://localhost:8080",
      get: async (path: string) => {
        if (path.startsWith("/api/v3/wiki_page_links")) {
          return { _type: "Collection", total: 0, _embedded: { elements: [] } };
        }
        const err = new Error("Too many requests");
        (err as unknown as { statusCode: number }).statusCode = 429;
        throw err;
      },
    } as unknown as OpenProjectClient;

    expect(searchWikiPages({}, mockRateLimitClient)).rejects.toThrow("Too many requests");
  });

  test("searchWikiPages with refreshCache evicts stale deleted pages from cache", async () => {
    let page2Exists = true;
    const mockClient = {
      baseUrl: "http://localhost:8080",
      get: async (path: string) => {
        if (path.startsWith("/api/v3/wiki_page_links")) {
          return { _type: "Collection", total: 0, _embedded: { elements: [] } };
        }
        if (path === "/api/v3/wiki_pages/1") {
          return {
            _type: "WikiPage",
            id: 1,
            title: "First Page",
            _links: { project: { href: "/api/v3/projects/1", title: "Demo" } },
          };
        }
        if (path === "/api/v3/wiki_pages/1/attachments") {
          return { _type: "Collection", total: 0, _embedded: { elements: [] } };
        }
        if (path === "/api/v3/wiki_pages/2" && page2Exists) {
          return {
            _type: "WikiPage",
            id: 2,
            title: "Second Page",
            _links: { project: { href: "/api/v3/projects/1", title: "Demo" } },
          };
        }
        if (path === "/api/v3/wiki_pages/2/attachments" && page2Exists) {
          return { _type: "Collection", total: 0, _embedded: { elements: [] } };
        }
        const err = new Error("Not found");
        (err as unknown as { statusCode: number }).statusCode = 404;
        throw err;
      },
    } as unknown as OpenProjectClient;

    const initialResults = await searchWikiPages({}, mockClient);
    expect(initialResults).toHaveLength(2);

    // Page 2 is subsequently deleted on OpenProject
    page2Exists = false;

    // Refreshing cache should clear stale page 2 from memory
    const refreshedResults = await searchWikiPages({ refreshCache: true }, mockClient);
    expect(refreshedResults).toHaveLength(1);
    expect(refreshedResults[0]!.id).toBe(1);
  });
});
