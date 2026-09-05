/**
 * OpenProject REST API v3 HTTP Client.
 */

import type { OpenProjectApiErrorPayload } from "./types.ts";

export interface ClientOptions {
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
  fetchFn?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
}

// =============================================================================
// Error Hierarchy
// =============================================================================

export class OpenProjectError extends Error {
  readonly statusCode?: number;
  readonly errorIdentifier?: string;
  readonly details?: unknown;
  readonly code: string;

  constructor(
    message: string,
    options?: {
      statusCode?: number;
      errorIdentifier?: string;
      details?: unknown;
      cause?: unknown;
      code?: string;
    }
  ) {
    super(message);
    this.name = "OpenProjectError";
    this.statusCode = options?.statusCode;
    this.errorIdentifier = options?.errorIdentifier;
    this.details = options?.details;
    this.code = options?.code ?? options?.errorIdentifier ?? "OPENPROJECT_ERROR";
    if (options?.cause) {
      this.cause = options.cause;
    }
  }
}

export class OpenProjectAuthenticationError extends OpenProjectError {
  constructor(
    message = "Authentication failed. Please check your OpenProject API key.",
    options?: { errorIdentifier?: string; details?: unknown; cause?: unknown; code?: string }
  ) {
    super(message, { statusCode: 401, code: options?.code ?? options?.errorIdentifier ?? "OPENPROJECT_AUTH_ERROR", ...options });
    this.name = "OpenProjectAuthenticationError";
  }
}

export class OpenProjectForbiddenError extends OpenProjectError {
  constructor(
    message = "Access forbidden. You do not have permission to access this resource.",
    options?: { errorIdentifier?: string; details?: unknown; cause?: unknown; code?: string }
  ) {
    super(message, { statusCode: 403, code: options?.code ?? options?.errorIdentifier ?? "OPENPROJECT_FORBIDDEN", ...options });
    this.name = "OpenProjectForbiddenError";
  }
}

export class OpenProjectNotFoundError extends OpenProjectError {
  constructor(
    message = "Resource not found.",
    options?: { errorIdentifier?: string; details?: unknown; cause?: unknown; code?: string }
  ) {
    super(message, { statusCode: 404, code: options?.code ?? options?.errorIdentifier ?? "OPENPROJECT_NOT_FOUND", ...options });
    this.name = "OpenProjectNotFoundError";
  }
}

export class OpenProjectConflictError extends OpenProjectError {
  constructor(
    message = "Conflict updating resource. Lock version mismatch.",
    options?: { errorIdentifier?: string; details?: unknown; cause?: unknown; code?: string }
  ) {
    super(message, { statusCode: 409, code: options?.code ?? options?.errorIdentifier ?? "OPENPROJECT_CONFLICT", ...options });
    this.name = "OpenProjectConflictError";
  }
}

export class OpenProjectValidationError extends OpenProjectError {
  constructor(
    message = "Validation failed for request data.",
    options?: { errorIdentifier?: string; details?: unknown; cause?: unknown; code?: string }
  ) {
    super(message, { statusCode: 422, code: options?.code ?? options?.errorIdentifier ?? "OPENPROJECT_VALIDATION_ERROR", ...options });
    this.name = "OpenProjectValidationError";
  }
}

export class OpenProjectRateLimitError extends OpenProjectError {
  readonly retryAfter?: number;

  constructor(
    message = "Rate limit exceeded. Please wait before retrying.",
    options?: { retryAfter?: number; errorIdentifier?: string; details?: unknown; cause?: unknown; code?: string }
  ) {
    super(message, { statusCode: 429, code: options?.code ?? options?.errorIdentifier ?? "OPENPROJECT_RATE_LIMIT", ...options });
    this.name = "OpenProjectRateLimitError";
    this.retryAfter = options?.retryAfter;
  }
}

export class OpenProjectServerError extends OpenProjectError {
  constructor(
    message = "OpenProject internal server error.",
    options?: { statusCode?: number; errorIdentifier?: string; details?: unknown; cause?: unknown; code?: string }
  ) {
    super(message, { statusCode: options?.statusCode ?? 500, code: options?.code ?? options?.errorIdentifier ?? "OPENPROJECT_SERVER_ERROR", ...options });
    this.name = "OpenProjectServerError";
  }
}

export class OpenProjectNetworkError extends OpenProjectError {
  constructor(
    message = "Network error connecting to OpenProject instance.",
    options?: { cause?: unknown; code?: string }
  ) {
    super(message, { code: options?.code ?? "OPENPROJECT_NETWORK_ERROR", ...options });
    this.name = "OpenProjectNetworkError";
  }
}

// =============================================================================
// OpenProject Client Implementation
// =============================================================================

export class OpenProjectClient {
  readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly fetchFn: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  private readonly authHeader: string;

  constructor(options: ClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs ?? 30000;
    this.fetchFn = options.fetchFn ?? fetch;
    this.authHeader = `Basic ${btoa(`apikey:${this.apiKey}`)}`;
  }

  /**
   * Performs an HTTP GET request to OpenProject API v3.
   */
  async get<T>(
    path: string,
    query?: Record<string, string | number | boolean | undefined | null>
  ): Promise<T> {
    const url = this.resolveUrl(path, query);
    return this.request<T>(url, { method: "GET" });
  }

