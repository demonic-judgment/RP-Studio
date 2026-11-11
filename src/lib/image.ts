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
/**
 * 生成结果与底图统一按 2:3 竖图存：800x1200。
 * 画布宽 380（聊天正文列的一半）在 2x 屏上要 760 像素，800 够用；
 * 再大只是让每轮「图 → 底图 → 图」的 IndexedDB 读写更沉。
 */
const IMAGE_WIDTH = 800;
const IMAGE_HEIGHT = 1200;
/** 压完的体积上限，超了再降一档（WebP 字符数，约 900KB 原图） */
const IMAGE_MAX_CHARS = 900_000;
/** 三视图参考图长边：要看清服装与五官细节，比生成图留得大一点 */
const REFERENCE_EDGE = 1280;
/** 单张参考图的体积上限（WebP 字符数，约 450KB 原图）；三张加起来别把角色行撑太沉 */
const REFERENCE_MAX_CHARS = 600_000;

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

/**
 * 绘图模型返回的图 / 用户选的初始底图：按 2:3 居中裁切后压成 800x1200 的 WebP。
 *
 * 各家模型实际吐出来的比例不一定听话（1024x1024、1536x1024 都见过），
 * 而画面框固定 2:3 —— 不在这里统一裁，图放进框里就会被压扁或留边；
 * 底图也是同一套规则，保证「底图 → 生成图」比例一致。
 * 生成图要落库、还要能当备份导出，所以裁完还要压：超体积再降一档画质和尺寸。
 */
export async function prepareGeneratedImage(blob: Blob): Promise<string> {
  const decoded = await loadImage(blob);
  const first = encodeCropped(decoded, IMAGE_WIDTH, IMAGE_HEIGHT, 0.86);
  if (first.length <= IMAGE_MAX_CHARS) return first;
  return encodeCropped(decoded, Math.round(IMAGE_WIDTH * 0.75), Math.round(IMAGE_HEIGHT * 0.75), 0.72);
}

/**
 * 三视图参考图：**不裁切**，只按长边等比缩小 + 转 WebP。
 *
 * 参考图不是拿来填画面框的，是给模型看「这个人长什么样」——按 2:3 裁掉两侧
 * 可能正好裁掉侧身/背面那张里的轮廓线，得不偿失。等比缩放后模型能拿到完整信息，
 * 画面比例本来就在 prompt 与 size 参数里约束。
 */
export async function prepareReferenceImage(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("只支持图片文件");
  const decoded = await loadImage(file);
  const first = encode(decoded, REFERENCE_EDGE, 0.85);
  if (first.length <= REFERENCE_MAX_CHARS) return first;
  const second = encode(decoded, 1024, 0.72);
  if (second.length <= REFERENCE_MAX_CHARS) return second;
  throw new Error("这张图压不进参考图体积上限，换一张分辨率低一点的");
}

/**
 * 多张参考图 → 一张横向「三视图」拼图。
 *
 * 用在网关不认 multipart 多文件（`image[]`）的退路上：把正面 / 侧面 / 背面并排
 * 画进一张图，再当单张底图上传。每张按 contain 放进自己的格子（留边不裁），
 * 宁可留黑边也别把侧身的轮廓裁掉；总宽压到 2400 以内，再大只是上传变慢。
 */
export async function composeReferenceSheet(blobs: Blob[]): Promise<Blob | null> {
  const list = blobs.filter((blob) => blob.type.startsWith("image/"));
  if (list.length === 0) return null;
  if (list.length === 1) return list[0];
  try {
    const decoded = await Promise.all(list.map((blob) => loadImage(blob)));
    const cellWidth = Math.min(800, Math.floor(2400 / decoded.length));
    const cellHeight = Math.round(cellWidth * 1.5);
    const ctx = canvasOf(cellWidth * decoded.length, cellHeight);
    ctx.imageSmoothingQuality = "high";
    ctx.fillStyle = "#0f1115";
    ctx.fillRect(0, 0, cellWidth * decoded.length, cellHeight);
    decoded.forEach((image, index) => {
      drawContain(ctx, image, index * cellWidth, 0, cellWidth, cellHeight);
    });
    return await canvasToBlob(ctx.canvas);
  } catch {
    return null;
  }
}

