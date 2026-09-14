/**
 * Mermaid 图表的位图导出。
 *
 * 直接截屏或导出 SVG 都有各自的坑：SVG 在某些聊天工具里粘贴后丢样式，而按 CSS 尺寸截图会
 * 把界面缩放的模糊也一起带走。这里回到 SVG 自己的 viewBox：按原始尺寸的固定倍数栅格化，
 * 先铺一层当前主题底色（否则透明背景在浅色文档里会变成黑底白字看不清），再落成 PNG。
 *
 * 尺寸上限是必要的：`8192px` 是多数浏览器 canvas 的可用上限，`32M` 像素是内存保险丝；
 * 超限时按比例缩小，而不是直接失败。
 */

/** Mermaid SVG 的原始尺寸。 */
export type MermaidSvgSize = {
  /** 原始宽度，来自 viewBox 或 width 属性。 */
  width: number;
  /** 原始高度，来自 viewBox 或 height 属性。 */
  height: number;
};

const export_scale = 2;
const max_raster_dimension = 8192;
const max_raster_pixels = 32_000_000;

/** 从 SVG 文本里读出原始尺寸；两者都读不到时返回 null。 */
export function read_mermaid_svg_size(svg: string): MermaidSvgSize | null {
  const view_box = svg.match(/\sviewBox=["']([^"']+)["']/i)?.[1];
  const view_box_values = view_box?.trim().split(/[\s,]+/).map((value) => Number.parseFloat(value));

  if (view_box_values && view_box_values.length === 4) {
    const width = view_box_values[2]!;
    const height = view_box_values[3]!;
    if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) return { width, height };
  }

  const width = Number.parseFloat(svg.match(/\swidth=["']([0-9.]+)/i)?.[1] ?? "");
  const height = Number.parseFloat(svg.match(/\sheight=["']([0-9.]+)/i)?.[1] ?? "");
  if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) return { width, height };

  return null;
}

/** 按导出倍率放大，并收敛到 canvas 允许的尺寸与像素总量以内。 */
export function get_mermaid_raster_size(size: MermaidSvgSize): MermaidSvgSize {
  const scale = Math.min(export_scale, max_raster_dimension / size.width, max_raster_dimension / size.height, Math.sqrt(max_raster_pixels / (size.width * size.height)));

  return { width: Math.max(1, Math.round(size.width * scale)), height: Math.max(1, Math.round(size.height * scale)) };
}

/** 把 SVG 的宽高属性写成栅格化尺寸，避免浏览器按默认 300×150 解析。 */
function prepare_svg_for_rasterization(svg: string, size: MermaidSvgSize): string {
  const parsed = new DOMParser().parseFromString(svg, "image/svg+xml");
  const svg_element = parsed.querySelector("svg");
  if (!svg_element) throw new Error("Mermaid SVG is invalid");

  svg_element.setAttribute("width", String(size.width));
  svg_element.setAttribute("height", String(size.height));
  return new XMLSerializer().serializeToString(svg_element);
}

/** 用当前主题底色填充导出图，避免透明背景在浅色文档里不可读。 */
function read_export_background(): string {
  return getComputedStyle(document.documentElement).getPropertyValue("--background").trim() || "transparent";
}

function load_svg_image(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Failed to rasterize Mermaid SVG"));
    image.src = source;
  });
}

function canvas_to_png(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Failed to encode Mermaid PNG"));
    }, "image/png");
  });
}

/** 把 SVG 栅格化成 PNG 并触发下载。 */
export async function download_mermaid_png(svg: string, file_name: string): Promise<void> {
  const svg_size = read_mermaid_svg_size(svg);
  if (!svg_size) throw new Error("Mermaid SVG size is unavailable");

  const raster_size = get_mermaid_raster_size(svg_size);
  const source = URL.createObjectURL(new Blob([prepare_svg_for_rasterization(svg, svg_size)], { type: "image/svg+xml;charset=utf-8" }));

  try {
    const image = await load_svg_image(source);
    const canvas = document.createElement("canvas");
    canvas.width = raster_size.width;
    canvas.height = raster_size.height;

    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas is unavailable");

    context.fillStyle = read_export_background();
    context.fillRect(0, 0, raster_size.width, raster_size.height);
    context.drawImage(image, 0, 0, raster_size.width, raster_size.height);

    const png = await canvas_to_png(canvas);
    const download_url = URL.createObjectURL(png);
    try {
      const anchor = document.createElement("a");
      anchor.href = download_url;
      anchor.download = file_name;
      anchor.click();
    } finally {
      URL.revokeObjectURL(download_url);
    }
  } finally {
    URL.revokeObjectURL(source);
  }
}
