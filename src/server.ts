import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { AppConfig } from "./config";
import { OpenProjectClient } from "./client/api-client";
import { runWithContext } from "./context";
import { registerAllTools } from "./tools";
import { formatToolError } from "./tools/common";
import { OpenProjectError } from "./client/errors";

export interface OpenProjectMcpServer {
  server: McpServer;
  client: OpenProjectClient;
  start: (transport?: Transport) => Promise<void>;
  stop: () => Promise<void>;
}

export const SERVER_NAME = "openproject-mcp";
export const SERVER_VERSION = "0.1.0";

/**
 * Creates and configures an OpenProject MCP server instance.
 *
 * @param config - Server configuration including baseUrl, apiKey, and readOnly flag.
 * @returns Configured OpenProjectMcpServer instance with lifecycle methods.
 */
export function createServer(config: AppConfig): OpenProjectMcpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  const client = new OpenProjectClient({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
  });

  // Register all tools with ambient context execution and read-only guards
  registerAllTools(server, {
    readOnly: config.readOnly,
    wrapExecute: async (fn, tool) => {
      if (config.readOnly && !tool.readOnly) {
        return formatToolError(
          new OpenProjectError(
            "SERVER_READ_ONLY",
            "Operation rejected. OpenProject MCP server is running in read-only mode."
          )
        );
      }
      return runWithContext({ client, isReadOnly: config.readOnly }, fn);
    },
  });

  return {
    server,
    client,
    start: async (transport?: Transport) => {
      const activeTransport = transport ?? new StdioServerTransport();
      await server.connect(activeTransport);
      console.error(`[${SERVER_NAME}] Server started (readOnly=${config.readOnly})`);
    },
    stop: async () => {
      await server.close();
      console.error(`[${SERVER_NAME}] Server stopped`);
    },
  };
}