/**
 * data URL → Blob，同步走 atob。
 * 底图固定是同一张，每轮都要塞进 FormData；用 `fetch(dataURL)` 会绕一遍网络栈
 * （异步解码 + Blob 转码），在 requestImage 之前白白多出几十毫秒。
 */
export function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) throw new Error("图片不是合法的 data URL");
  const header = dataUrl.slice(0, comma);
  const body = dataUrl.slice(comma + 1);
  const mime = /:(.*?)(;|$)/.exec(header)?.[1] || "image/webp";
  if (!/;base64/i.test(header)) {
    return new Blob([decodeURIComponent(body)], { type: mime });
  }
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("读取图片失败"));
    reader.readAsDataURL(file);
  });
}

async function loadImage(file: Blob): Promise<Decoded> {
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

  const ctx = canvasOf(width, height);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image.source, 0, 0, width, height);
  return toWebp(ctx.canvas, quality);
}

/**
 * 按目标比例 cover 裁切后输出固定尺寸：短边铺满、长边居中截掉，
 * 不拉伸、不留黑边。1:1 的输出裁成 2:3 时左右各切掉一截，
 * 2:3 的输出则原样缩放 —— 两种都能落到同一个框里。
 */
function encodeCropped(image: Decoded, width: number, height: number, quality: number): string {
  const ctx = canvasOf(width, height);
  ctx.imageSmoothingQuality = "high";
  drawCover(ctx, image, 0, 0, width, height);
  return toWebp(ctx.canvas, quality);
}

/** 把一张图按 cover 规则画进目标矩形：短边铺满、长边居中截掉 */
function drawCover(
  ctx: CanvasRenderingContext2D,
  image: Decoded,
  dx: number,
  dy: number,
  width: number,
  height: number,
): void {
  const scale = Math.max(width / image.width, height / image.height);
  const sourceWidth = Math.min(image.width, width / scale);
  const sourceHeight = Math.min(image.height, height / scale);
  const sourceX = (image.width - sourceWidth) / 2;
  const sourceY = (image.height - sourceHeight) / 2;
  ctx.drawImage(image.source, sourceX, sourceY, sourceWidth, sourceHeight, dx, dy, width, height);
}

/** 等比缩进目标矩形并居中，多余部分留底色 —— 参考拼图用，宁留边不裁内容 */
function drawContain(
  ctx: CanvasRenderingContext2D,
  image: Decoded,
  dx: number,
  dy: number,
  width: number,
  height: number,
): void {
  const scale = Math.min(width / image.width, height / image.height);
  const drawWidth = image.width * scale;
  const drawHeight = image.height * scale;
  ctx.drawImage(
    image.source,
    dx + (width - drawWidth) / 2,
    dy + (height - drawHeight) / 2,
    drawWidth,
    drawHeight,
  );
}

function canvasToBlob(canvas: HTMLCanvasElement, quality = 0.86): Promise<Blob | null> {  return new Promise((resolve) => {
    canvas.toBlob(
      (blob) => {
        // 老 Safari 不支持 webp 时会回调 null / 空 blob，退回 JPEG
        if (blob && blob.size > 0) {
          resolve(blob);
          return;
        }
        try {
          resolve(dataUrlToBlob(canvas.toDataURL("image/jpeg", quality)));
        } catch {
          resolve(null);
        }
      },
      "image/webp",
      quality,
    );
  });
}

function canvasOf(width: number, height: number): CanvasRenderingContext2D {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("浏览器不支持 canvas，无法处理图片");
  return ctx;
}

function toWebp(canvas: HTMLCanvasElement, quality: number): string {
  const webp = canvas.toDataURL("image/webp", quality);
  // 老 Safari 不认识 webp 时会静默退回 PNG，体积反而更大，这时改走 JPEG
  return webp.startsWith("data:image/webp") ? webp : canvas.toDataURL("image/jpeg", quality);
}
