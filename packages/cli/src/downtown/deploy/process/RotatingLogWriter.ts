/**
 * Bounded, byte-preserving log storage for one exclusive Writable owner per path.
 *
 * The active file defaults to 20 MiB, with .1 (newest) through .5 (oldest)
 * archives: at most 120 MiB in total. A supervisor can use max_bytes: 2 * 1024
 * * 1024 and archive_count: 3 for an 8 MiB total. Only the active path and the
 * configured .1..N paths are inspected or removed; unrelated files are untouched.
 * Existing oversized active files or archives are rejected without truncation.
 * Explicitly archive elsewhere or clean up oversized old files before retrying.
 *
 * Writes are serialized by Writable, with a 64 KiB high-water mark. Callers must
 * respect write() backpressure and handle errors (or use pipeline); a runner must
 * stop its producer on writer failure. No runner integration is performed here.
 * Chunks are raw bytes, so rotation may split UTF-8 sequences. Concatenate files
 * from oldest to newest before decoding when reconstructing retained output.
 *
 * Initialization happens in _construct. _final syncs and closes the active file;
 * _destroy waits for the in-flight operation before closing its handle. There is
 * no private write queue, retry loop, payload diagnostic, or asynchronous constructor.
 * The caller must prevent concurrent writers and external changes to this directory;
 * filesystem rotation is not a transaction across processes or a crash boundary.
 */
import { constants, type Stats } from "node:fs";
import { chmod, lstat, mkdir, open, rename, unlink, type FileHandle } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Writable } from "node:stream";

/** Size and retention limits, measured independently for each managed file. */
type RotatingLogOptions = {
  /** Maximum bytes per active file or archive; a positive safe integer, default 20 MiB. */
  max_bytes?: number;
  /** Number of numbered archives to retain; a positive safe integer, default five. */
  archive_count?: number;
};

/** Normalize thrown values without putting log payloads into diagnostics. */
function as_error(error: unknown): Error {
  return error instanceof Error ? error : new Error("Rotating log operation failed.");
}

