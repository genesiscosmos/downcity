/** 冻结的 v11 离线协议，仅供显式迁移和历史校验使用。 */
/** 发布和读取 Power 内容时统一检查身份、版本与 JSON 数据边界。 */
export function validate_session_power_content(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error("Power content must be an object");
    const content = value;
    if (content.type !== "power")
        throw new Error("Power content type must be power");
    if (typeof content.power_id !== "string" || !/^[a-z][a-z0-9_-]*$/.test(content.power_id)) {
        throw new Error("Power content requires a valid power_id");
    }
    if (!Number.isSafeInteger(content.schema_version) || Number(content.schema_version) < 1) {
        throw new Error("Power content requires a positive schema_version");
    }
    if (typeof content.fallback_text !== "string" || !content.fallback_text.trim()) {
        throw new Error("Power content requires non-empty fallback_text");
    }
    validate_json(content.data, new Set(), 0);
    if (new TextEncoder().encode(JSON.stringify(content)).byteLength > 256 * 1024) {
        throw new Error("Power content exceeds 256 KiB");
    }
}
/** 拒绝循环、非 JSON 值及过深对象，避免序列化时丢失含义。 */
function validate_json(value, ancestors, depth) {
    if (value === null || typeof value === "string" || typeof value === "boolean")
        return;
    if (typeof value === "number" && Number.isFinite(value))
        return;
    if (typeof value !== "object" || !value || depth > 64 || ancestors.has(value)) {
        throw new Error("Power content data must be finite, acyclic JSON with depth <= 64");
    }
    if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
        throw new Error("Power content data must contain only plain JSON objects");
    }
    ancestors.add(value);
    for (const child of Object.values(value))
        validate_json(child, ancestors, depth + 1);
    ancestors.delete(value);
}
