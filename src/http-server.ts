/**
 * Hosted Remote MCP Server implementation over HTTP/SSE.
 *
 * Provides a multi-tenant HTTP/SSE MCP server using native Bun.serve.
 * Incoming SSE connections supply their personal OpenProject API keys
 * via Authorization: Bearer, X-OpenProject-Api-Key, or ?apiKey= query parameter.
 * Each connection runs in an isolated session with its own OpenProjectClient
 * and McpServer instance.
 */

import type { Server } from "bun";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  JSONRPCMessageSchema,
  type JSONRPCMessage,
  type MessageExtraInfo,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { AppConfig } from "./config/index.ts";
import { OpenProjectClient } from "./client/api-client.ts";
import { runWithContext } from "./context.ts";
import { registerAllTools, allTools } from "./tools/index.ts";
import { formatToolError } from "./tools/common.ts";
import { OpenProjectError } from "./client/errors.ts";
import { SERVER_NAME, SERVER_VERSION } from "./server.ts";
import { generateOpenApiSpec } from "./openapi-spec.ts";

export interface HttpServerInstance {
  server: Server<unknown>;
  port: number;
  stop(): Promise<void>;
  getActiveSessionsCount(): number;
}

/**
 * Extracts OpenProject API key from incoming request according to precedence:
 * 1. Authorization: Bearer <key>
 * 2. X-OpenProject-Api-Key: <key>
 * 3. ?apiKey=<key> query parameter
 * 4. Server-configured defaultApiKey fallback (single-tenant deployments)
 */
export function extractApiKey(
  req: Request,
  url: URL,
  defaultApiKey?: string
): string | undefined {
  const authHeader = req.headers.get("authorization");
  if (authHeader) {
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (match && match[1] && match[1].trim().length > 0) {
      return match[1].trim();
    }
  }

  const headerKey = req.headers.get("x-openproject-api-key");
  if (headerKey && headerKey.trim().length > 0) {
    return headerKey.trim();
  }

  const queryKey = url.searchParams.get("apiKey");
  if (queryKey && queryKey.trim().length > 0) {
    return queryKey.trim();
  }

  if (defaultApiKey && defaultApiKey.trim().length > 0) {
    return defaultApiKey.trim();
  }

  return undefined;
}

/**
 * Custom SSE Transport for native Bun Web Streams.
 */
export class BunSseTransport implements Transport {
  readonly sessionId: string;
  private controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  private closed = false;
  private readonly encoder = new TextEncoder();

  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: <T extends JSONRPCMessage>(message: T, extra?: MessageExtraInfo) => void;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  setController(controller: ReadableStreamDefaultController<Uint8Array>): void {
    this.controller = controller;
  }

  async start(): Promise<void> {
    if (!this.controller) {
      throw new Error("SSE stream controller not initialized");
    }
    const endpoint = `/messages?sessionId=${this.sessionId}`;
    this.sendRawEvent("endpoint", endpoint);
  }

  private sendRawEvent(event: string, data: string): void {
    if (this.closed || !this.controller) {
      return;
    }
    try {
      this.controller.enqueue(this.encoder.encode(`event: ${event}\ndata: ${data}\n\n`));
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.onerror?.(error);
    }
  }

  async send(message: JSONRPCMessage): Promise<void> {
    if (this.closed) {
      throw new Error("Transport is closed");
    }
    this.sendRawEvent("message", JSON.stringify(message));
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      this.controller?.close();
    } catch {
      // Ignore if already closed or cancelled
    }
    this.controller = null;
    this.onclose?.();
  }

  handleMessage(message: JSONRPCMessage, extra?: MessageExtraInfo): void {
    if (this.closed) {
      throw new Error("Session transport is closed");
    }
    this.onmessage?.(message, extra);
  }
}

interface SseSessionRecord {
  sessionId: string;
  transport: BunSseTransport;
  server: McpServer;
  client: OpenProjectClient;
  cleanup: () => Promise<void>;
}

interface StreamableSessionRecord {
  sessionId: string;
  transport: WebStandardStreamableHTTPServerTransport;
  server: McpServer;
  client: OpenProjectClient;
  cleanup: () => Promise<void>;
  lastActive: number;
}

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-OpenProject-Api-Key, Mcp-Session-Id, Last-Event-ID, Mcp-Protocol-Version",
  "Access-Control-Expose-Headers": "Mcp-Session-Id, Mcp-Protocol-Version",
};

/**
 * Attaches CORS headers to a response if not already set.
 */
