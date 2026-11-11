/**
 * City 请求来源标签的统一输入规则。
 * 来源仅供日志、用量和任务归因，不参与身份解析、资源授权或机器可信判断。
 */

/** 校验可选来源：1–128 个 ASCII 字母、数字、下划线或连字符，首字符必须为字母或数字。 */
export function normalize_city_source(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(value)) {
    throw new TypeError("city_id must contain 1-128 URL-safe ASCII characters");
  }
  return value;
}
