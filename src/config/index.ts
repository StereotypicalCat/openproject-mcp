import { z } from "zod";

/**
 * Zod schema for OpenProject MCP server configuration.
 */
export const configSchema = z
  .object({
    baseUrl: z
      .string({ required_error: "OPENPROJECT_BASE_URL is required" })
      .url("OPENPROJECT_BASE_URL must be a valid URL")
      .transform((val) => val.replace(/\/+$/, "")),
    apiKey: z
      .string()
      .min(1, "OPENPROJECT_API_KEY must not be empty")
      .optional(),
    readOnly: z.boolean().default(false),
    port: z.number().int().min(0).max(65535).optional(),
    host: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.port === undefined && (!data.apiKey || data.apiKey.trim().length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "OPENPROJECT_API_KEY is required in stdio mode (when port is not set)",
        path: ["apiKey"],
      });
    }
  });

export type AppConfig = z.infer<typeof configSchema>;

/**
 * Helper to parse a CLI argument flag that may take a value either as
 * `--flag value` or `--flag=value`.
 */
function parseCliArg(argv: string[], flag: string): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg) continue;
    if (arg === flag) {
      const nextArg = argv[i + 1];
      if (nextArg !== undefined && !nextArg.startsWith("-")) {
        return nextArg;
      }
    } else if (arg.startsWith(`${flag}=`)) {
      return arg.slice(flag.length + 1);
    }
  }
  return undefined;
}

/**
 * Parses and validates configuration from environment variables and CLI arguments.
 *
 * @param env - Environment variable map (defaults to process.env)
 * @param argv - CLI arguments array (defaults to process.argv)
 * @returns Validated AppConfig object
 */
export function loadConfig(
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

  const portArg = parseCliArg(argv, "--port");
  const portStr = portArg ?? env.PORT;
  let port: number | undefined;
  if (portStr !== undefined && portStr.trim() !== "") {
    const parsed = parseInt(portStr.trim(), 10);
    if (Number.isNaN(parsed)) {
      throw new Error(`Invalid port value: ${portStr}`);
    }
    port = parsed;
  }

  const hostArg = parseCliArg(argv, "--host");
  const hostStr = hostArg ?? env.HOST;
  const host = hostStr !== undefined && hostStr.trim() !== "" ? hostStr.trim() : undefined;

  const apiKeyRaw = env.OPENPROJECT_API_KEY?.trim();
  const apiKey = apiKeyRaw !== undefined && apiKeyRaw.length > 0 ? apiKeyRaw : undefined;

  return configSchema.parse({
    baseUrl: env.OPENPROJECT_BASE_URL,
    apiKey,
    readOnly: isReadOnly,
    port,
    host,
  });
}

export const parseConfig = loadConfig;

