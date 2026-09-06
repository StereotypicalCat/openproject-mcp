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
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  JSONRPCMessageSchema,
  type JSONRPCMessage,
  type MessageExtraInfo,
} from "@modelcontextprotocol/sdk/types.js";
import type { AppConfig } from "./config/index.ts";
import { OpenProjectClient } from "./client/api-client.ts";
import { runWithContext } from "./context.ts";
import { registerAllTools } from "./tools/index.ts";
import { formatToolError } from "./tools/common.ts";
import { OpenProjectError } from "./client/errors.ts";
import { SERVER_NAME, SERVER_VERSION } from "./server.ts";

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
 */
export function extractApiKey(req: Request, url: URL): string | undefined {
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

interface SessionRecord {
  sessionId: string;
  transport: BunSseTransport;
  server: McpServer;
  client: OpenProjectClient;
  cleanup: () => Promise<void>;
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-OpenProject-Api-Key",
};

/**
 * Starts the hosted HTTP/SSE MCP server with Bun.serve.
 */
export async function startHttpServer(config: AppConfig): Promise<HttpServerInstance> {
  const activeSessions = new Map<string, SessionRecord>();

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
          return new Response(JSON.stringify({ error: "Method not allowed" }), {
            status: 405,
            headers: { "Content-Type": "application/json", ...CORS_HEADERS },
          });
        }
        return new Response(
          JSON.stringify({
            status: "ok",
            mode: "remote-mcp",
            openproject: config.baseUrl,
            readOnly: config.readOnly,
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json", ...CORS_HEADERS },
          }
        );
      }

      // 2. SSE connection initiation endpoint
      if (url.pathname === "/sse") {
        if (req.method !== "GET") {
          return new Response(JSON.stringify({ error: "Method not allowed" }), {
            status: 405,
            headers: { "Content-Type": "application/json", ...CORS_HEADERS },
          });
        }

        const apiKey = extractApiKey(req, url);
        if (!apiKey) {
          return new Response(
            JSON.stringify({
              error:
                "Missing OpenProject API key. Provide via Authorization header, X-OpenProject-Api-Key header, or ?apiKey= query parameter.",
            }),
            {
              status: 401,
              headers: { "Content-Type": "application/json", ...CORS_HEADERS },
            }
          );
        }

        const sessionId = crypto.randomUUID();
        const transport = new BunSseTransport(sessionId);

        const sessionClient = new OpenProjectClient({
          baseUrl: config.baseUrl,
          apiKey,
        });

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
              { client: sessionClient, isReadOnly: config.readOnly },
              fn
            );
          },
        });

        let cleanedUp = false;
        const cleanup = async () => {
          if (cleanedUp) return;
          cleanedUp = true;
          activeSessions.delete(sessionId);
          try {
            await transport.close();
          } catch {}
          try {
            await sessionServer.close();
          } catch {}
        };

        const sessionRecord: SessionRecord = {
          sessionId,
          transport,
          server: sessionServer,
          client: sessionClient,
          cleanup,
        };
        activeSessions.set(sessionId, sessionRecord);

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

        return new Response(stream, {
          status: 200,
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            ...CORS_HEADERS,
          },
        });
      }

      // 3. JSON-RPC message posting endpoint
      if (url.pathname === "/messages") {
        if (req.method !== "POST") {
          return new Response(JSON.stringify({ error: "Method not allowed" }), {
            status: 405,
            headers: { "Content-Type": "application/json", ...CORS_HEADERS },
          });
        }

        const sessionId = url.searchParams.get("sessionId");
        if (!sessionId) {
          return new Response(
            JSON.stringify({ error: "Missing sessionId query parameter" }),
            {
              status: 400,
              headers: { "Content-Type": "application/json", ...CORS_HEADERS },
            }
          );
        }

        const session = activeSessions.get(sessionId);
        if (!session) {
          return new Response(JSON.stringify({ error: "Session not found" }), {
            status: 404,
            headers: { "Content-Type": "application/json", ...CORS_HEADERS },
          });
        }

        let body: unknown;
        try {
          body = await req.json();
        } catch {
          return new Response(JSON.stringify({ error: "Invalid JSON" }), {
            status: 400,
            headers: { "Content-Type": "application/json", ...CORS_HEADERS },
          });
        }

        if (Array.isArray(body)) {
          for (const item of body) {
            const parseResult = JSONRPCMessageSchema.safeParse(item);
            if (!parseResult.success) {
              return new Response(
                JSON.stringify({
                  error: "Invalid JSON-RPC message in batch",
                  details: parseResult.error.format(),
                }),
                {
                  status: 400,
                  headers: { "Content-Type": "application/json", ...CORS_HEADERS },
                }
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
            return new Response(
              JSON.stringify({
                error: "Invalid JSON-RPC message",
                details: parseResult.error.format(),
              }),
              {
                status: 400,
                headers: { "Content-Type": "application/json", ...CORS_HEADERS },
              }
            );
          }

          await runWithContext(
            { client: session.client, isReadOnly: config.readOnly },
            async () => {
              session.transport.handleMessage(parseResult.data);
            }
          );
        }

        return new Response("Accepted", {
          status: 202,
          headers: { "Content-Type": "text/plain", ...CORS_HEADERS },
        });
      }

      // 4. Default Not Found
      return new Response(JSON.stringify({ error: "Not Found" }), {
        status: 404,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      });
    },
  });

  return {
    server,
    port: server.port ?? (config.port ?? 3000),
    async stop() {
      for (const session of activeSessions.values()) {
        await session.cleanup();
      }
      activeSessions.clear();
      server.stop(true);
    },
    getActiveSessionsCount() {
      return activeSessions.size;
    },
  };
}
