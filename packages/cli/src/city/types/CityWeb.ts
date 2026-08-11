/** City Web 控制面类型。 */

/** `city web` 启动参数。 */
export interface CityWebOptions {
  /** 本地 HTTP Server 监听地址。 */
  host: string;
  /** 本地 HTTP Server 监听端口，0 表示由系统分配。 */
  port: number;
  /** 启动后是否打开系统浏览器。 */
  open: boolean;
}

/** City Web Server 绑定信息。 */
export interface CityWebBinding {
  /** 浏览器访问地址。 */
  url: string;
  /** 关闭 Server 并释放监听端口。 */
  close: () => Promise<void>;
}

