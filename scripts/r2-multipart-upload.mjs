/**
 * Cloudflare R2 可恢复上传器。
 *
 * 小文件使用 PutObject，大文件使用 multipart；凭据仅从进程环境读取，
 * 续传状态不保存任何访问凭据。
 */
import { createHash as create_hash } from "node:crypto";
import { createReadStream as create_read_stream } from "node:fs";
import {
  mkdir,
  readFile as read_file,
  rename,
  stat,
  unlink,
  writeFile as write_file,
} from "node:fs/promises";
import path from "node:path";
import { Transform } from "node:stream";
import { fileURLToPath as file_url_to_path } from "node:url";

import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  HeadObjectCommand,
  ListPartsCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";

export const MIB = 1024 * 1024;
export const MIN_PART_SIZE = 5 * MIB;
export const DEFAULT_PART_SIZE = 16 * MIB;
export const DEFAULT_MULTIPART_THRESHOLD = 16 * MIB;
export const DEFAULT_CONCURRENCY = 3;
export const DEFAULT_MAX_ATTEMPTS = 5;
export const MAX_MULTIPART_PARTS = 10_000;

const STATE_VERSION = 1;
const NON_RETRYABLE_ERROR_NAMES = new Set([
  "AccessDenied",
  "AuthorizationHeaderMalformed",
  "InvalidAccessKeyId",
  "InvalidArgument",
  "NoSuchBucket",
  "SignatureDoesNotMatch",
]);

function positive_integer(value, label) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return parsed;
}

export function create_part_plan(file_size, part_size = DEFAULT_PART_SIZE) {
  if (!Number.isSafeInteger(file_size) || file_size < 0) {
    throw new Error("file_size must be a non-negative safe integer.");
  }
  if (!Number.isSafeInteger(part_size) || part_size < MIN_PART_SIZE) {
    throw new Error(`part_size must be at least ${MIN_PART_SIZE} bytes.`);
  }

  const parts = [];
  for (let start = 0, part_number = 1; start < file_size; part_number += 1) {
    const size = Math.min(part_size, file_size - start);
    parts.push({
      part_number,
      start,
      end: start + size - 1,
      size,
    });
    start += size;
  }
  if (parts.length > MAX_MULTIPART_PARTS) {
    throw new Error(
      `Multipart upload would require ${parts.length} parts; R2 supports at most ${MAX_MULTIPART_PARTS}. Increase part_size.`,
    );
  }
  return parts;
}

export function format_bytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KiB", "MiB", "GiB", "TiB"];
  let value = bytes;
  let unit = "B";
  for (const candidate of units) {
    value /= 1024;
    unit = candidate;
    if (value < 1024) break;
  }
  return `${value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2)} ${unit}`;
}

export function format_progress({
  uploaded_bytes,
  transferred_bytes = uploaded_bytes,
  total_bytes,
  completed_parts,
  total_parts,
  elapsed_ms,
}) {
  const percent = total_bytes === 0 ? 100 : (uploaded_bytes / total_bytes) * 100;
  const bytes_per_second =
    elapsed_ms > 0 ? transferred_bytes / (elapsed_ms / 1000) : 0;
  return `${percent.toFixed(1)}% ${format_bytes(uploaded_bytes)}/${format_bytes(total_bytes)} ${format_bytes(bytes_per_second)}/s parts ${completed_parts}/${total_parts}`;
}

function is_retryable(error) {
  if (NON_RETRYABLE_ERROR_NAMES.has(error?.name)) return false;
  const status = error?.$metadata?.httpStatusCode;
  return status === undefined || status === 408 || status === 429 || status >= 500;
}

export async function retry_operation(
  operation,
  {
    max_attempts = DEFAULT_MAX_ATTEMPTS,
    base_delay_ms = 1_000,
    on_retry = () => {},
    sleep = (delay_ms) => new Promise((resolve) => setTimeout(resolve, delay_ms)),
  } = {},
) {
  for (let attempt = 1; attempt <= max_attempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      if (attempt >= max_attempts || !is_retryable(error)) throw error;
      const delay_ms = base_delay_ms * 2 ** (attempt - 1);
      on_retry({ attempt, next_attempt: attempt + 1, delay_ms, error });
      await sleep(delay_ms);
    }
  }
  throw new Error("Retry loop exited unexpectedly.");
}

