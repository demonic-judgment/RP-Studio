"use client";

import { memo, useMemo } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { cn } from "../../lib/utils";

marked.setOptions({ gfm: true, breaks: true });

const SANITIZE = {
  ADD_ATTR: ["target"],
  FORBID_TAGS: ["style", "form", "input"],
};

function render(raw: string): string {
  try {
    const html = marked.parse(raw, { async: false }) as string;
    return DOMPurify.sanitize(html, SANITIZE);
  } catch {
    return DOMPurify.sanitize(raw.replace(/</g, "&lt;"));
  }
}

/**
 * 流式时每个动画帧都要重渲染：按空行把正文切成块，已经写完的块只解析一次，
 * 每帧只有最后一块（还在长的那个）重新解析。整段重解析会让长回复越写越卡。
 */
const cache = new Map<string, string>();
const CACHE_LIMIT = 400;
/** 上一次解析的那一块「还在长的尾巴」，下一帧就被顶掉，不留进缓存 */
let tailKey: string | null = null;

function remember(raw: string, html: string): string {
  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(raw, html);
  return html;
}

function renderCached(raw: string): string {
  const hit = cache.get(raw);
  if (hit !== undefined) return hit;
  return remember(raw, render(raw));
}

function renderTail(raw: string): string {
  const hit = cache.get(raw);
  if (hit !== undefined) return hit;
  const html = render(raw);
  if (tailKey && tailKey !== raw) cache.delete(tailKey);
  tailKey = raw;
  return remember(raw, html);
}

/** 按空行切块；代码围栏里的空行不算边界，未闭合的围栏留在最后一块里。 */
export function splitMarkdownBlocks(content: string): string[] {
  const blocks: string[] = [];
  let current: string[] = [];
  let fence: { char: string; length: number } | null = null;

  for (const line of content.split("\n")) {
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (marker) {
      const [run] = marker;
      const char = run[0];
      const length = run.length;
      if (!fence) fence = { char, length };
      else if (char === fence.char && length >= fence.length) fence = null;
    }

    if (!fence && line.trim() === "") {
      if (current.length) {
        blocks.push(current.join("\n"));
        current = [];
      }
      continue;
    }

    current.push(line);
  }

  if (current.length) blocks.push(current.join("\n"));
  return blocks;
}

const Block = memo(function Block({ html }: { html: string }) {
  return <div className="md-block" dangerouslySetInnerHTML={{ __html: html }} />;
});

export function Markdown({
  content,
  className,
  streaming = false,
}: {
  content: string;
  className?: string;
  /** 流式时最后一改块每帧都在变，走尾部解析；其余块只解析一次 */
  streaming?: boolean;
}) {
  const blocks = useMemo(() => splitMarkdownBlocks(content), [content]);
  const tail = blocks.length - 1;

  return (
    <div className={cn("md", className)}>
      {blocks.map((block, index) => (
        <Block
          key={index}
          html={streaming && index === tail ? renderTail(block) : renderCached(block)}
        />
      ))}
    </div>
  );
}
