import { describe, expect, test } from "bun:test";
import {
  OpenProjectAuthenticationError,
  OpenProjectClient,
  OpenProjectError,
} from "../src/client/api-client.ts";
import { runWithContext, type RequestContext } from "../src/context.ts";
import { listMeetings, getMeeting, searchMeetings } from "../src/services/meetings.ts";

describe("Meetings Service", () => {
  test("listMeetings serializes project filter and parses meeting items", async () => {
    const mockClient = {
      get: async (path: string) => {
        expect(path).toContain("/api/v3/meetings");
        return {
          _type: "Collection",
          total: 1,
          count: 1,
          pageSize: 20,
          offset: 1,
          _embedded: {
            elements: [
              {
                _type: "Meeting",
                id: 2,
                title: "Weekly Planning",
                state: "open",
                startTime: "2026-09-08T00:22:53Z",
                endTime: "2026-09-08T01:22:53Z",
                duration: "PT1H",
                _links: {
                  project: { href: "/api/v3/projects/1", title: "Demo project" },
                  author: { href: "/api/v3/users/4", title: "Admin" }
                }
              }
            ]
          }
        };
      }
    } as unknown as OpenProjectClient;

    const res = await listMeetings({ projectId: 1 }, mockClient);
    expect(res.total).toBe(1);
    expect(res.elements[0]!.title).toBe("Weekly Planning");
    expect(res.elements[0]!.project.name).toBe("Demo project");
  });

  test("getMeeting fetches details and embeds agenda items", async () => {
    const mockClient = {
      get: async (path: string) => {
        if (path === "/api/v3/meetings/2") {
          return {
            _type: "Meeting",
            id: 2,
            title: "Weekly Planning",
            state: "open",
            startTime: "2026-09-08T00:22:53Z",
            endTime: "2026-09-08T01:22:53Z",
            template: false,
            notify: false,
            _links: {
              project: { href: "/api/v3/projects/1", title: "Demo project" },
              participants: [{ href: "/api/v3/users/4", title: "Admin" }]
            }
          };
        }
        if (path === "/api/v3/meetings/2/agenda_items") {
          return {
            _type: "Collection",
            total: 1,
            _embedded: {
              elements: [
                {
                  _type: "MeetingAgendaItem",
                  id: 10,
                  title: "Good news",
                  position: 1,
                  itemType: "simple",
                  durationInMinutes: 5,
                  notes: { raw: "What went well this week?" },
                  _embedded: { outcomes: [] },
                  _links: { outcomes: [] }
                }
              ]
            }
          };
        }
        throw new Error(`Unexpected path: ${path}`);
      }
    } as unknown as OpenProjectClient;

    const meeting = await getMeeting(2, { includeAgendaItems: true }, mockClient);
    expect(meeting.title).toBe("Weekly Planning");
    expect(meeting.agendaItems).toHaveLength(1);
    expect(meeting.agendaItems![0]!.title).toBe("Good news");
    expect(meeting.agendaItems![0]!.notes).toBe("What went well this week?");
  });

  test("searchMeetings finds matches in agenda notes", async () => {
    const mockClient = {
      get: async (path: string) => {
        if (path.startsWith("/api/v3/meetings?")) {
          return {
            _type: "Collection",
            total: 1,
            _embedded: {
              elements: [
                {
                  _type: "Meeting",
                  id: 2,
                  title: "Weekly Planning",
                  state: "open",
                  startTime: "2026-09-08T00:22:53Z",
                  endTime: "2026-09-08T01:22:53Z",
                  _links: {
                    project: { href: "/api/v3/projects/1", title: "Demo project" }
                  }
                }
              ]
            }
          };
        }
        if (path === "/api/v3/meetings/2/agenda_items") {
          return {
            _type: "Collection",
            total: 1,
            _embedded: {
              elements: [
                {
                  _type: "MeetingAgendaItem",
                  id: 10,
                  title: "Sprint Review",
                  notes: { raw: "Discussed critical architecture improvements." }
                }
              ]
            }
          };
        }
        if (path === "/api/v3/meetings/2") {
          return {
            _type: "Meeting",
            id: 2,
            title: "Weekly Planning",
            state: "open",
            startTime: "2026-09-08T00:22:53Z",
            endTime: "2026-09-08T01:22:53Z",
            _links: {
              project: { href: "/api/v3/projects/1", title: "Demo project" }
            }
          };
        }
        throw new Error(`Unexpected path: ${path}`);
      }
    } as unknown as OpenProjectClient;

    const res = await searchMeetings({ query: "architecture" }, mockClient);
    expect(res.total).toBe(1);
    expect(res.elements[0]!.matchType).toBe("agenda_item");
    expect(res.elements[0]!.matchedAgendaItems![0]!.snippet).toContain("architecture");
  });

  test("searchMeetings matches by title and location", async () => {
    const mockClient = {
      get: async (path: string) => {
        if (path.startsWith("/api/v3/meetings?")) {
          return {
            _type: "Collection",
            total: 2,
            _embedded: {
              elements: [
                {
                  _type: "Meeting",
                  id: 20,
                  title: "Sprint Retrospective",
                  state: "closed",
                  startTime: "2026-09-01T10:00:00Z",
                  endTime: "2026-09-01T11:00:00Z",
                  location: "Room A",
                  _links: {
                    project: { href: "/api/v3/projects/1", title: "Demo" }
                  }
                },
                {
                  _type: "Meeting",
                  id: 21,
                  title: "Standup",
                  state: "open",
                  startTime: "2026-09-02T10:00:00Z",
                  endTime: "2026-09-02T10:15:00Z",
                  location: "Virtual Stage",
                  _links: {
                    project: { href: "/api/v3/projects/1", title: "Demo" }
                  }
                }
              ]
            }
          };
        }
        if (path.includes("/agenda_items")) {
          return { _type: "Collection", total: 0, _embedded: { elements: [] } };
        }
        throw new Error(`Unexpected path: ${path}`);
      }
    } as unknown as OpenProjectClient;

    const titleRes = await searchMeetings({ query: "Retrospective" }, mockClient);
    expect(titleRes.total).toBe(1);
    expect(titleRes.elements[0]!.matchType).toBe("title");
    expect(titleRes.elements[0]!.meeting.id).toBe(20);

    const locRes = await searchMeetings({ query: "Virtual" }, mockClient);
    expect(locRes.total).toBe(1);
    expect(locRes.elements[0]!.matchType).toBe("location");
    expect(locRes.elements[0]!.meeting.id).toBe(21);
  });

  test("searchMeetings slices matched elements according to offset and pageSize", async () => {
    const mockClient = {
      get: async (path: string) => {
        if (path.startsWith("/api/v3/meetings?")) {
          return {
            _type: "Collection",
            total: 3,
            _embedded: {
              elements: [
                {
                  _type: "Meeting",
                  id: 1,
                  title: "Arch Review 1",
                  state: "open",
                  startTime: "2026-09-01T10:00:00Z",
                  endTime: "2026-09-01T11:00:00Z",
                  _links: { project: { href: "/api/v3/projects/1", title: "Demo" } }
                },
                {
                  _type: "Meeting",
                  id: 2,
                  title: "Arch Review 2",
                  state: "open",
                  startTime: "2026-09-02T10:00:00Z",
                  endTime: "2026-09-02T11:00:00Z",
                  _links: { project: { href: "/api/v3/projects/1", title: "Demo" } }
                },
                {
                  _type: "Meeting",
                  id: 3,
                  title: "Arch Review 3",
                  state: "open",
                  startTime: "2026-09-03T10:00:00Z",
                  endTime: "2026-09-03T11:00:00Z",
                  _links: { project: { href: "/api/v3/projects/1", title: "Demo" } }
                }
              ]
            }
          };
        }
        if (path.includes("/agenda_items")) {
          return { _type: "Collection", total: 0, _embedded: { elements: [] } };
        }
        throw new Error(`Unexpected path: ${path}`);
      }
    } as unknown as OpenProjectClient;

    const res = await searchMeetings({ query: "Arch", offset: 2, pageSize: 1 }, mockClient);
    expect(res.total).toBe(3);
    expect(res.count).toBe(1);
    expect(res.pageSize).toBe(1);
    expect(res.offset).toBe(2);
    expect(res.elements[0]!.meeting.id).toBe(2);
  });

  test("searchMeetings iterates candidate pages when total meetings exceed single page size", async () => {
    const requestedOffsets: number[] = [];
    const mockClient = {
      get: async (path: string) => {
        if (path.startsWith("/api/v3/meetings?")) {
          const url = new URL(`http://dummy${path}`);
          const offset = Number(url.searchParams.get("offset") ?? "1");
          requestedOffsets.push(offset);

          if (offset === 1) {
            // Page 1: 100 meetings (the pipeline's candidate batch size), none matching query
            const page1Elements = Array.from({ length: 100 }, (_, i) => ({
              _type: "Meeting",
              id: i + 1,
              title: `Daily Routine ${i + 1}`,
              state: "open",
              startTime: "2026-09-01T10:00:00Z",
              endTime: "2026-09-01T10:30:00Z",
              _links: { project: { href: "/api/v3/projects/1", title: "Demo" } },
            }));
            return {
              _type: "Collection",
              total: 105,
              count: 100,
              pageSize: 100,
              offset: 1,
              _embedded: { elements: page1Elements },
            };
          }

          if (offset === 2) {
            // Page 2: 5 meetings, meeting #102 has matching title
            const page2Elements = Array.from({ length: 5 }, (_, i) => ({
              _type: "Meeting",
              id: 101 + i,
              title: i === 1 ? "Special Architecture Sync" : `Daily Routine ${101 + i}`,
              state: "open",
              startTime: "2026-09-02T10:00:00Z",
              endTime: "2026-09-02T10:30:00Z",
              _links: { project: { href: "/api/v3/projects/1", title: "Demo" } },
            }));
            return {
              _type: "Collection",
              total: 105,
              count: 5,
              pageSize: 100,
              offset: 2,
              _embedded: { elements: page2Elements },
            };
          }
        }
        if (path.includes("/agenda_items")) {
          return { _type: "Collection", total: 0, _embedded: { elements: [] } };
        }
        throw new Error(`Unexpected path: ${path}`);
      },
    } as unknown as OpenProjectClient;

    const res = await searchMeetings({ query: "Architecture" }, mockClient);
    expect(requestedOffsets).toEqual([1, 2]);
    expect(res.total).toBe(1);
    expect(res.elements[0]!.meeting.id).toBe(102);
    expect(res.elements[0]!.meeting.title).toBe("Special Architecture Sync");
  });

  test("listMeetings supports time filter (upcoming and past)", async () => {
    let capturedPath = "";
    const mockClient = {
      get: async (path: string) => {
        capturedPath = path;
        return {
          _type: "Collection",
          total: 0,
          count: 0,
          pageSize: 20,
          offset: 1,
          _embedded: { elements: [] }
        };
      }
    } as unknown as OpenProjectClient;

    await listMeetings({ time: "upcoming" }, mockClient);
    expect(decodeURIComponent(capturedPath)).toContain('"time":{"operator":"upcoming","values":[]}');

    await listMeetings({ time: "past" }, mockClient);
    expect(decodeURIComponent(capturedPath)).toContain('"time":{"operator":"past","values":[]}');
  });

  test("listMeetings resolves project identifier string to ID", async () => {
    let capturedPath = "";
    const mockClient = {
      get: async (path: string) => {
        if (path === "projects/demo-project") {
          return { id: 77 };
        }
        capturedPath = path;
        return {
          _type: "Collection",
          total: 0,
          count: 0,
          pageSize: 20,
          offset: 1,
          _embedded: { elements: [] }
        };
      }
    } as unknown as OpenProjectClient;

    await listMeetings({ projectId: "demo-project" }, mockClient);
    expect(decodeURIComponent(capturedPath)).toContain('"project_id":{"operator":"=","values":["77"]}');
  });

  test("listMeetings resolves ambient RequestContext client when client is omitted", async () => {
    const ambientClient = {
      get: async (path: string) => {
        expect(path).toContain("/api/v3/meetings");
        return {
          _type: "Collection",
          total: 0,
          count: 0,
          pageSize: 20,
          offset: 1,
          _embedded: { elements: [] }
        };
      }
    } as unknown as OpenProjectClient;

    const context: RequestContext = {
      client: ambientClient,
      isReadOnly: false
    };

    await runWithContext(context, async () => {
      const res = await listMeetings();
      expect(res.total).toBe(0);
      expect(res.elements).toEqual([]);
    });
  });

  test("getMeeting with includeAgendaItems=false does not request agenda items", async () => {
    let agendaCalled = false;
    const mockClient = {
      get: async (path: string) => {
        if (path === "/api/v3/meetings/5") {
          return {
            _type: "Meeting",
            id: 5,
            title: "Quick Sync",
            state: "open",
            startTime: "2026-09-08T00:00:00Z",
            endTime: "2026-09-08T00:30:00Z",
            template: true,
            notify: true,
            _links: {
              project: { href: "/api/v3/projects/1", title: "Demo" }
            }
          };
        }
        if (path.includes("/agenda_items")) {
          agendaCalled = true;
          return { _type: "Collection", total: 0, _embedded: { elements: [] } };
        }
        throw new Error(`Unexpected path: ${path}`);
      }
    } as unknown as OpenProjectClient;

    const detail = await getMeeting(5, { includeAgendaItems: false }, mockClient);
    expect(detail.id).toBe(5);
    expect(detail.template).toBe(true);
    expect(detail.notify).toBe(true);
    expect(detail.agendaItems).toBeUndefined();
    expect(agendaCalled).toBe(false);
  });
});

