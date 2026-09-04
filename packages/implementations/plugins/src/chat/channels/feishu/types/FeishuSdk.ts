/**
 * Feishu SDK 运行时类型。
 *
 * 关键点（中文）
 * - 这里仅描述当前 Feishu channel 实际使用到的 SDK 表面积。
 * - `@larksuiteoapi/node-sdk` 由启用 Feishu 的宿主应用显式安装，不能在类型层静态依赖它。
 * - 这些 structural type 用于保证核心包在未安装 Feishu SDK 时仍可完成编译与导入。
 */

/**
 * Feishu SDK client 构造配置。
 */
export interface FeishuSdkClientConfig {
  /**
   * Feishu / Lark App ID。
   */
  appId: string;
  /**
   * Feishu / Lark App Secret。
   */
  appSecret: string;
  /**
   * Feishu / Lark Open API 域名。
   */
  domain: string;
}

/**
 * Feishu 图片上传响应。
 */
export interface FeishuSdkImageCreateResult {
  /**
   * 飞书图片资源 key。
   */
  image_key?: string;
}

/**
 * Feishu 消息资源下载响应。
 */
export interface FeishuSdkMessageResourceResult {
  /**
   * 响应头，用于推断附件文件名。
   */
  headers?: Record<string, unknown>;
  /**
   * 将资源写入本地文件。
   */
  writeFile(path: string): Promise<void>;
}

/**
 * Feishu SDK Client 的最小能力集合。
 */
export interface FeishuSdkClient {
  /**
   * IM v1 API namespace。
   */
  im: {
    /**
     * v1 API 集合。
     */
    v1: {
      /**
       * 图片能力。
       */
      image: {
        /**
         * 上传消息图片。
         */
        create(input: unknown): Promise<FeishuSdkImageCreateResult>;
      };
      /**
       * 消息能力。
       */
      message: {
        /**
         * 回复消息。
         */
        reply(input: unknown): Promise<unknown>;
        /**
         * 创建消息。
         */
        create(input: unknown): Promise<unknown>;
      };
      /**
       * 消息资源下载能力。
       */
      messageResource: {
        /**
         * 获取消息附件资源。
         */
        get(input: unknown): Promise<FeishuSdkMessageResourceResult>;
      };
      /**
       * 消息 reaction 能力。
       */
      messageReaction?: {
        /**
         * 创建 reaction。
         */
        create(input: unknown): Promise<unknown>;
      };
    };
  };
}

/**
 * Feishu SDK WS client 的最小能力集合。
 */
export interface FeishuSdkWsClient {
  /**
   * 启动长连接。
   */
  start(input: { eventDispatcher: unknown }): void;
}

/**
 * Feishu SDK event dispatcher 的最小能力集合。
 */
export interface FeishuSdkEventDispatcher {
  /**
   * 注册事件处理器。
   */
  register(events: Record<string, (data: unknown) => Promise<void>>): unknown;
}

/**
 * Feishu SDK 模块的最小能力集合。
 */
export interface FeishuSdkModule {
  /**
   * Open API client constructor。
   */
  Client: new (config: FeishuSdkClientConfig) => FeishuSdkClient;
  /**
   * 长连接 client constructor。
   */
  WSClient: new (config: FeishuSdkClientConfig) => FeishuSdkWsClient;
  /**
   * 事件分发器 constructor。
   */
  EventDispatcher: new (config: Record<string, unknown>) => FeishuSdkEventDispatcher;
}
