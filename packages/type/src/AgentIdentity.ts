/** Agent 身份角色列表的共享归一化规则；持久化与运行时使用同一协议。 */

/** 去掉角色首尾空白、空项和重复项，保留首次出现的顺序；缺省或空列表表示无角色。 */
export function normalize_agent_role(input?: readonly string[]): string[] | undefined {
  if (input === undefined) return undefined;
  if (!Array.isArray(input) || [...input].some((item) => typeof item !== "string")) {
    throw new TypeError("Agent role must be an array of strings");
  }
  const role = [...new Set(input.map((item) => item.trim()).filter(Boolean))];
  return role.length ? role : undefined;
}
