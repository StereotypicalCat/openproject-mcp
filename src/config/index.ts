import { z } from "zod";

/**
 * Zod schema for OpenProject MCP server configuration.
 */
export const configSchema = z.object({
  baseUrl: z
    .string({ required_error: "OPENPROJECT_BASE_URL is required" })
    .url("OPENPROJECT_BASE_URL must be a valid URL")
    .transform((val) => val.replace(/\/+$/, "")),
  apiKey: z
    .string({ required_error: "OPENPROJECT_API_KEY is required" })
    .min(1, "OPENPROJECT_API_KEY must not be empty"),
  readOnly: z.boolean().default(false),
});

export type AppConfig = z.infer<typeof configSchema>;

/**
 * Parses and validates configuration from environment variables and CLI arguments.
 *
 * @param env - Environment variable map (defaults to process.env)
 * @param argv - CLI arguments array (defaults to process.argv)
 * @returns Validated AppConfig object
 */
export function parseConfig(
  env: Record<string, string | undefined> = process.env,
  argv: string[] = process.argv
): AppConfig {
  const isReadOnlyArg = argv.includes("--read-only");
  const readOnlyEnv = env.OPENPROJECT_READ_ONLY?.trim().toLowerCase();
  const isReadOnly =
    isReadOnlyArg ||
    readOnlyEnv === "true" ||
    readOnlyEnv === "1" ||
    readOnlyEnv === "yes";

  return configSchema.parse({
    baseUrl: env.OPENPROJECT_BASE_URL,
    apiKey: env.OPENPROJECT_API_KEY,
    readOnly: isReadOnly,
  });
}
