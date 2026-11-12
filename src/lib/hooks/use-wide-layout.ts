"use client";

import { useEffect, useState } from "react";

/** 桌面端断点：够宽时常驻左侧边栏，窄屏仍用遮罩式抽屉 */
export const WIDE_QUERY = "(min-width: 1024px)";

/**
 * 是否走「桌面常驻侧边栏」布局。
 * 首次渲染就同步读 matchMedia，避免先画一帧抽屉版再跳成侧边栏。
 */
export function useWideLayout(): boolean {
  const [wide, setWide] = useState(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia(WIDE_QUERY).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia(WIDE_QUERY);
    const update = () => setWide(mq.matches);
    update();
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, []);

  return wide;
}
