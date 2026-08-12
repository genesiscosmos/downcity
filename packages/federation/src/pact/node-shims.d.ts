/**
 * Client 包的最小 Node 类型声明。
 *
 * Bureau 在 Node 环境可以从 `process.env` 读取服务端凭证。
 * 这里避免为了一个可选读取能力把 `@types/node` 强制安装到 client 包。
 */

declare const process: {
  env: Record<string, string | undefined>;
};
