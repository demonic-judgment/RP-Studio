/**
 * 把用户选的图片压成能长期塞进 settings 的 data URL。
 * 背景是铺满整屏用的，长边 2560 已经够（再大只是让 jsonb 更沉），
 * 一张 4K 的 PNG 通常能被压到几百 KB 的 WebP。
 */

/** 长边上限：常规背景够用，又不至于让 settings 那一行 jsonb 过大 */
const MAX_EDGE = 2560;
const FALLBACK_EDGE = 1920;
/** base64 字符数上限，约 1.9MB 原图 */
const MAX_CHARS = 2_600_000;
/** 动图 / 矢量图原样保留时的体积上限 */
const RAW_LIMIT = 6 * 1024 * 1024;

interface Decoded {
  source: CanvasImageSource;
  width: number;
  height: number;
}

export async function prepareBackgroundImage(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new Error("只支持图片文件");
  }

  // 动图与矢量图交给浏览器原样显示：走 canvas 会把它们拍平成一张静图
  if (file.type === "image/gif" || file.type === "image/svg+xml") {
    if (file.size > RAW_LIMIT) throw new Error("图片超过 6MB，请先压缩或换一张");
    return readAsDataUrl(file);
  }

  const decoded = await loadImage(file);
  const first = encode(decoded, MAX_EDGE, 0.86);
  if (first.length <= MAX_CHARS) return first;

  const second = encode(decoded, FALLBACK_EDGE, 0.72);
  if (second.length <= MAX_CHARS) return second;

  throw new Error("这张图压不进 2MB，换一张分辨率低一点的");
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("读取图片失败"));
    reader.readAsDataURL(file);
  });
}

async function loadImage(file: File): Promise<Decoded> {
  const url = URL.createObjectURL(file);
  try {
    if (typeof createImageBitmap === "function") {
      try {
        const bitmap = await createImageBitmap(file);
        return { source: bitmap, width: bitmap.width, height: bitmap.height };
      } catch {
        // 少数格式（比如带色彩描述文件的 JPEG）解码器会挑食，退回 <img> 再试一次
      }
    }
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("图片解析失败，换 PNG / JPG / WebP 试试"));
      el.src = url;
    });
    return { source: image, width: image.naturalWidth, height: image.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function encode(image: Decoded, maxEdge: number, quality: number): string {
  const scale = Math.min(1, maxEdge / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("浏览器不支持 canvas，无法处理图片");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image.source, 0, 0, width, height);

  const webp = canvas.toDataURL("image/webp", quality);
  // 老 Safari 不认识 webp 时会静默退回 PNG，体积反而更大，这时改走 JPEG
  return webp.startsWith("data:image/webp") ? webp : canvas.toDataURL("image/jpeg", quality);
}