export async function sha256_file(file_path) {
  const hash = create_hash("sha256");
  for await (const chunk of create_read_stream(file_path)) hash.update(chunk);
  return hash.digest("hex");
}

function state_file_name(bucket, key) {
  return `${create_hash("sha256").update(`${bucket}\0${key}`).digest("hex")}.json`;
}

export function create_file_state_store(state_directory, bucket, key) {
  const state_path = path.join(state_directory, state_file_name(bucket, key));
  return {
    state_path,
    async load() {
      try {
        return JSON.parse(await read_file(state_path, "utf8"));
      } catch (error) {
        if (error?.code === "ENOENT") return null;
        throw error;
      }
    },
    async save(state) {
      await mkdir(state_directory, { recursive: true });
      const temporary_path = `${state_path}.${process.pid}.tmp`;
      await write_file(temporary_path, `${JSON.stringify(state, null, 2)}\n`, {
        mode: 0o600,
      });
      await rename(temporary_path, state_path);
    },
    async remove() {
      try {
        await unlink(state_path);
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    },
  };
}

function same_upload_identity(state, identity) {
  return (
    state?.version === STATE_VERSION &&
    state.bucket === identity.bucket &&
    state.key === identity.key &&
    state.file_size === identity.file_size &&
    state.sha256 === identity.sha256 &&
    state.part_size === identity.part_size
  );
}

function is_missing_object(error) {
  return (
    error?.name === "NotFound" ||
    error?.name === "NoSuchKey" ||
    error?.$metadata?.httpStatusCode === 404
  );
}

function is_missing_upload(error) {
  return error?.name === "NoSuchUpload" || error?.$metadata?.httpStatusCode === 404;
}

async function inspect_remote_object(client, { bucket, key, file_size, sha256 }) {
  try {
    const response = await client.send(
      new HeadObjectCommand({ Bucket: bucket, Key: key }),
    );
    return {
      exists: true,
      matches: response.ContentLength === file_size && response.Metadata?.sha256 === sha256,
    };
  } catch (error) {
    if (is_missing_object(error)) return { exists: false, matches: false };
    throw error;
  }
}

async function ensure_remote_object_writable(client, identity, allow_overwrite) {
  const remote = await inspect_remote_object(client, identity);
  if (remote.matches) return "matches";
  if (remote.exists && !allow_overwrite) {
    throw new Error(`Refusing to overwrite immutable R2 object with different content: ${identity.key}.`);
  }
  return "writable";
}

async function list_all_parts(client, { bucket, key, upload_id }) {
  const parts = [];
  let marker;
  do {
    const response = await client.send(
      new ListPartsCommand({
        Bucket: bucket,
        Key: key,
        UploadId: upload_id,
        PartNumberMarker: marker,
      }),
    );
    parts.push(...(response.Parts ?? []));
    marker = response.IsTruncated ? response.NextPartNumberMarker : undefined;
  } while (marker !== undefined);
  return parts;
}

function object_headers({ content_type, cache_control, content_disposition, sha256 }) {
  return {
    ContentType: content_type,
    CacheControl: cache_control,
    ContentDisposition: content_disposition,
    Metadata: { sha256 },
  };
}

function default_body_factory(file_path) {
  return ({ start, end }, on_bytes) =>
    create_read_stream(file_path, { start, end }).pipe(
      new Transform({
        transform(chunk, _encoding, callback) {
          on_bytes(chunk.length);
          callback(null, chunk);
        },
      }),
    );
}

export async function upload_multipart_object({
  client,
  bucket,
  key,
  file_path,
  file_size,
  sha256,
  content_type,
  cache_control,
  content_disposition,
  part_size = DEFAULT_PART_SIZE,
  concurrency = DEFAULT_CONCURRENCY,
  max_attempts = DEFAULT_MAX_ATTEMPTS,
  state_store,
  body_factory = default_body_factory(file_path),
  reporter = () => {},
  sleep,
  allow_overwrite = false,
}) {
  const identity = {
    version: STATE_VERSION,
    bucket,
    key,
    file_size,
    sha256,
    part_size,
  };
  const parts = create_part_plan(file_size, part_size);
  const started_at = Date.now();

  if ((await ensure_remote_object_writable(client, identity, allow_overwrite)) === "matches") {
    await state_store.remove();
    reporter({ type: "skip", key, reason: "remote-object-matches" });
    return { skipped: true, resumed: false, uploaded_parts: 0 };
  }

  let state = await state_store.load();
  if (state && !same_upload_identity(state, identity)) {
    if (state.upload_id && state.bucket && state.key) {
      try {
        await client.send(
          new AbortMultipartUploadCommand({
            Bucket: state.bucket,
            Key: state.key,
            UploadId: state.upload_id,
          }),
        );
      } catch (error) {
        if (!is_missing_upload(error)) throw error;
      }
    }
    await state_store.remove();
    state = null;
  }

  let remote_parts = [];
  if (state?.upload_id) {
    try {
      remote_parts = await list_all_parts(client, {
        bucket,
        key,
        upload_id: state.upload_id,
      });
    } catch (error) {
      if (!is_missing_upload(error)) throw error;
      await state_store.remove();
      state = null;
    }
  }

  if (!state) {
    const created = await client.send(
      new CreateMultipartUploadCommand({
        Bucket: bucket,
        Key: key,
        ...object_headers({
          content_type,
          cache_control,
          content_disposition,
          sha256,
        }),
      }),
    );
    if (!created.UploadId) throw new Error(`R2 did not return an upload_id for ${key}.`);
    state = { ...identity, upload_id: created.UploadId, completed_parts: [] };
    await state_store.save(state);
  }

  const plan_by_number = new Map(parts.map((part) => [part.part_number, part]));
  const completed = new Map();
  for (const part of remote_parts) {
    const planned = plan_by_number.get(part.PartNumber);
    if (
      planned &&
      part.ETag &&
      (part.Size === undefined || part.Size === planned.size)
    ) {
      completed.set(part.PartNumber, {
        PartNumber: part.PartNumber,
        ETag: part.ETag,
        Size: planned.size,
      });
    }
  }

  const resumed = completed.size > 0;
  let confirmed_bytes = [...completed.values()].reduce(
    (total, part) => total + part.Size,
    0,
  );
  let transferred_bytes = 0;
  const active_part_bytes = new Map();
  let last_transfer_report_at = 0;
  const report_transfer = (force = false) => {
    const now = Date.now();
    if (!force && now - last_transfer_report_at < 500) return;
    last_transfer_report_at = now;
    const active_bytes = [...active_part_bytes.values()].reduce(
      (total, bytes) => total + bytes,
      0,
    );
    reporter({
      type: "transfer",
      key,
      uploaded_bytes: confirmed_bytes + active_bytes,
      transferred_bytes,
      total_bytes: file_size,
      completed_parts: completed.size,
      total_parts: parts.length,
      elapsed_ms: now - started_at,
    });
  };
  reporter({
    type: resumed ? "resume" : "start",
    key,
    uploaded_bytes: confirmed_bytes,
    total_bytes: file_size,
    completed_parts: completed.size,
    total_parts: parts.length,
  });

  const pending = parts.filter((part) => !completed.has(part.part_number));
  let cursor = 0;
  let persist_queue = Promise.resolve();
  const persist = () => {
    const snapshot = {
      ...state,
      completed_parts: [...completed.values()].sort(
        (a, b) => a.PartNumber - b.PartNumber,
      ),
    };
    persist_queue = persist_queue.then(() => state_store.save(snapshot));
    return persist_queue;
  };

  async function worker() {
    while (cursor < pending.length) {
      const part = pending[cursor];
      cursor += 1;
      const response = await retry_operation(
        () => {
          active_part_bytes.set(part.part_number, 0);
          return client.send(
            new UploadPartCommand({
              Bucket: bucket,
              Key: key,
              UploadId: state.upload_id,
              PartNumber: part.part_number,
              Body: body_factory(part, (bytes) => {
                active_part_bytes.set(
                  part.part_number,
                  (active_part_bytes.get(part.part_number) ?? 0) + bytes,
                );
                transferred_bytes += bytes;
                report_transfer();
              }),
              ContentLength: part.size,
            }),
          );
        },
        {
          max_attempts,
          sleep,
          on_retry: ({ attempt, next_attempt, delay_ms, error }) =>
            reporter({
              type: "retry",
              key,
              part_number: part.part_number,
              attempt,
              next_attempt,
              delay_ms,
              max_attempts,
              error,
            }),
        },
      );
      if (!response.ETag) {
        throw new Error(`R2 did not return an ETag for ${key} part ${part.part_number}.`);
      }
      const measured_bytes = active_part_bytes.get(part.part_number) ?? 0;
      if (measured_bytes < part.size) transferred_bytes += part.size - measured_bytes;
      active_part_bytes.delete(part.part_number);
      completed.set(part.part_number, {
        PartNumber: part.part_number,
        ETag: response.ETag,
        Size: part.size,
      });
      confirmed_bytes += part.size;
      await persist();
      report_transfer(true);
      reporter({
        type: "progress",
        key,
        part_number: part.part_number,
        uploaded_bytes: confirmed_bytes,
        transferred_bytes,
        total_bytes: file_size,
        completed_parts: completed.size,
        total_parts: parts.length,
        elapsed_ms: Date.now() - started_at,
      });
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, Math.max(1, pending.length)) },
      () => worker(),
    ),
  );
  await persist_queue;

  const completed_parts = [...completed.values()]
    .sort((a, b) => a.PartNumber - b.PartNumber)
    .map(({ PartNumber, ETag }) => ({ PartNumber, ETag }));
  await client.send(
    new CompleteMultipartUploadCommand({
      Bucket: bucket,
      Key: key,
      UploadId: state.upload_id,
      MultipartUpload: { Parts: completed_parts },
    }),
  );
  await state_store.remove();
  reporter({ type: "complete", key, total_bytes: file_size, total_parts: parts.length });
  return { skipped: false, resumed, uploaded_parts: pending.length };
}

