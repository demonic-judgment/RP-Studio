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

const LIST_ITEM = /^\s*(?:[-*+]|\d{1,3}[.)])\s+/;

function isTableRow(line: string) {
  return line.includes("|");
}

function isQuote(line: string) {
  return line.trimStart().startsWith(">");
}

function isIndented(line: string) {
  return /^(?:\t| {2,})/.test(line);
}

/** 这两行属于同一个结构（表格逐行、引用连续、列表项连续、缩进续行），保留单换行 */
function keepTight(prev: string, next: string) {
  if (isTableRow(prev) && isTableRow(next)) return true;
  if (isQuote(prev) && isQuote(next)) return true;
  if (LIST_ITEM.test(prev) && LIST_ITEM.test(next)) return true;
  return isIndented(next);
}

/**
 * 换行归一：任意两段文字之间，无论模型吐的是 1 个还是 4 个换行，都收成「一个空行」。
 * 渲染上就只剩一种间距，不会同一屏里一段紧一段松。
 * 代码围栏整块原样保留；表格 / 引用 / 列表这类靠连续行成形的结构也不拆开。
 */
export function normalizeParagraphs(content: string): string {
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const chunks: string[] = [];
  let current: string[] = [];
  let fence: { char: string; len: number } | null = null;

  const close = () => {
    if (current.length) {
      chunks.push(current.join("\n"));
      current = [];
    }
  };

  for (const raw of lines) {
    const line = raw.replace(/[ \t]+$/, "");
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line);

    if (fence) {
      current.push(line);
      if (marker && marker[1][0] === fence.char && marker[1].length >= fence.len) {
        fence = null;
        close();
      }
      continue;
    }

    if (marker) {
      close();
      fence = { char: marker[1][0], len: marker[1].length };
      current.push(line);
      continue;
    }

    if (!line.trim()) {
      close();
      continue;
    }

    const prev = current[current.length - 1];
    if (prev !== undefined && keepTight(prev, line)) {
      current.push(line);
    } else {
      close();
      current.push(line);
    }
  }

  close();
  return chunks.join("\n\n");
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
  const blocks = useMemo(() => splitMarkdownBlocks(normalizeParagraphs(content)), [content]);
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