/** Validate numeric limits before constructing a stream or touching the filesystem. */
function positive_integer(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer.`);
  }
  return value;
}

/** Serial file writer; Node's Writable owns buffering and error propagation. */
class RotatingLogWriter extends Writable {
  /** Absolute path of the active log; numbered archives append .1 through .N. */
  private readonly file_path: string;
  /** Maximum size of every active or archived file, in actual buffer bytes. */
  private readonly max_bytes: number;
  /** Number of archives owned by this writer; paths beyond this count are untouched. */
  private readonly archive_count: number;
  /** Sole active file handle, retained until a rotation, finalization, or destruction. */
  private file_handle: FileHandle | undefined;
  /** Successfully written bytes in the active file, including its existing contents. */
  private current_bytes = 0;
  /** Single in-flight operation; destruction awaits it without maintaining a queue. */
  private pending_operation: Promise<void> = Promise.resolve();

  /** Perform only synchronous argument validation; attach stream error handlers immediately. */
  constructor(file_path: string, options: RotatingLogOptions = {}) {
    if (typeof file_path !== "string" || file_path.length === 0) {
      throw new TypeError("A nonempty rotating log path is required.");
    }
    const active_path = resolve(file_path);
    const max_bytes = positive_integer(options.max_bytes ?? 20 * 1024 * 1024, "max_bytes");
    const archive_count = positive_integer(options.archive_count ?? 5, "archive_count");
    // Validate before super: Writable may schedule _construct even if construction throws.
    super({ highWaterMark: 64 * 1024, decodeStrings: true, autoDestroy: true });
    this.file_path = active_path;
    this.max_bytes = max_bytes;
    this.archive_count = archive_count;
  }

  /** Initialize privately and reject unsafe or oversized existing managed files. */
  override _construct(callback: (error?: Error | null) => void): void {
    this.complete_operation(this.initialize(), callback);
  }

  /** Feed a single chunk to serial file operations; Writable schedules the next chunk. */
  override _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.complete_operation(this.write_chunk(chunk), callback);
  }

  /** Flush successful writes to the filesystem before reporting stream completion. */
  override _final(callback: (error?: Error | null) => void): void {
    this.complete_operation(this.finish_file(), callback);
  }

  /** Preserve the original failure while releasing a handle even during an active write. */
  override _destroy(error: Error | null, callback: (error?: Error | null) => void): void {
    void this.pending_operation.catch(() => undefined).then(() => this.close_handle()).then(
      () => callback(error),
      (close_error: unknown) => callback(error
        ? new AggregateError([error, as_error(close_error)], "Rotating log failed and could not close.")
        : as_error(close_error)),
    );
  }

  /** Bridge one promise into the stream callback; failed operations destroy the stream. */
  private complete_operation(operation: Promise<void>, callback: (error?: Error | null) => void): void {
    this.pending_operation = operation;
    void operation.then(() => callback(), (error: unknown) => callback(as_error(error)));
  }

  /** Return only regular, bounded files; lstat deliberately does not follow symlinks. */
  private async inspect_file(file_path: string): Promise<Stats | undefined> {
    let file_stat: Stats;
    try {
      file_stat = await lstat(file_path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
    if (!file_stat.isFile()) {
      throw new Error(`Rotating log requires a regular file: ${file_path}`);
    }
    if (file_stat.size > this.max_bytes) {
      throw new Error(`Rotating log file exceeds max_bytes (${this.max_bytes}): ${file_path}. Explicitly archive or clean up the oversized file before retrying.`);
    }
    return file_stat;
  }

  /** Preflight every owned path before any rotation can remove an archive. */
  private async inspect_files(): Promise<void> {
    await this.inspect_file(this.file_path);
    for (let archive_index = 1; archive_index <= this.archive_count; archive_index += 1) {
      await this.inspect_file(`${this.file_path}.${archive_index}`);
    }
  }

  /** Create the containing directory privately, then prepare existing bounded logs. */
  private async initialize(): Promise<void> {
    const directory_path = dirname(this.file_path);
    await mkdir(directory_path, { recursive: true, mode: 0o700 });
    if (!(await lstat(directory_path)).isDirectory()) {
      throw new Error("Rotating log directory must be a real directory.");
    }
    await this.inspect_files();
    await chmod(directory_path, 0o700);
    for (let archive_index = 1; archive_index <= this.archive_count; archive_index += 1) {
      const archive_path = `${this.file_path}.${archive_index}`;
      const archive_stat = await this.inspect_file(archive_path);
      if (!archive_stat) continue;
      const archive_handle = await this.open_existing(archive_path, archive_stat, constants.O_RDONLY);
      try {
        await archive_handle.chmod(0o600);
      } finally {
        await archive_handle.close();
      }
    }
    await this.open_active();
  }

  /** Open without following symlinks and verify the inode observed by lstat. */
  private async open_existing(file_path: string, expected_stat: Stats, flags: number): Promise<FileHandle> {
    const file_handle = await open(file_path, flags | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const actual_stat = await file_handle.stat();
      if (!actual_stat.isFile() || actual_stat.dev !== expected_stat.dev || actual_stat.ino !== expected_stat.ino) {
        throw new Error("Rotating log file changed while opening.");
      }
      if (actual_stat.size > this.max_bytes) {
        throw new Error("Rotating log file exceeds max_bytes. Explicitly archive or clean up the oversized file before retrying.");
      }
      return file_handle;
    } catch (error) {
      await file_handle.close();
      throw error;
    }
  }

  /** Prefer exclusive creation; append only after validating an existing regular file. */
  private async open_active(): Promise<void> {
    try {
      this.file_handle = await open(this.file_path, "wx", 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const file_stat = await this.inspect_file(this.file_path);
      if (!file_stat) throw new Error("Rotating log file disappeared while opening.");
      this.file_handle = await this.open_existing(this.file_path, file_stat, constants.O_WRONLY | constants.O_APPEND);
    }
    await this.file_handle.chmod(0o600);
    this.current_bytes = (await this.file_handle.stat()).size;
  }

  /** Split even oversized chunks without copying, accounting for partial OS writes. */
  private async write_chunk(chunk: Buffer): Promise<void> {
    let chunk_offset = 0;
    while (chunk_offset < chunk.length && !this.destroyed) {
      if (this.current_bytes === this.max_bytes) await this.rotate();
      if (this.destroyed) return;
      if (!this.file_handle) throw new Error("Rotating log handle is unavailable.");
      const write_length = Math.min(chunk.length - chunk_offset, this.max_bytes - this.current_bytes);
      const { bytesWritten: written_bytes } = await this.file_handle.write(chunk, chunk_offset, write_length, null);
      if (written_bytes <= 0 || written_bytes > write_length) {
        throw new Error("Rotating log write made invalid progress.");
      }
      chunk_offset += written_bytes;
      this.current_bytes += written_bytes;
    }
  }

  /** Close, shift only validated owned archives, and reopen a private active file. */
  private async rotate(): Promise<void> {
    await this.inspect_files();
    await this.finish_file();
    const oldest_path = `${this.file_path}.${this.archive_count}`;
    if (await this.inspect_file(oldest_path)) await unlink(oldest_path);
    for (let archive_index = this.archive_count - 1; archive_index >= 1; archive_index -= 1) {
      const source_path = `${this.file_path}.${archive_index}`;
      const target_path = `${this.file_path}.${archive_index + 1}`;
      if (!(await this.inspect_file(source_path))) continue;
      await this.inspect_file(target_path);
      await rename(source_path, target_path);
    }
    await this.inspect_file(this.file_path);
    await this.inspect_file(`${this.file_path}.1`);
    await rename(this.file_path, `${this.file_path}.1`);
    await this.open_active();
  }

  /** Sync the active file; _destroy still closes it if syncing fails. */
  private async finish_file(): Promise<void> {
    if (this.file_handle) await this.file_handle.sync();
    await this.close_handle();
  }

  /** Release ownership before awaiting close so repeated cleanup cannot double-close. */
  private async close_handle(): Promise<void> {
    const file_handle = this.file_handle;
    this.file_handle = undefined;
    if (file_handle) await file_handle.close();
  }
}

/**
 * Create a bounded byte stream. Argument errors throw synchronously; filesystem
 * errors are emitted by the returned stream. Attach error handling before writing.
 */
export function create_rotating_log(file_path: string, options?: RotatingLogOptions): Writable {
  return new RotatingLogWriter(file_path, options);
}
