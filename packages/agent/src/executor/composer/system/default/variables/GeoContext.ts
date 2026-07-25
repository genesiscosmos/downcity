/**
 * Prompt 地理上下文解析器。
 *
 * 关键点（中文）
 * - 基于公网 IP 服务推断 location + timezone。
 * - 失败时回退到本机时区，保证 prompt 渲染稳定可用。
 * - 使用进程内缓存，避免每次请求都访问外部服务。
 */

import type { PromptGeoContext } from "@executor/composer/system/default/variables/PromptTypes.js";

type IpApiCoResponse = {
  ip?: unknown;
  city?: unknown;
  region?: unknown;
  country_name?: unknown;
  timezone?: unknown;
};

type IpWhoIsResponse = {
  success?: unknown;
  ip?: unknown;
  city?: unknown;
  region?: unknown;
  country?: unknown;
  timezone?: unknown;
};

const GEO_CACHE_TTL_MS = 30 * 60 * 1000;
const GEO_REQUEST_TIMEOUT_MS = 3000;

let cachedGeoContext:
  | {
      value: PromptGeoContext;
      expires_at: number;
    }
  | null = null;
let inFlightGeoContext: Promise<PromptGeoContext> | null = null;

function readString(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const value = input.trim();
  return value ? value : null;
}

function isValidIanaTimezone(input: string | null): input is string {
  if (!input) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: input });
    return true;
  } catch {
    return false;
  }
}

function buildLocation(parts: Array<unknown>): string {
  const values = parts.map(readString).filter((item): item is string => Boolean(item));
  return values.length > 0 ? values.join(", ") : "Unknown";
}

function buildFallbackGeoContext(): PromptGeoContext {
  const timezone = readString(Intl.DateTimeFormat().resolvedOptions().timeZone);
  const safeTimezone = isValidIanaTimezone(timezone) ? timezone : "UTC";
  return {
    ip: "unknown",
    location: "Unknown",
    timezone: safeTimezone,
    source: "local",
  };
}

function writeCache(value: PromptGeoContext): PromptGeoContext {
  cachedGeoContext = {
    value,
    expires_at: Date.now() + GEO_CACHE_TTL_MS,
  };
  return value;
}

async function fetchIpApiGeoContext(): Promise<PromptGeoContext | null> {
  let response: Response;
  try {
    response = await fetch("https://ipapi.co/json/", {
      headers: {
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(GEO_REQUEST_TIMEOUT_MS),
    });
  } catch {
    return null;
  }
  if (!response.ok) return null;

  let data: IpApiCoResponse;
  try {
    data = (await response.json()) as IpApiCoResponse;
  } catch {
    return null;
  }

  const timezone = readString(data.timezone);
  if (!isValidIanaTimezone(timezone)) return null;

  return {
    ip: readString(data.ip) || "unknown",
    location: buildLocation([data.city, data.region, data.country_name]),
    timezone,
    source: "ipapi",
  };
}

function readIpWhoIsTimezone(input: unknown): string | null {
  if (typeof input === "string") return readString(input);
  if (!input || typeof input !== "object") return null;
  return readString((input as { id?: unknown }).id);
}

async function fetchIpWhoIsGeoContext(): Promise<PromptGeoContext | null> {
  let response: Response;
  try {
    response = await fetch("https://ipwho.is/", {
      headers: {
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(GEO_REQUEST_TIMEOUT_MS),
    });
  } catch {
    return null;
  }
  if (!response.ok) return null;

  let data: IpWhoIsResponse;
  try {
    data = (await response.json()) as IpWhoIsResponse;
  } catch {
    return null;
  }

  if (data.success === false) return null;

  const timezone = readIpWhoIsTimezone(data.timezone);
  if (!isValidIanaTimezone(timezone)) return null;

  return {
    ip: readString(data.ip) || "unknown",
    location: buildLocation([data.city, data.region, data.country]),
    timezone,
    source: "ipwhois",
  };
}

async function loadGeoContext(): Promise<PromptGeoContext> {
  const now = Date.now();
  if (cachedGeoContext && now < cachedGeoContext.expires_at) {
    return cachedGeoContext.value;
  }

  if (inFlightGeoContext) return inFlightGeoContext;

  inFlightGeoContext = (async () => {
    const ipApiResult = await fetchIpApiGeoContext();
    if (ipApiResult) return writeCache(ipApiResult);

    const ipWhoIsResult = await fetchIpWhoIsGeoContext();
    if (ipWhoIsResult) return writeCache(ipWhoIsResult);

    return writeCache(buildFallbackGeoContext());
  })().finally(() => {
    inFlightGeoContext = null;
  });

  return inFlightGeoContext;
}

/**
 * 解析 prompt 所需地理上下文。
 */
export async function resolvePromptGeoContext(): Promise<PromptGeoContext> {
  return loadGeoContext();
}
