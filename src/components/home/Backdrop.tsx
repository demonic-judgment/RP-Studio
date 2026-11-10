export function Backdrop() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-bg">
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 80% at 50% -10%, color-mix(in oklab, var(--accent) 14%, transparent) 0%, transparent 58%), radial-gradient(90% 60% at 100% 100%, color-mix(in oklab, var(--accent) 10%, transparent) 0%, transparent 62%)",
        }}
      />
      <div
        className="absolute -left-[18%] top-[8%] h-[46vmax] w-[46vmax] rounded-full opacity-[0.62] blur-[80px] dark:opacity-[0.35]"
        style={{
          background: "color-mix(in oklab, var(--accent) 18%, transparent)",
          animation: "drift 26s ease-in-out infinite",
        }}
      />
      <div
        className="absolute -right-[14%] top-[42%] h-[38vmax] w-[38vmax] rounded-full opacity-[0.5] blur-[90px] dark:opacity-[0.28]"
        style={{
          background: "color-mix(in oklab, var(--accent) 14%, transparent)",
          animation: "drift 32s ease-in-out infinite reverse",
        }}
      />
      <div
        className="absolute inset-0 opacity-[0.35] dark:opacity-[0.18]"
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
