import { describe, expect, test } from "bun:test";
import { OpenProjectClient } from "../src/client/api-client.ts";
import { listWorkPackageActivities } from "../src/services/work-packages.ts";

describe("Work Package Activities Service", () => {
  test("parses activities and separates comments from field changes", async () => {
    const mockClient = {
      get: async (path: string) => {
        expect(path).toBe("/api/v3/work_packages/38/activities");
        return {
          _type: "Collection",
          total: 2,
          count: 2,
          _embedded: {
            elements: [
              {
                _type: "Activity",
                id: 60,
                version: 1,
                createdAt: "2026-09-05T14:24:56Z",
                comment: { raw: "", html: "" },
                details: [
                  { format: "custom", raw: "Status set to In progress" }
                ],
                _links: {
                  user: { href: "/api/v3/users/2", title: "Admin User" }
                }
              },
              {
                _type: "Activity",
                id: 61,
                version: 2,
                createdAt: "2026-09-05T15:00:00Z",
                comment: { raw: "Fixed in commit abc1234", html: "<p>Fixed</p>" },
                details: [],
                _links: {
                  user: { href: "/api/v3/users/3", title: "Dev User" }
                }
              }
            ]
          }
        };
      }
    } as unknown as OpenProjectClient;

    const all = await listWorkPackageActivities({ workPackageId: 38 }, mockClient);
    expect(all).toHaveLength(2);
    expect(all[0].isComment).toBe(false);
    expect(all[1].isComment).toBe(true);
    expect(all[1].comment).toBe("Fixed in commit abc1234");
    expect(all[1].user?.name).toBe("Dev User");

    const commentsOnly = await listWorkPackageActivities({ workPackageId: 38, onlyComments: true }, mockClient);
    expect(commentsOnly).toHaveLength(1);
    expect(commentsOnly[0].id).toBe(61);
  });

  test("handles empty activities collection and fallback user formatting", async () => {
    const mockClient = {
      get: async () => ({
        _type: "Collection",
        total: 1,
        count: 1,
        _embedded: {
          elements: [
            {
              id: 99,
              version: 1,
              createdAt: "2026-09-05T16:00:00Z",
              _links: {
                user: { href: "/api/v3/users/42" }
              }
            }
          ]
        }
      })
    } as unknown as OpenProjectClient;

    const res = await listWorkPackageActivities({ workPackageId: 10 }, mockClient);
    expect(res).toHaveLength(1);
    expect(res[0].id).toBe(99);
    expect(res[0].user).toEqual({ id: 42, name: "User #42" });
    expect(res[0].comment).toBeUndefined();
    expect(res[0].isComment).toBe(false);
    expect(res[0].details).toEqual([]);
  });

  test("handles missing _embedded or empty elements gracefully", async () => {
    const mockClient = {
      get: async () => ({
        _type: "Collection",
        total: 0,
        count: 0
      })
    } as unknown as OpenProjectClient;

    const res = await listWorkPackageActivities({ workPackageId: 10 }, mockClient);
    expect(res).toEqual([]);
  });
});