function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    if (!headers.has(key)) {
      headers.set(key, value);
    }
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Normalizes an incoming Request for Streamable HTTP compliance:
 * - Ensures Accept includes both application/json and text/event-stream (preventing 406 on clients like Open WebUI)
 * - Propagates sessionId from query parameter to Mcp-Session-Id header if missing
 */
function normalizeMcpRequest(req: Request): Request {
  const headers = new Headers(req.headers);
  const accept = headers.get("accept") ?? "";
  if (!accept.includes("application/json") || !accept.includes("text/event-stream")) {
    headers.set("accept", "application/json, text/event-stream");
  }
  const sessionId =
    headers.get("mcp-session-id") ??
    new URL(req.url).searchParams.get("sessionId") ??
    new URL(req.url).searchParams.get("mcp-session-id");
  if (sessionId && !headers.has("mcp-session-id")) {
    headers.set("mcp-session-id", sessionId);
  }
  return new Request(req, { headers });
}

/**
 * Checks if a parsed JSON-RPC payload is or contains an initialize request.
 */
function isInitializeMessage(msg: unknown): boolean {
  if (!msg || typeof msg !== "object") return false;
  if (Array.isArray(msg)) return msg.some(isInitializeMessage);
  return (msg as { method?: unknown }).method === "initialize";
}

/**
 * Helper to construct an McpServer instance with all tools registered and execution wrapped in RequestContext.
 */
function createSessionServer(
  config: AppConfig,
  client: OpenProjectClient
): McpServer {
  const sessionServer = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  registerAllTools(sessionServer, {
    readOnly: config.readOnly,
    wrapExecute: async (fn, tool) => {
      if (config.readOnly && !tool.readOnly) {
        return formatToolError(
          new OpenProjectError(
            "Operation rejected. OpenProject MCP server is running in read-only mode.",
            { code: "SERVER_READ_ONLY" }
          )
        );
      }
      return runWithContext(
        { client, isReadOnly: config.readOnly },
        fn
      );
    },
  });

  return sessionServer;
}

/**
 * Starts the hosted HTTP/SSE MCP server with Bun.serve.
 * Supports both classic SSE transport (GET /sse + POST /messages) and
 * modern Streamable HTTP transport (POST/GET/DELETE on /sse, /mcp, and /).
 */