describe("Meetings Fuzzy Search", () => {
  function meetingFixtureClient() {
    return {
      get: async (path: string) => {
        if (path.startsWith("/api/v3/meetings?") || path === "/api/v3/meetings") {
          return {
            _type: "Collection",
            total: 2,
            count: 2,
            pageSize: 50,
            offset: 1,
            _embedded: {
              elements: [
                {
                  _type: "Meeting",
                  id: 1,
                  title: "Approval of Q3 budget",
                  state: "open",
                  startTime: "2026-09-08T00:00:00Z",
                  endTime: "2026-09-08T01:00:00Z",
                  location: "Room A",
                  _links: {
                    project: { href: "/api/v3/projects/1", title: "Demo project" },
                    author: { href: "/api/v3/users/4", title: "Müller" },
                  },
                },
                {
                  _type: "Meeting",
                  id: 2,
                  title: "Weekly sync",
                  state: "open",
                  startTime: "2026-09-09T00:00:00Z",
                  endTime: "2026-09-09T01:00:00Z",
                  _links: {
                    project: { href: "/api/v3/projects/1", title: "Demo project" },
                  },
                },
              ],
            },
          };
        }
        if (path === "/api/v3/meetings/1/agenda_items") {
          return { _type: "Collection", _embedded: { elements: [] } };
        }
        if (path === "/api/v3/meetings/2/agenda_items") {
          return {
            _type: "Collection",
            _embedded: {
              elements: [
                {
                  _type: "MeetingAgendaItem",
                  id: 20,
                  title: "Staffing",
                  notes: { raw: "We agreed on the hiring freeze until January." },
                  position: 1,
                },
              ],
            },
          };
        }
        return { _type: "Collection", _embedded: { elements: [] } };
      },
    } as unknown as OpenProjectClient;
  }

  test("finds a meeting despite a typo in the query", async () => {
    const result = await searchMeetings({ query: "budgt aproval" }, meetingFixtureClient());
    expect(result.elements[0]!.meeting.id).toBe(1);
    expect(result.elements[0]!.score).toBeGreaterThan(0);
  });

  test("finds a meeting with reordered query words", async () => {
    const result = await searchMeetings({ query: "budget approval" }, meetingFixtureClient());
    expect(result.elements[0]!.meeting.id).toBe(1);
  });

  test("finds a meeting by agenda item notes only", async () => {
    const result = await searchMeetings({ query: "hiring freeze" }, meetingFixtureClient());
    expect(result.elements[0]!.meeting.id).toBe(2);
    expect(result.elements[0]!.matchType).toBe("agenda_item");
    expect(result.elements[0]!.matchedAgendaItems?.[0]!.snippet).toContain("hiring freeze");
  });

  test("matches an author name with diacritics", async () => {
    const result = await searchMeetings({ query: "muller" }, meetingFixtureClient());
    expect(result.elements.some((e) => e.meeting.id === 1)).toBe(true);
  });

  test("exact mode finds nothing for a typo", async () => {
    const result = await searchMeetings(
      { query: "budgt aproval", matchMode: "exact" },
      meetingFixtureClient()
    );
    expect(result.elements).toHaveLength(0);
  });

  test("exact mode still finds a literal substring", async () => {
    const result = await searchMeetings(
      { query: "Q3 budget", matchMode: "exact" },
      meetingFixtureClient()
    );
    expect(result.elements[0]!.meeting.id).toBe(1);
  });

  test("reports degradation rather than silently returning fewer results", async () => {
    const client = {
      get: async (path: string) => {
        if (path.includes("agenda_items")) {
          throw new OpenProjectError("server error", { statusCode: 500 });
        }
        return meetingFixtureClient().get(path);
      },
    } as unknown as OpenProjectClient;

    const result = await searchMeetings({ query: "budget" }, client);
    expect(result.degraded).toBe(true);
    expect(result.enrichmentFailures).toBeGreaterThan(0);
  });

  test("propagates an auth failure instead of reporting no results", async () => {
    const client = {
      get: async (path: string) => {
        if (path.includes("agenda_items")) {
          throw new OpenProjectAuthenticationError();
        }
        return meetingFixtureClient().get(path);
      },
    } as unknown as OpenProjectClient;

    await expect(searchMeetings({ query: "budget" }, client)).rejects.toThrow(
      OpenProjectAuthenticationError
    );
  });
});
