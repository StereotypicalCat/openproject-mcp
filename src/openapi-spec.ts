/**
 * Dynamic OpenAPI 3.1.0 Specification Generator for OpenProject MCP Tools.
 *
 * Exposes all registered MCP tools as standard REST operations under /api/tools/{toolName},
 * allowing Open WebUI and OpenAPI clients to discover and invoke tools via standard HTTP.
 */

import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { allTools } from "./tools/index.ts";
import type { AppConfig } from "./config/index.ts";
import { SERVER_VERSION } from "./server.ts";

export interface OpenApiSpec {
  openapi: string;
  info: {
    title: string;
    version: string;
    description: string;
  };
  servers: Array<{ url: string; description?: string }>;
  paths: Record<string, Record<string, unknown>>;
  components?: {
    securitySchemes?: Record<string, unknown>;
  };
  security?: Array<Record<string, unknown[]>>;
}

function determineToolTag(name: string): string {
  if (name.includes("project")) return "Projects";
  if (name.includes("work_package")) return "Work Packages";
  if (name.includes("query")) return "Queries";
  if (
    name.includes("type") ||
    name.includes("status") ||
    name.includes("priority") ||
    name.includes("user")
  ) {
    return "Metadata";
  }
  if (name.includes("openapi")) return "OpenAPI";
  return "Tools";
}

/**
 * Generates an OpenAPI 3.1.0 document from registered MCP tools.
 * In read-only mode, mutating tools are excluded from the specification.
 */
export function generateOpenApiSpec(config: AppConfig): OpenApiSpec {
  const isReadOnly = config.readOnly ?? false;
  const tools = allTools.filter((tool) => !isReadOnly || tool.readOnly);

  const paths: Record<string, Record<string, unknown>> = {};

  for (const tool of tools) {
    const rawShape = tool.parameters ?? {};
    const hasParams = Object.keys(rawShape).length > 0;
    const schema = z.object(rawShape);
    const jsonSchema = zodToJsonSchema(schema, {
      target: "openApi3",
      $refStrategy: "none",
    });

    const { $schema: _discard, ...cleanSchema } = jsonSchema as Record<string, unknown>;

    const path = `/api/tools/${tool.name}`;
    paths[path] = {
      post: {
        operationId: tool.name,
        summary: tool.name.replace(/_/g, " "),
        description: tool.description,
        tags: [determineToolTag(tool.name)],
        requestBody: hasParams
          ? {
              description: `Parameters for ${tool.name}`,
              required: true,
              content: {
                "application/json": {
                  schema: cleanSchema,
                },
              },
            }
          : undefined,
        responses: {
          "200": {
            description: "Successful tool execution",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    content: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          type: { type: "string" },
                          text: { type: "string" },
                        },
                      },
                    },
                    data: {
                      description: "Parsed JSON response payload if applicable",
                    },
                    isError: { type: "boolean" },
                  },
                },
              },
            },
          },
          "400": {
            description: "Invalid tool parameters or schema validation error",
          },
          "401": {
            description: "Missing or invalid OpenProject API key",
          },
          "403": {
            description: "Operation rejected (e.g. read-only mode guard)",
          },
          "404": {
            description: "Tool or requested entity not found",
          },
          "500": {
            description: "Internal server or API error",
          },
        },
      },
    };
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "OpenProject MCP Tools API",
      version: SERVER_VERSION,
      description:
        "OpenAPI REST interface for OpenProject MCP tools. Exposes curated OpenProject tools for projects, work packages, queries, metadata, and OpenAPI introspection.",
    },
    servers: [
      {
        url: "/",
        description: "OpenProject MCP Server",
      },
    ],
    components: {
      securitySchemes: {
        BearerAuth: {
          type: "http",
          scheme: "bearer",
          description: "OpenProject API Key provided as Bearer token",
        },
        ApiKeyAuth: {
          type: "apiKey",
          in: "header",
          name: "X-OpenProject-Api-Key",
          description: "OpenProject API Key provided in header",
        },
      },
    },
    security: [{ BearerAuth: [] }, { ApiKeyAuth: [] }],
    paths,
  };
}