export async function startHttpServer(config: AppConfig): Promise<HttpServerInstance> {
  const activeSseSessions = new Map<string, SseSessionRecord>();
  const activeStreamableSessions = new Map<string, StreamableSessionRecord>();

  // Periodically clean up inactive Streamable HTTP sessions (TTL: 1 hour)
  const SESSION_TTL_MS = 60 * 60 * 1000;
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [, session] of activeStreamableSessions.entries()) {
      if (now - session.lastActive > SESSION_TTL_MS) {
        session.cleanup().catch(() => {});
      }
    }
  }, 5 * 60 * 1000);

  /**
   * Handles Streamable HTTP transport requests (POST, GET, DELETE).
   */
  async function handleStreamableRequest(req: Request, url: URL): Promise<Response> {
    const normReq = normalizeMcpRequest(req);

    // 1. DELETE request terminates session
    if (req.method === "DELETE") {
      const sessionId =
        normReq.headers.get("mcp-session-id") ?? url.searchParams.get("sessionId");
      if (!sessionId) {
        return withCors(
          new Response(JSON.stringify({ error: "Missing session ID" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          })
        );
      }
      const session = activeStreamableSessions.get(sessionId);
      if (!session) {
        return withCors(
          new Response(JSON.stringify({ error: "Session not found" }), {
            status: 404,
            headers: { "Content-Type": "application/json" },
          })
        );
      }
      await session.cleanup();
      return withCors(new Response(null, { status: 204 }));
    }

    // 2. GET request on session (SSE stream for server-to-client notifications)
    if (req.method === "GET") {
      const sessionId =
        normReq.headers.get("mcp-session-id") ?? url.searchParams.get("sessionId");
      if (!sessionId) {
        return withCors(
          new Response(
            JSON.stringify({
              error:
                "Missing Mcp-Session-Id header. To initiate a Streamable HTTP session, send a POST initialize request.",
            }),
            {
              status: 400,
              headers: { "Content-Type": "application/json" },
            }
          )
        );
      }
      const session = activeStreamableSessions.get(sessionId);
      if (!session) {
        return withCors(
          new Response(JSON.stringify({ error: "Session not found" }), {
            status: 404,
            headers: { "Content-Type": "application/json" },
          })
        );
      }
      session.lastActive = Date.now();
      const res = await runWithContext(
        { client: session.client, isReadOnly: config.readOnly },
        () => session.transport.handleRequest(normReq)
      );
      return withCors(res);
    }

    if (req.method !== "POST") {
      return withCors(
        new Response(JSON.stringify({ error: "Method not allowed" }), {
          status: 405,
          headers: { "Content-Type": "application/json" },
        })
      );
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return withCors(
        new Response(JSON.stringify({ error: "Invalid JSON" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        })
      );
    }

    const sessionId =
      normReq.headers.get("mcp-session-id") ?? url.searchParams.get("sessionId");

    // Existing session message (already authenticated upon initialization)
    if (sessionId && !isInitializeMessage(body)) {
      const session = activeStreamableSessions.get(sessionId);
      if (!session) {
        return withCors(
          new Response(JSON.stringify({ error: "Session not found" }), {
            status: 404,
            headers: { "Content-Type": "application/json" },
          })
        );
      }
      session.lastActive = Date.now();
      const res = await runWithContext(
        { client: session.client, isReadOnly: config.readOnly },
        () => session.transport.handleRequest(normReq, { parsedBody: body })
      );
      return withCors(res);
    }

    // 3. New session initialization or stateless request requires API key
    const apiKey = extractApiKey(req, url, config.apiKey);
    if (!apiKey) {
      return withCors(
        new Response(
          JSON.stringify({
            error:
              "Missing OpenProject API key. Provide via Authorization header, X-OpenProject-Api-Key header, or ?apiKey= query parameter.",
          }),
          {
            status: 401,
            headers: { "Content-Type": "application/json" },
          }
        )
      );
    }

    // New session initialization
    if (isInitializeMessage(body)) {
      const newSessionId = crypto.randomUUID();
      const sessionClient = new OpenProjectClient({
        baseUrl: config.baseUrl,
        apiKey,
      });
      const sessionServer = createSessionServer(config, sessionClient);
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: () => newSessionId,
        enableJsonResponse: true,
      });
      await sessionServer.connect(transport);

      let cleanedUp = false;
      const cleanup = async () => {
        if (cleanedUp) return;
        cleanedUp = true;
        activeStreamableSessions.delete(newSessionId);
        try {
          await transport.close();
        } catch {}
        try {
          await sessionServer.close();
        } catch {}
      };

      const record: StreamableSessionRecord = {
        sessionId: newSessionId,
        transport,
        server: sessionServer,
        client: sessionClient,
        cleanup,
        lastActive: Date.now(),
      };
      activeStreamableSessions.set(newSessionId, record);

      const res = await runWithContext(
        { client: sessionClient, isReadOnly: config.readOnly },
        () => transport.handleRequest(normReq, { parsedBody: body })
      );
      return withCors(res);
    }

    // Stateless fallback request (e.g. tools/list or tools/call without session ID)
    const statelessClient = new OpenProjectClient({
      baseUrl: config.baseUrl,
      apiKey,
    });
    const statelessServer = createSessionServer(config, statelessClient);
    const statelessTransport = new WebStandardStreamableHTTPServerTransport({
      enableJsonResponse: true,
    });
    await statelessServer.connect(statelessTransport);
    try {
      const res = await runWithContext(
        { client: statelessClient, isReadOnly: config.readOnly },
        () => statelessTransport.handleRequest(normReq, { parsedBody: body })
      );
      return withCors(res);
    } finally {
      await statelessTransport.close().catch(() => {});
      await statelessServer.close().catch(() => {});
    }
  }

  const server = Bun.serve({
    port: config.port ?? 3000,
    hostname: config.host || "0.0.0.0",
    async fetch(req: Request): Promise<Response> {
      const url = new URL(req.url);

      // Handle CORS preflight
      if (req.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: CORS_HEADERS,
        });
      }

      // 1. Health check endpoint
      if (url.pathname === "/health") {
        if (req.method !== "GET") {
          return withCors(
            new Response(JSON.stringify({ error: "Method not allowed" }), {
              status: 405,
              headers: { "Content-Type": "application/json" },
            })
          );
        }
        return withCors(
          new Response(
            JSON.stringify({
              status: "ok",
              mode: "remote-mcp",
              openproject: config.baseUrl,
              readOnly: config.readOnly,
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }
          )
        );
      }

      // 2. OpenAPI specification endpoint
      if (url.pathname === "/openapi.json" || url.pathname === "/swagger.json") {
        if (req.method !== "GET") {
          return withCors(
            new Response(JSON.stringify({ error: "Method not allowed" }), {
              status: 405,
              headers: { "Content-Type": "application/json" },
            })
          );
        }
        const spec = generateOpenApiSpec(config);
        return withCors(
          new Response(JSON.stringify(spec, null, 2), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        );
      }

      // 3. REST tool execution endpoint (OpenAPI callers)
      if (
        url.pathname.startsWith("/api/tools/") ||
        url.pathname.startsWith("/tools/")
      ) {
        if (req.method !== "POST") {
          return withCors(
            new Response(JSON.stringify({ error: "Method not allowed" }), {
              status: 405,
              headers: { "Content-Type": "application/json" },
            })
          );
        }

        const toolName = url.pathname.replace(/^\/(api\/)?tools\//, "");
        const tool = allTools.find((t) => t.name === toolName);
        if (!tool) {
          return withCors(
            new Response(JSON.stringify({ error: `Tool '${toolName}' not found` }), {
              status: 404,
              headers: { "Content-Type": "application/json" },
            })
          );
        }

        if (config.readOnly && !tool.readOnly) {
          return withCors(
            new Response(
              JSON.stringify({
                error:
                  "Operation rejected. OpenProject MCP server is running in read-only mode.",
                code: "SERVER_READ_ONLY",
              }),
              {
                status: 403,
                headers: { "Content-Type": "application/json" },
              }
            )
          );
        }

        const apiKey = extractApiKey(req, url, config.apiKey);
        if (!apiKey) {
          return withCors(
            new Response(
              JSON.stringify({
                error:
                  "Missing OpenProject API key. Provide via Authorization header, X-OpenProject-Api-Key header, or ?apiKey= query parameter.",
              }),
              {
                status: 401,
                headers: { "Content-Type": "application/json" },
              }
            )
          );
        }

        let body: unknown = {};
        const text = await req.text();
        if (text.trim().length > 0) {
          try {
            body = JSON.parse(text);
          } catch {
            return withCors(
              new Response(JSON.stringify({ error: "Invalid JSON" }), {
                status: 400,
                headers: { "Content-Type": "application/json" },
              })
            );
          }
        }

        let args: Record<string, unknown> = {};
        if (tool.parameters) {
          const parseResult = z.object(tool.parameters).safeParse(body);
          if (!parseResult.success) {
            return withCors(
              new Response(
                JSON.stringify({
                  error: "Validation error",
                  details: parseResult.error.format(),
                }),
                {
                  status: 400,
                  headers: { "Content-Type": "application/json" },
                }
              )
            );
          }
          args = parseResult.data as Record<string, unknown>;
        } else if (typeof body === "object" && body !== null) {
          args = body as Record<string, unknown>;
        }

        const client = new OpenProjectClient({ baseUrl: config.baseUrl, apiKey });
        const toolResponse = await runWithContext(
          { client, isReadOnly: config.readOnly },
          () => tool.execute(args as any)
        );

        let parsedData: unknown;
        try {
          if (toolResponse.content?.[0]?.text) {
            parsedData = JSON.parse(toolResponse.content[0].text);
          }
        } catch {}

        return withCors(
          new Response(
            JSON.stringify({
              content: toolResponse.content,
              isError: toolResponse.isError ?? false,
              ...(parsedData !== undefined ? { data: parsedData } : {}),
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }
          )
        );
      }

      // 4. Classic MCP SSE endpoint: GET /sse without Mcp-Session-Id header
      if (
        url.pathname === "/sse" &&
        req.method === "GET" &&
        !req.headers.has("mcp-session-id")
      ) {
        const apiKey = extractApiKey(req, url, config.apiKey);
        if (!apiKey) {
          return withCors(
            new Response(
              JSON.stringify({
                error:
                  "Missing OpenProject API key. Provide via Authorization header, X-OpenProject-Api-Key header, or ?apiKey= query parameter.",
              }),
              {
                status: 401,
                headers: { "Content-Type": "application/json" },
              }
            )
          );
        }

        const sessionId = crypto.randomUUID();
        const transport = new BunSseTransport(sessionId);

        const sessionClient = new OpenProjectClient({
          baseUrl: config.baseUrl,
          apiKey,
        });

        const sessionServer = createSessionServer(config, sessionClient);

        let cleanedUp = false;
        const cleanup = async () => {
          if (cleanedUp) return;
          cleanedUp = true;
          activeSseSessions.delete(sessionId);
          try {
            await transport.close();
          } catch {}
          try {
            await sessionServer.close();
          } catch {}
        };

        const sessionRecord: SseSessionRecord = {
          sessionId,
          transport,
          server: sessionServer,
          client: sessionClient,
          cleanup,
        };
        activeSseSessions.set(sessionId, sessionRecord);

        if (req.signal.aborted) {
          cleanup().catch(() => {});
        } else {
          req.signal.addEventListener("abort", () => {
            cleanup().catch(() => {});
          });
        }

        const stream = new ReadableStream<Uint8Array>({
          async start(controller) {
            transport.setController(controller);
            try {
              await sessionServer.connect(transport);
            } catch (err) {
              await cleanup();
              try {
                controller.error(err);
              } catch {}
            }
          },
          cancel() {
            cleanup().catch(() => {});
          },
        });

        return withCors(
          new Response(stream, {
            status: 200,
            headers: {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache, no-transform",
              "Connection": "keep-alive",
            },
          })
        );
      }

      // 3. Classic MCP JSON-RPC message posting endpoint: POST /messages
      if (url.pathname === "/messages") {
        if (req.method !== "POST") {
          return withCors(
            new Response(JSON.stringify({ error: "Method not allowed" }), {
              status: 405,
              headers: { "Content-Type": "application/json" },
            })
          );
        }

        const sessionId = url.searchParams.get("sessionId");
        if (!sessionId) {
          return withCors(
            new Response(
              JSON.stringify({ error: "Missing sessionId query parameter" }),
              {
                status: 400,
                headers: { "Content-Type": "application/json" },
              }
            )
          );
        }

        const session = activeSseSessions.get(sessionId);
        if (!session) {
          return withCors(
            new Response(JSON.stringify({ error: "Session not found" }), {
              status: 404,
              headers: { "Content-Type": "application/json" },
            })
          );
        }

        let body: unknown;
        try {
          body = await req.json();
        } catch {
          return withCors(
            new Response(JSON.stringify({ error: "Invalid JSON" }), {
              status: 400,
              headers: { "Content-Type": "application/json" },
            })
          );
        }

        if (Array.isArray(body)) {
          for (const item of body) {
            const parseResult = JSONRPCMessageSchema.safeParse(item);
            if (!parseResult.success) {
              return withCors(
                new Response(
                  JSON.stringify({
                    error: "Invalid JSON-RPC message in batch",
                    details: parseResult.error.format(),
                  }),
                  {
                    status: 400,
                    headers: { "Content-Type": "application/json" },
                  }
                )
              );
            }
          }
          await runWithContext(
            { client: session.client, isReadOnly: config.readOnly },
            async () => {
              for (const item of body) {
                session.transport.handleMessage(item as JSONRPCMessage);
              }
            }
          );
        } else {
          const parseResult = JSONRPCMessageSchema.safeParse(body);
          if (!parseResult.success) {
            return withCors(
              new Response(
                JSON.stringify({
                  error: "Invalid JSON-RPC message",
                  details: parseResult.error.format(),
                }),
                {
                  status: 400,
                  headers: { "Content-Type": "application/json" },
                }
              )
            );
          }

          await runWithContext(
            { client: session.client, isReadOnly: config.readOnly },
            async () => {
              session.transport.handleMessage(parseResult.data);
            }
          );
        }

        return withCors(
          new Response("Accepted", {
            status: 202,
            headers: { "Content-Type": "text/plain" },
          })
        );
      }

      // 4. Streamable HTTP MCP endpoints: /sse (POST/DELETE/GET with session), /mcp, /
      const isStreamablePath =
        url.pathname === "/sse" ||
        url.pathname === "/mcp" ||
        url.pathname === "/" ||
        url.pathname === "";

      if (isStreamablePath) {
        return handleStreamableRequest(req, url);
      }

      // 5. Default Not Found
      return withCors(
        new Response(JSON.stringify({ error: "Not Found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        })
      );
    },
  });

  return {
    server,
    port: server.port ?? (config.port ?? 3000),
    async stop() {
      clearInterval(cleanupInterval);
      for (const session of activeSseSessions.values()) {
        await session.cleanup();
      }
      activeSseSessions.clear();
      for (const session of activeStreamableSessions.values()) {
        await session.cleanup();
      }
      activeStreamableSessions.clear();
      server.stop(true);
    },
    getActiveSessionsCount() {
      return activeSseSessions.size + activeStreamableSessions.size;
    },
  };
}
