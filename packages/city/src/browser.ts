/**
 * 浏览器与 Chrome 扩展专用的 RemoteAgent 入口。
 * 仅使用 Fetch HTTP Transport，不引入本地 City、Node 网络或文件系统。
 */
import type { RemoteAgentOptions } from "./types/remote/RemoteAgentOptions.js";
import { RemoteAgentCore } from "./remote/RemoteAgentCore.js";
import { HttpRemoteAgentTransport } from "./remote/transports/HttpRemoteAgentTransport.js";
export { RemoteCity, RemoteCityAgent } from "./remote/RemoteCity.js";
export type { RemoteCityOptions, RemoteCityAgentInfo } from "./types/remote/RemoteCity.js";
export type { PromptPower, PromptPowerAction, PromptPowerCallContext } from "@downcity/type";

/** 浏览器远程客户端，方法与 Node RemoteAgent 相同，仅接受 HTTP/HTTPS。 */
export class RemoteAgent extends RemoteAgentCore {
  constructor(options: RemoteAgentOptions) {
    const url = new URL(options.url);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) throw new Error("Browser RemoteAgent requires an HTTP/HTTPS URL without embedded credentials");
    super(new HttpRemoteAgentTransport(url.toString().replace(/\/+$/, ""), options.token));
  }
}
