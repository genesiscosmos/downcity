/** 按 Duobox 品牌规则展示 Federation 模型图标。 */

import { SiDeepseek, SiGooglegemini, SiQwen } from "react-icons/si";
import { TbBrandOpenai, TbSparkles } from "react-icons/tb";

/** 模型品牌图标属性。 */
interface LLMModelIconProps {
  /** Federation 模型标识。 */ model_id: string;
  /** 图标尺寸样式。 */ size_class?: string;
}

/** 从 provider/model、provider:model 或普通模型名中识别品牌。 */
export function LLMModelIcon({ model_id, size_class = "size-5" }: LLMModelIconProps) {
  const id = String(model_id || "").toLowerCase();
  const model_name = id.split(/[/:]/).filter(Boolean).at(-1) || id;
  const matches = (...tokens: string[]) => tokens.some((token) => id.startsWith(token) || model_name.startsWith(token) || id.includes(`/${token}`) || id.includes(`:${token}`));
  if (matches("gpt", "openai", "o1", "o3", "o4")) return <TbBrandOpenai className={size_class} aria-label="OpenAI" />;
  if (matches("claude", "anthropic")) return <ClaudeIcon class_name={size_class} />;
  if (matches("gemini", "google")) return <SiGooglegemini className={`${size_class} text-[#3186ff]`} aria-label="Gemini" />;
  if (matches("deepseek")) return <SiDeepseek className={`${size_class} text-[#4d6bfe]`} aria-label="DeepSeek" />;
  if (matches("qwen", "qwq")) return <SiQwen className={`${size_class} text-[#6f69f7]`} aria-label="Qwen" />;
  if (matches("grok", "xai")) return <GrokIcon class_name={size_class} />;
  if (matches("glm", "zhipu", "zai", "z-image")) return <ZaiIcon class_name={size_class} />;
  if (matches("kimi", "moonshot")) return <KimiIcon class_name={size_class} />;
  return <span className={`${size_class} flex shrink-0 items-center justify-center text-muted-foreground`}><TbSparkles className="size-full" /></span>;
}

/** Claude 品牌图标。 */
function ClaudeIcon({ class_name }: { /** 尺寸样式。 */ class_name: string }) { return <svg viewBox="0 0 24 24" className={`${class_name} shrink-0`} aria-label="Claude"><path fill="#D97757" d="M4.709 15.955l4.72-2.647.08-.23-.08-.128H9.2l-8.664-.461L0 11.784l.535-.673 8.585.673h.389l.055-.157-7.571-5.405-.158-1.008.656-.722 6.61 4.927.268-.176L6.113.729 6.283.134 6.696 0l.996.134 4.296 8.767h.249l.675-7.147.376-.91.747-.492.584.28.48.685-1.166 7.14h.212l4.807-5.766h1.033l.76 1.129-5.94 7.18.073.11 6.791-1.405.833.388.091.395-.328.807-6.798 1.623.007.091 6.333.522.79.522.474.638-.079.485-1.215.62-6.994-1.648v.11l6.079 5.208.127.578-.322.455-.34-.049-6.13-4.772h-.128l3.415 5.25.122 1.08-.17.353-.608.213-.668-.122-4.072-6.035-.14.08-.674 7.254-.316.37-.729.28-.607-.461-.322-.747 1.482-7.562-.152-.042-5.34 6.757-.414.164-.717-.37.067-.662 5.125-6.595-.061-.158-6.49 4.437-1.13.146-.487-.456.061-.746.231-.243 1.908-1.312z" /></svg>; }

/** Grok 品牌图标。 */
function GrokIcon({ class_name }: { /** 尺寸样式。 */ class_name: string }) { return <svg viewBox="0 0 24 24" className={`${class_name} shrink-0`} aria-label="Grok"><path fill="currentColor" d="M9.27 15.29l7.978-5.897c.391-.29.95-.177 1.137.272.98 2.369.542 5.215-1.41 7.169-1.951 1.954-4.667 2.382-7.149 1.406l-2.711 1.257c3.889 2.661 8.611 2.003 11.562-.953 2.341-2.344 3.066-5.539 2.388-8.42.225-4.225 1.6-6.153 2.935-8.624l-14.733 14.792M7.623 16.723c-2.792-2.67-2.31-6.801.071-9.184 1.761-1.763 4.647-2.483 7.166-1.425l2.705-1.25A8.975 8.975 0 005.984 5.83c-2.533 2.536-3.33 6.436-1.962 9.764 1.022 2.487-2.153 5.912-4.022 7.947l7.62-6.815" /></svg>; }

/** Z.ai 品牌图标。 */
function ZaiIcon({ class_name }: { /** 尺寸样式。 */ class_name: string }) { return <svg viewBox="0 0 24 24" className={`${class_name} shrink-0`} aria-label="Z.ai"><path fill="currentColor" d="M12.105 2L9.927 4.953H.653L2.83 2h9.276zM23.254 19.048L21.078 22h-9.242l2.174-2.952h9.244zM24 2L9.264 22H0L14.736 2H24z" /></svg>; }

/** Kimi 品牌图标。 */
function KimiIcon({ class_name }: { /** 尺寸样式。 */ class_name: string }) { return <svg viewBox="0 0 24 24" className={`${class_name} shrink-0`} aria-label="Kimi"><path fill="#027AFF" d="M19.738 5.776c.163-.209.306-.4.457-.585-.725-1.111-.721-2.145-.344-3.115.283-.73.909-1.072 1.674-1.145 1.31-.124 2.178.451 2.389 1.732.281 1.676-.574 2.792-1.828 2.956-.718.096-1.446.108-2.348.157z" /><path fill="currentColor" d="M17.962 1.844h-4.326l-3.425 7.81H5.369V1.878H1.5V22h3.87v-8.477h6.824a3.025 3.025 0 002.743-1.75V22h3.87v-8.477a3.87 3.87 0 00-3.588-3.86v-.01h-2.125a3.94 3.94 0 002.323-2.12l2.545-5.689z" /></svg>; }