export async function upload_small_object({
  client,
  bucket,
  key,
  file_path,
  file_size,
  sha256,
  content_type,
  cache_control,
  content_disposition,
  max_attempts = DEFAULT_MAX_ATTEMPTS,
  body_factory = () => create_read_stream(file_path),
  reporter = () => {},
  sleep,
  allow_overwrite = false,
}) {
  const identity = { bucket, key, file_size, sha256 };
  if ((await ensure_remote_object_writable(client, identity, allow_overwrite)) === "matches") {
    reporter({ type: "skip", key, reason: "remote-object-matches" });
    return { skipped: true };
  }
  await retry_operation(
    () =>
      client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body_factory(),
          ContentLength: file_size,
          ...object_headers({
            content_type,
            cache_control,
            content_disposition,
            sha256,
          }),
        }),
      ),
    {
      max_attempts,
      sleep,
      on_retry: ({ attempt, next_attempt, delay_ms, error }) =>
        reporter({
          type: "retry",
          key,
          attempt,
          next_attempt,
          delay_ms,
          max_attempts,
          error,
        }),
    },
  );
  reporter({ type: "complete", key, total_bytes: file_size, total_parts: 1 });
  return { skipped: false };
}

export function create_console_reporter(stream = process.stderr) {
  let live_line_open = false;
  return (event) => {
    if (event.type === "transfer") {
      if (!stream.isTTY) return;
      stream.write(`\r[R2] ${event.key} ${format_progress(event)}`);
      live_line_open = true;
      return;
    }
    if (live_line_open) {
      stream.write("\n");
      live_line_open = false;
    }
    if (event.type === "start") {
      stream.write(`[R2] Uploading ${event.key} in ${event.total_parts} parts.\n`);
    } else if (event.type === "resume") {
      stream.write(
        `[R2] Resuming ${event.key}: ${event.completed_parts}/${event.total_parts} parts already present.\n`,
      );
    } else if (event.type === "retry") {
      const part = event.part_number ? ` part ${event.part_number}` : "";
      stream.write(
        `[R2] Retrying${part} (${event.next_attempt}/${event.max_attempts}) in ${event.delay_ms}ms: ${event.error?.message ?? event.error}\n`,
      );
    } else if (event.type === "progress") {
      stream.write(`[R2] ${event.key} ${format_progress(event)}\n`);
    } else if (event.type === "skip") {
      stream.write(`[R2] Skipping ${event.key}; remote object already matches.\n`);
    } else if (event.type === "complete") {
      stream.write(`[R2] Uploaded ${event.key} (${format_bytes(event.total_bytes)}).\n`);
    }
  };
}

