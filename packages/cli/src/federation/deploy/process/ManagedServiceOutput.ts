/**
 * 系统服务应用输出接管：stdout/stderr 串行写入同一轮转文件，遵守 Writable 背压。
 * 等待 close 而非 exit，确保管道中剩余数据排空；写入失败终止生产者，不创建重试队列。
 */
import { spawn } from "node:child_process";
import type { Writable } from "node:stream";
import { finished } from "node:stream/promises";
import { create_rotating_log } from "./RotatingLogWriter.js";

/** 一次应用启动的进程及输出参数。 */
export interface ManagedServiceOutputOptions {
  /** Node 应用入口的绝对路径。 */
  entry: string;
  /** 安装产物的运行目录。 */
  cwd: string;
  /** 已隔离、补齐控制字段的子进程环境。 */
  env: NodeJS.ProcessEnv;
  /** 由当前运行器独占的应用日志绝对路径。 */
  log_path: string;
  /** 子进程分配 PID 后更新运行事实，失败时必须终止子进程。 */
  on_started: () => Promise<void>;
  /** 日志故障通知，只传稳定诊断码，不暴露正文或原始异常。 */
  on_log_failure: () => void;
}

/** 初始化完成后才启动应用；构造或首次打开失败不会启动生产者。 */
export async function open_rotating_output(file_path: string,
  options?: { /** 每份日志字节上限。 */ max_bytes?: number; /** 归档数量。 */ archive_count?: number }): Promise<Writable> {
  const writer = create_rotating_log(file_path, options);
  // _construct 或后续写入错误均被消费，调用者仍通过 finished/error 观察失败。
  writer.on("error", () => {});
  try {
    await new Promise<void>((resolve, reject) => writer.write(Buffer.alloc(0), (error) => error ? reject(error) : resolve()));
    return writer;
  } catch (error) {
    writer.destroy();
    await finished(writer).catch(() => {});
    throw error;
  }
}

/** 日志写入与同步失败时以非零结果退出，不能把日志故障当成主动停止成功。 */
export async function run_logged_application(options: ManagedServiceOutputOptions): Promise<number> {
  let writer: Writable;
  try { writer = await open_rotating_output(options.log_path); }
  catch (error) { options.on_log_failure(); throw error; }
  let logging_failed = false;
  let stop_requested = false;
  let force_timer: NodeJS.Timeout | undefined;
  let child: ReturnType<typeof spawn> | undefined;
  let completion: Promise<number> | undefined;
  const stop_child = () => {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    child.kill("SIGTERM");
    if (!force_timer) {
      force_timer = setTimeout(() => {
        if (child?.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      }, 5_000);
      force_timer.unref();
    }
  };
  const log_failure = () => {
    if (logging_failed) return;
    logging_failed = true;
    options.on_log_failure();
    child?.stdout?.unpipe(writer);
    child?.stderr?.unpipe(writer);
    child?.stdout?.destroy();
    child?.stderr?.destroy();
    stop_child();
  };
  const signal_stop = () => { stop_requested = true; stop_child(); };
  writer.on("error", log_failure);
  const writer_completion = finished(writer);
  writer_completion.catch(() => {});
  try {
    child = spawn(process.execPath, [options.entry], { cwd: options.cwd, env: options.env,
      stdio: ["ignore", "pipe", "pipe"] });
    completion = new Promise<number>((resolve) => {
      let spawn_failed = false;
      child!.once("error", () => { spawn_failed = true; });
      child!.once("close", (code, signal) => resolve(logging_failed || spawn_failed ? 1 : stop_requested ? 0 : signal ? 1 : (code ?? 1)));
    });
    if (!child.stdout || !child.stderr) throw new Error("Application output pipes are unavailable");
    // 一个文件一个 writer，pipe 会根据 write(false) 暂停生产者；不能为每个 chunk 建异步队列。
    child.stdout.on("error", log_failure);
    child.stderr.on("error", log_failure);
    child.stdout.pipe(writer, { end: false });
    child.stderr.pipe(writer, { end: false });
    process.on("SIGTERM", signal_stop);
    process.on("SIGINT", signal_stop);
    if (child.pid) await options.on_started();
    const code = await completion;
    writer.end();
    try { await writer_completion; }
    catch { log_failure(); return 1; }
    return logging_failed ? 1 : code;
  } catch (error) {
    stop_child();
    if (completion) await completion;
    throw error;
  } finally {
    process.off("SIGTERM", signal_stop);
    process.off("SIGINT", signal_stop);
    stop_child();
    if (force_timer) clearTimeout(force_timer);
    child?.stdout?.unpipe(writer);
    child?.stderr?.unpipe(writer);
    writer.off("error", log_failure);
    if (!writer.destroyed) writer.destroy();
    await writer_completion.catch(() => {});
  }
}