  /**
   * Performs an HTTP POST request to OpenProject API v3.
   */
  async post<T>(path: string, body?: unknown): Promise<T> {
    const url = this.resolveUrl(path);
    return this.request<T>(url, {
      method: "POST",
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  /**
   * Performs an HTTP PATCH request to OpenProject API v3.
   */
  async patch<T>(path: string, body?: unknown): Promise<T> {
    const url = this.resolveUrl(path);
    return this.request<T>(url, {
      method: "PATCH",
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  /**
   * Performs an HTTP DELETE request to OpenProject API v3.
   */
  async delete<T>(path: string): Promise<T> {
    const url = this.resolveUrl(path);
    return this.request<T>(url, { method: "DELETE" });
  }

  /**
   * Resolves a path or full URL against the client's baseUrl and appends query parameters.
   */
  resolveUrl(
    path: string,
    query?: Record<string, string | number | boolean | undefined | null>
  ): string {
    let resolved: string;

    if (path.startsWith("http://") || path.startsWith("https://")) {
      resolved = path;
    } else {
      let normalizedPath = path.startsWith("/") ? path : `/${path}`;
      if (!normalizedPath.startsWith("/api/v3")) {
        normalizedPath = `/api/v3${normalizedPath}`;
      }
      resolved = `${this.baseUrl}${normalizedPath}`;
    }

    if (!query) {
      return resolved;
    }

    const url = new URL(resolved);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }

  /**
   * Sanitizes strings (e.g. error messages) to ensure credentials are never leaked.
   */
  private sanitize(text: string): string {
    if (!this.apiKey) {
      return text;
    }
    let sanitized = text.replaceAll(this.apiKey, "[REDACTED_API_KEY]");
    const base64Auth = btoa(`apikey:${this.apiKey}`);
    sanitized = sanitized.replaceAll(base64Auth, "[REDACTED_AUTH]");
    return sanitized;
  }

  /**
   * Executes an HTTP request with timeout, authentication, and error normalization.
   */
  private async request<T>(url: string, init: RequestInit): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("Authorization", this.authHeader);
    headers.set("Accept", "application/hal+json, application/json");
    if (init.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    let signal = init.signal;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    if (!signal) {
      if (typeof AbortSignal !== "undefined" && "timeout" in AbortSignal) {
        signal = AbortSignal.timeout(this.timeoutMs);
      } else {
        const controller = new AbortController();
        timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
        signal = controller.signal;
      }
    }

    try {
      const response = await this.fetchFn(url, {
        ...init,
        headers,
        signal,
      });

      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      if (response.status === 204) {
        return undefined as unknown as T;
      }

      const contentType = response.headers.get("content-type") || "";
      const isJson = contentType.includes("application/json") || contentType.includes("application/hal+json");

      if (!response.ok) {
        let errorPayload: OpenProjectApiErrorPayload | undefined;
        let rawErrorBody: string | undefined;

        if (isJson) {
          try {
            errorPayload = (await response.json()) as OpenProjectApiErrorPayload;
          } catch {
            // Ignore JSON parse failure on error body
          }
        } else {
          try {
            rawErrorBody = await response.text();
          } catch {
            // Ignore text parse failure
          }
        }

        const message = errorPayload?.message
          ? this.sanitize(errorPayload.message)
          : rawErrorBody
          ? this.sanitize(rawErrorBody.slice(0, 300))
          : `HTTP ${response.status} ${response.statusText}`;

        const errorIdentifier = errorPayload?.errorIdentifier;
        const details = errorPayload?.errors;

        switch (response.status) {
          case 401:
            throw new OpenProjectAuthenticationError(message, { errorIdentifier, details });
          case 403:
            throw new OpenProjectForbiddenError(message, { errorIdentifier, details });
          case 404:
            throw new OpenProjectNotFoundError(message, { errorIdentifier, details });
          case 409:
            throw new OpenProjectConflictError(message, { errorIdentifier, details });
          case 422:
            throw new OpenProjectValidationError(message, { errorIdentifier, details });
          case 429: {
            const retryAfterHeader = response.headers.get("retry-after");
            const retryAfter = retryAfterHeader ? parseInt(retryAfterHeader, 10) : undefined;
            throw new OpenProjectRateLimitError(message, { retryAfter, errorIdentifier, details });
          }
          default:
            if (response.status >= 500) {
              throw new OpenProjectServerError(message, { statusCode: response.status, errorIdentifier, details });
            }
            throw new OpenProjectError(message, { statusCode: response.status, errorIdentifier, details });
        }
      }

      if (isJson) {
        return (await response.json()) as T;
      }

      return (await response.text()) as unknown as T;
    } catch (error) {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      if (error instanceof OpenProjectError) {
        throw error;
      }

      const isTimeout =
        (error as { name?: string })?.name === "TimeoutError" ||
        (error as { name?: string })?.name === "AbortError";

      if (isTimeout) {
        throw new OpenProjectNetworkError(
          `Request to OpenProject timed out after ${this.timeoutMs}ms.`,
          { cause: error }
        );
      }

      const rawMsg = (error as Error)?.message ?? String(error);
      throw new OpenProjectNetworkError(
        `Failed to connect to OpenProject: ${this.sanitize(rawMsg)}`,
        { cause: error }
      );
    }
  }
}
