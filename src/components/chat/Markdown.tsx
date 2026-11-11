"use client";

import { memo, useMemo } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { cn } from "../../lib/utils";

marked.setOptions({ gfm: true, breaks: true });

const SANITIZE = {
  // details / summary / open 本就在 DOMPurify 的默认白名单里，这里显式列出，
  // 是为了把「折叠块必须活下来」写进代码：以后动 ADD_* / FORBID_* 时不会误删。
  ADD_ATTR: ["target", "open"],
  ADD_TAGS: ["details", "summary"],
  FORBID_TAGS: ["style", "form", "input"],
};

/**
 * 角色扮演的正文基本是「台词 + 叙述」交替：台词在引号里，叙述常常是斜体。
 * 这里把引号包住的整段话包进 <strong>，台词自然从叙述里跳出来。
 *
 * 只处理文本节点，标签（含属性里的引号）一概不动；`code` / `pre` 里的引号是代码，
 * 跳过。末尾那个 `(?:」|$)` 让流式期间已开未闭的引号也先加粗，
 * 免得台词打到一半才突然变粗、跳一下行宽。
 */
const QUOTE_RUN = /「[^「」]+(?:」|$)|『[^『』]+(?:』|$)|“[^“”]+(?:”|$)|"[^"]+(?:"|$)/g;

function boldQuotes(html: string): string {
  if (typeof document === "undefined") return html;
  if (!/[「『“"]/.test(html)) return html;

  const template = document.createElement("template");
  template.innerHTML = html;

  const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);

  let changed = false;
  for (const node of nodes) {
    if (node.parentElement?.closest("code, pre")) continue;

    const text = node.data;
    const re = new RegExp(QUOTE_RUN.source, "g");
    let last = 0;
    let match: RegExpExecArray | null;
    let fragment: DocumentFragment | null = null;

    while ((match = re.exec(text))) {
      fragment ??= document.createDocumentFragment();
      if (match.index > last) fragment.append(text.slice(last, match.index));
      const strong = document.createElement("strong");
      strong.className = "md-quote";
      strong.textContent = match[0];
      fragment.append(strong);
      last = match.index + match[0].length;
    }

    if (!fragment) continue;
    if (last < text.length) fragment.append(text.slice(last));
    node.replaceWith(fragment);
    changed = true;
  }

  return changed ? template.innerHTML : html;
}

function render(raw: string): string {
  try {
    const html = marked.parse(raw, { async: false }) as string;
    return boldQuotes(DOMPurify.sanitize(html, SANITIZE));
  } catch {
    return boldQuotes(DOMPurify.sanitize(raw.replace(/</g, "&lt;")));
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

/**
 * 模型经常用 HTML 折叠块包代码：
 *
 *   <details><summary>展开</summary><pre><code>…</code></pre></details>
 *
 * 这类块必须整块交给 marked 一次解析。归一换行时把 `<details>` 与 `<summary>`
 * 当成两个普通段落补了空行、切块时空行又把 `</details>` 分到下一块，
 * 结果就是 `<details>` 单独落进一个 .md-block，被浏览器自动闭合成了空壳，
 * 代码全掉到面板外面。所以两步切分都要能认出「这是 HTML 容器块」，
 * 块内的空行一概不当分段边界。
 */
const HTML_CONTAINERS = new Set([
  "details",
  "summary",
  "pre",
  "div",
  "section",
  "figure",
  "table",
  "ul",
  "ol",
  "dl",
  "blockquote",
]);

const HTML_OPEN = /^\s{0,3}<([a-zA-Z][\w:-]*)(?=[\s/>])/;

interface HtmlBlock {
  tag: string;
  depth: number;
}

function tagBalance(line: string, tag: string) {
  const open = line.match(new RegExp(`<${tag}(?=[\\s/>])`, "gi"))?.length ?? 0;
  const close = line.match(new RegExp(`</${tag}\\s*>`, "gi"))?.length ?? 0;
  return open - close;
}

/** 已有块则推进深度（闭合标签把它送回 null），否则判断这一行是否开一个新块 */
function trackHtmlBlock(state: HtmlBlock | null, line: string): HtmlBlock | null {
  if (state) {
    const depth = state.depth + tagBalance(line, state.tag);
    return depth > 0 ? { tag: state.tag, depth } : null;
  }

  const match = HTML_OPEN.exec(line);
  if (!match) return null;
  const tag = match[1].toLowerCase();
  if (!HTML_CONTAINERS.has(tag)) return null;

  // 同一行就闭合（<details>…</details>）或自闭合时不算开块
  const depth = tagBalance(line, tag);
  return depth > 0 ? { tag, depth } : null;
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

/** 行尾是冒号（中英文都算）：下一行通常是它的展开，属于上一句的一部分 */
function endsWithColon(line: string) {
  return /[:：]\s*$/.test(line);
}

/** 这两行属于同一个结构（表格逐行、引用连续、列表项连续、缩进续行），保留单换行 */
function keepTight(prev: string, next: string) {
  if (isTableRow(prev) && isTableRow(next)) return true;
  if (isQuote(prev) && isQuote(next)) return true;
  if (LIST_ITEM.test(prev) && LIST_ITEM.test(next)) return true;
  if (isIndented(next)) return true;
  // 「他说：」后面只跟了一个换行时保持原样，不补成空行。
  // 表格得从块首开始才能成表，所以那一行例外。
  if (endsWithColon(prev) && !isTableRow(next)) return true;
  return false;
}

/**
 * 换行归一：任意两段文字之间，无论模型吐的是 1 个还是 4 个换行，都收成「一个空行」。
 * 渲染上就只剩一种间距，不会同一屏里一段紧一段松。
 * 代码围栏整块原样保留；表格 / 引用 / 列表这类靠连续行成形的结构也不拆开。
 *
 * 唯一的例外是行尾冒号：「他说：」后面只跟了一个换行时保持单换行，
 * 那是同一句话的展开，拆成两段会读断。真正的空行（冒号后面还有空行）仍然分段。
 */
export function normalizeParagraphs(content: string): string {
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const chunks: string[] = [];
  let current: string[] = [];
  let fence: { char: string; len: number } | null = null;
  let html: HtmlBlock | null = null;

  const close = () => {
    if (current.length) {
      chunks.push(current.join("\n"));
      current = [];
    }
  };

  for (const raw of lines) {
    const line = raw.replace(/[ \t]+$/, "");

    // HTML 容器块内部整段原样保留：连空行都不算分段，否则 <details> 与内容会被拆散
    if (html) {
      current.push(line);
      html = trackHtmlBlock(html, line);
      if (!html) close();
      continue;
    }

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

    const opened = trackHtmlBlock(null, line);
    if (opened) {
      close();
      current.push(line);
      html = opened;
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

/** 按空行切块；代码围栏与 HTML 容器块里的空行不算边界，未闭合的留在最后一块里。 */
export function splitMarkdownBlocks(content: string): string[] {
  const blocks: string[] = [];
  let current: string[] = [];
  let fence: { char: string; length: number } | null = null;
  let html: HtmlBlock | null = null;

  for (const line of content.split("\n")) {
    if (html) {
      current.push(line);
      html = trackHtmlBlock(html, line);
      continue;
    }

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

    if (!fence) {
      const opened = trackHtmlBlock(null, line);
      if (opened) html = opened;
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
