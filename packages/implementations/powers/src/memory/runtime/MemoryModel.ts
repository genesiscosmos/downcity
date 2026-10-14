/** Memory 形成与 Profile 优化共用的有界 JSON 模型调用，不依赖聊天 Agent。 */
import type { PowerLifecycleContext } from "@downcity/city/power";

/** 调用宿主文本模型并限制输出，模型失败和非法 JSON 均显式抛出。 */
export async function generate_memory_json(host: PowerLifecycleContext, model_id: string, instruction: string, state: unknown): Promise<unknown> {
  const ai = host.embassy?.user.ai;
  if (!ai) throw new Error("Memory requires Federation Embassy");
  const response = await ai.model(model_id).stream({ messages: [
    { role: "system", content: [{ type: "text", text: instruction }] },
    { role: "user", content: [{ type: "text", text: JSON.stringify(state) }] },
  ] }, AbortSignal.timeout(60_000));
  let output = "";
  for await (const event of response) {
    if (event.type === "model_error") throw new Error(event.error.message);
    if (event.type === "text_delta") output += event.delta;
    if (output.length > 64_000) throw new Error("Memory model output too large");
  }
  return JSON.parse(output.trim().replace(/^```(?:json)?\s*|\s*```$/g, ""));
}