export function create_r2_client(environment = process.env) {
  const account_id = environment.CLOUDFLARE_ACCOUNT_ID;
  const access_key_id =
    environment.CLOUDFLARE_R2_ACCESS_KEY_ID ?? environment.AWS_ACCESS_KEY_ID;
  const secret_access_key =
    environment.CLOUDFLARE_R2_SECRET_ACCESS_KEY ??
    environment.AWS_SECRET_ACCESS_KEY;
  const missing = [
    ["CLOUDFLARE_ACCOUNT_ID", account_id],
    ["CLOUDFLARE_R2_ACCESS_KEY_ID (or AWS_ACCESS_KEY_ID)", access_key_id],
    [
      "CLOUDFLARE_R2_SECRET_ACCESS_KEY (or AWS_SECRET_ACCESS_KEY)",
      secret_access_key,
    ],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missing.length > 0) {
    throw new Error(`Missing R2 S3 credentials: ${missing.join(", ")}.`);
  }
  return new S3Client({
    region: "auto",
    endpoint: `https://${account_id}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: access_key_id, secretAccessKey: secret_access_key },
    maxAttempts: 1,
  });
}

function parse_arguments(argv) {
  const values = {};
  const supported = new Set([
    "bucket",
    "key",
    "file",
    "content-type",
    "cache-control",
    "content-disposition",
    "part-size-mib",
    "multipart-threshold-mib",
    "concurrency",
    "max-attempts",
    "state-dir",
    "allow-overwrite",
  ]);
  for (let index = 0; index < argv.length; index += 2) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (!argument?.startsWith("--") || value === undefined) {
      throw new Error(`Expected --option value, received: ${argument ?? "<empty>"}.`);
    }
    const name = argument.slice(2);
    if (!supported.has(name)) throw new Error(`Unknown option: --${name}.`);
    values[name] = value;
  }
  for (const required of ["bucket", "key", "file", "content-type", "cache-control"]) {
    if (!values[required]) throw new Error(`Missing required option: --${required}.`);
  }
  return values;
}

export async function run_cli(argv = process.argv.slice(2), environment = process.env) {
  const args = parse_arguments(argv);
  const file_stats = await stat(args.file);
  if (!file_stats.isFile()) throw new Error(`Upload source is not a file: ${args.file}`);
  const part_size =
    positive_integer(
      args["part-size-mib"] ?? environment.DOWNCITY_R2_PART_SIZE_MIB ?? 16,
      "part-size-mib",
    ) * MIB;
  if (part_size < MIN_PART_SIZE) {
    throw new Error("part-size-mib must be at least 5 MiB.");
  }
  const multipart_threshold =
    positive_integer(
      args["multipart-threshold-mib"] ??
        environment.DOWNCITY_R2_MULTIPART_THRESHOLD_MIB ??
        16,
      "multipart-threshold-mib",
    ) * MIB;
  const concurrency = positive_integer(
    args.concurrency ?? environment.DOWNCITY_R2_UPLOAD_CONCURRENCY ?? 3,
    "concurrency",
  );
  const max_attempts = positive_integer(
    args["max-attempts"] ?? environment.DOWNCITY_R2_UPLOAD_MAX_ATTEMPTS ?? 5,
    "max-attempts",
  );
  const allow_overwrite = args["allow-overwrite"] === "true";
  if (args["allow-overwrite"] && !["true", "false"].includes(args["allow-overwrite"])) {
    throw new Error("allow-overwrite must be true or false.");
  }
  const client = create_r2_client(environment);
  const sha256 = await sha256_file(args.file);
  const reporter = create_console_reporter();
  const common = {
    client,
    bucket: args.bucket,
    key: args.key,
    file_path: args.file,
    file_size: file_stats.size,
    sha256,
    content_type: args["content-type"],
    cache_control: args["cache-control"],
    content_disposition: args["content-disposition"],
    max_attempts,
    reporter,
    allow_overwrite,
  };
  if (file_stats.size >= multipart_threshold) {
    const state_directory = path.resolve(
      args["state-dir"] ??
        environment.DOWNCITY_R2_MULTIPART_STATE_DIR ??
        ".cache/r2-multipart",
    );
    return upload_multipart_object({
      ...common,
      part_size,
      concurrency,
      state_store: create_file_state_store(
        state_directory,
        args.bucket,
        args.key,
      ),
    });
  }
  return upload_small_object(common);
}

const is_direct_run =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(file_url_to_path(import.meta.url));

if (is_direct_run) {
  run_cli().catch((error) => {
    console.error(`[R2] Upload failed: ${error?.stack ?? error}`);
    process.exitCode = 1;
  });
}
