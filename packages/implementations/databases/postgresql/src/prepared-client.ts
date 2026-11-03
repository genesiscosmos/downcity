/**
 * 为 Hyperdrive 保证所有 postgres-js 查询使用预处理协议。
 * Drizzle 的普通查询会显式传 prepare:false，因此仅设置客户端默认值不足。
 * 包装同时延续至事务和 savepoint 客户端，不改变参数化 SQL 或事务边界。
 */

/** 以相同客户端类型返回预处理代理，保留 postgres-js 的可调用接口。 */
export function prepared_client<TClient extends object>(client: TClient): TClient {
  return new Proxy(client, {
    get(target, property, receiver) {
      const value: unknown = Reflect.get(target, property, receiver);
      if (typeof value !== "function") return value;
      if (property === "unsafe") {
        return (query: string, parameters: unknown[] = [], options: Record<string, unknown> = {}) =>
          Reflect.apply(value, target, [query, parameters, { ...options, prepare: true }]);
      }
      if (property === "begin" || property === "savepoint") {
        return (...arguments_: unknown[]) => Reflect.apply(value, target, arguments_.map((argument) =>
          typeof argument === "function"
            ? (transaction: object) => argument(prepared_client(transaction))
            : argument,
        ));
      }
      return value.bind(target);
    },
  });
}
