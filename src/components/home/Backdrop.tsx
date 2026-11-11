import { useStore } from "../../lib/store";

/**
 * 页面最底层：底色 → 自定义背景图（可选）→ 强调色光斑 → 网格。
 * 设了背景图就把上面几层装饰压淡，别把照片盖成一片色雾。
 */
export function Backdrop() {
  const background = useStore((s) => s.settings.background);
  // 抽屉打开时把漂移停掉：光斑在内容列的 backdrop-filter 后面运动，
  // 后面一变化，列上的高斯模糊就得整块重算——抽屉滑入的那几帧正好撞上，
  // 移动端直接掉帧。抽屉一开就遮住了大半画面，停住看不出来。
  const frozen = useStore((s) => s.drawer !== null);
  const hasImage = Boolean(background?.url);
  const blur = background?.blur ?? 0;
  const driftState = frozen ? ("paused" as const) : ("running" as const);

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-bg">
      {hasImage && (
        <div
          className="absolute -inset-6 bg-cover bg-center bg-no-repeat transition-opacity duration-500"
          style={{
            backgroundImage: `url(${background!.url})`,
            opacity: background!.opacity,
            filter: blur ? `blur(${blur}px)` : undefined,
          }}
        />
      )}
      <div
        className="absolute inset-0 transition-opacity duration-500"
        style={{
          opacity: hasImage ? 0.55 : 1,
          background:
            "radial-gradient(120% 80% at 50% -10%, color-mix(in oklab, var(--accent) 14%, transparent) 0%, transparent 58%), radial-gradient(90% 60% at 100% 100%, color-mix(in oklab, var(--accent) 10%, transparent) 0%, transparent 62%)",
        }}
      />
      <div
        className={
          hasImage
            ? "absolute -left-[18%] top-[8%] h-[46vmax] w-[46vmax] rounded-full opacity-[0.3] blur-[80px] dark:opacity-[0.18]"
            : "absolute -left-[18%] top-[8%] h-[46vmax] w-[46vmax] rounded-full opacity-[0.62] blur-[80px] dark:opacity-[0.35]"
        }
        style={{
          background: "color-mix(in oklab, var(--accent) 18%, transparent)",
          animation: "drift 26s ease-in-out infinite",
          animationPlayState: driftState,
        }}
      />
      <div
        className={
          hasImage
            ? "absolute -right-[14%] top-[42%] h-[38vmax] w-[38vmax] rounded-full opacity-[0.26] blur-[90px] dark:opacity-[0.15]"
            : "absolute -right-[14%] top-[42%] h-[38vmax] w-[38vmax] rounded-full opacity-[0.5] blur-[90px] dark:opacity-[0.28]"
        }
        style={{
          background: "color-mix(in oklab, var(--accent) 14%, transparent)",
          animation: "drift 32s ease-in-out infinite reverse",
          animationPlayState: driftState,
        }}
      />
      <div
        className={
          hasImage
            ? "absolute inset-0 opacity-[0.12] dark:opacity-[0.07]"
            : "absolute inset-0 opacity-[0.35] dark:opacity-[0.18]"
        }
        style={{
          backgroundImage:
            "linear-gradient(to right, color-mix(in oklab, var(--fg) 6%, transparent) 1px, transparent 1px), linear-gradient(to bottom, color-mix(in oklab, var(--fg) 6%, transparent) 1px, transparent 1px)",
          backgroundSize: "72px 72px",
          maskImage:
            "radial-gradient(120% 90% at 50% 0%, #000 0%, rgba(0,0,0,0.35) 45%, transparent 78%)",
          WebkitMaskImage:
            "radial-gradient(120% 90% at 50% 0%, #000 0%, rgba(0,0,0,0.35) 45%, transparent 78%)",
        }}
      />
    </div>
  );
}
