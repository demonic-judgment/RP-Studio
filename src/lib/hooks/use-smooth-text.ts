"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";

/** 与官网演示一致：每秒推进 96 个字符 */
const DEFAULT_CPS = 96;
/** 落后超过这个字数就开始加速追赶，网络成块到达时才不会拖尾 */
const CATCH_UP_AT = 90;
const MAX_MULTIPLIER = 6;

interface SmoothTextOptions {
  /** false 时直接返回全文（已完成的消息、编辑器预览等） */
  enabled?: boolean;
  charsPerSecond?: number;
}

/**
 * 打字机：把「目标文本」按帧匀速揭示出来。
 *
 * 直接用网络缓冲渲染时，一帧可能吞进一整句，视觉上是一跳一跳的；这里维持一个
 * 浮点游标，每帧按 charsPerSecond 前进，落后太多就按比例加速，保证既不跳字也不拖尾。
 *
 * 追平之后不再往 rAF 里挂号：模型停顿的那几百毫秒里没有新字要揭，
 * 空转的帧只会白白让这条消息重渲染 60 次/秒。下一段文字到达时再启动。
 */
export function useSmoothText(text: string, options: SmoothTextOptions = {}): string {
  const { enabled = true, charsPerSecond = DEFAULT_CPS } = options;
  const reduce = useReducedMotion() ?? false;
  const animate = enabled && !reduce;

  const [visible, setVisible] = useState(() => (animate ? 0 : text.length));
  const textRef = useRef(text);
  const positionRef = useRef(animate ? 0 : text.length);
  const shownRef = useRef(animate ? 0 : text.length);
  const frameRef = useRef(0);
  const lastRef = useRef(0);
  const speedRef = useRef(charsPerSecond);
  speedRef.current = charsPerSecond;

  const pump = useCallback(() => {
    frameRef.current = 0;
    const target = textRef.current;
    const backlog = target.length - positionRef.current;
    // 追上了就退出循环，等 text 变长时由下面的 effect 重新启动
    if (backlog <= 0) return;

    const now = performance.now();
    const dt = Math.min(64, now - lastRef.current) / 1000;
    lastRef.current = now;

    const speed = speedRef.current * Math.min(MAX_MULTIPLIER, Math.max(1, backlog / CATCH_UP_AT));
    positionRef.current = Math.min(target.length, positionRef.current + speed * dt);

    let next = Math.floor(positionRef.current);
    // 别把 emoji 之类的代理对劈成两半
    if (next > 0 && next < target.length) {
      const code = target.charCodeAt(next - 1);
      if (code >= 0xdc00 && code <= 0xdfff) next -= 1;
    }

    if (next !== shownRef.current) {
      shownRef.current = next;
      setVisible(next);
    }

    if (positionRef.current < target.length) {
      frameRef.current = requestAnimationFrame(pump);
    }
  }, []);

  const start = useCallback(() => {
    if (frameRef.current || positionRef.current >= textRef.current.length) return;
    lastRef.current = performance.now();
    frameRef.current = requestAnimationFrame(pump);
  }, [pump]);

  useEffect(() => {
    textRef.current = text;

    if (!animate) {
      if (shownRef.current !== text.length) {
        positionRef.current = text.length;
        shownRef.current = text.length;
        setVisible(text.length);
      }
      return;
    }

    // 重新生成 / 清空缓冲时，游标不能停在旧文本的长度上
    if (positionRef.current > text.length) {
      positionRef.current = text.length;
      shownRef.current = text.length;
      setVisible(text.length);
    }

    start();
  }, [text, animate, start]);

  useEffect(
    () => () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
    },
    [],
  );

  return animate ? text.slice(0, visible) : text;
}
