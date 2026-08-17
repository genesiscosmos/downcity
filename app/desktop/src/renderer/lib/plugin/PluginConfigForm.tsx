/** Plugin JSON Schema 驱动的递归配置表单。 */
import type { JsonObject, JsonValue } from "@downcity/agent";

/** Plugin 配置表单属性。 */
interface PluginConfigFormProps { /** JSON Schema。 */ schema: JsonObject; /** 当前配置。 */ value: JsonObject; /** 配置变化回调。 */ on_change(value: JsonObject): void; }

/** 渲染一份对象根节点的 Plugin 配置。 */
export function PluginConfigForm({ schema, value, on_change }: PluginConfigFormProps) { return <SchemaObject schema={schema} value={value} on_change={on_change} />; }

/** 渲染 Schema 对象属性集合。 */
function SchemaObject({ schema, value, on_change }: PluginConfigFormProps) {
  const properties = is_object(schema.properties) ? schema.properties : {};
  return <div className="space-y-3">{Object.entries(properties).map(([key, child]) => is_object(child) ? <SchemaField key={key} name={key} schema={child} value={value[key]} on_change={(next) => on_change({ ...value, [key]: next })} /> : null)}{Object.keys(properties).length === 0 ? <div className="py-8 text-center text-xs text-muted-foreground">此配置没有可编辑字段</div> : null}</div>;
}

/** 按 JSON Schema 类型渲染单个字段。 */
function SchemaField({ name, schema, value, on_change }: { /** 字段名。 */ name: string; /** 字段 Schema。 */ schema: JsonObject; /** 当前值。 */ value: JsonValue | undefined; /** 变化回调。 */ on_change(value: JsonValue): void }) {
  const label = typeof schema.title === "string" ? schema.title : name;
  const description = typeof schema.description === "string" ? schema.description : "";
  const type = typeof schema.type === "string" ? schema.type : infer_type(value);
  if (type === "object") return <fieldset className="rounded-lg border border-border/45 bg-background p-3"><legend className="px-1 text-xs font-medium text-foreground">{label}</legend><SchemaObject schema={schema} value={is_object(value) ? value : {}} on_change={on_change} /></fieldset>;
  return <label className="block"><span className="mb-1 block text-xs font-medium text-foreground">{label}</span>{description ? <span className="mb-1.5 block text-[0.6875rem] leading-4 text-muted-foreground">{description}</span> : null}<FieldInput type={type} enum_values={Array.isArray(schema.enum) ? schema.enum : []} value={value} on_change={on_change} /></label>;
}

/** 渲染基础值和数组输入。 */
function FieldInput({ type, enum_values, value, on_change }: { /** Schema 类型。 */ type: string; /** 枚举值。 */ enum_values: JsonValue[]; /** 当前值。 */ value: JsonValue | undefined; /** 变化回调。 */ on_change(value: JsonValue): void }) {
  const class_name = "h-8 w-full rounded-lg border border-input bg-background px-2.5 text-xs text-foreground outline-none focus:border-ring";
  if (enum_values.length) return <select className={class_name} value={String(value ?? "")} onChange={(event) => on_change(enum_values.find((item) => String(item) === event.target.value) ?? event.target.value)}>{enum_values.map((item) => <option key={String(item)} value={String(item)}>{String(item)}</option>)}</select>;
  if (type === "boolean") return <input type="checkbox" checked={Boolean(value)} className="size-4" onChange={(event) => on_change(event.target.checked)} />;
  if (type === "number" || type === "integer") return <input type="number" step={type === "integer" ? 1 : "any"} className={class_name} value={typeof value === "number" ? value : ""} onChange={(event) => on_change(Number(event.target.value))} />;
  if (type === "array") return <textarea className="min-h-24 w-full resize-y rounded-lg border border-input bg-background px-2.5 py-2 font-mono text-xs text-foreground" value={JSON.stringify(Array.isArray(value) ? value : [], null, 2)} onChange={(event) => { try { const next = JSON.parse(event.target.value); if (Array.isArray(next)) on_change(next); } catch { /* 等待有效 JSON。 */ } }} />;
  return <input className={class_name} value={typeof value === "string" ? value : ""} onChange={(event) => on_change(event.target.value)} />;
}

/** 判断未知值是否为 JSON 对象。 */
function is_object(value: unknown): value is JsonObject { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
/** 从当前值推断未声明的 Schema 类型。 */
function infer_type(value: JsonValue | undefined): string { return Array.isArray(value) ? "array" : value == null ? "string" : typeof value; }
