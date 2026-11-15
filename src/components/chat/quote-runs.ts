/**
 * 找出台词加粗的区间：返回 `[start, end)`，只给「最外层」。
 *
 * 纯文本逻辑，不碰 DOM —— 这里既不认标签也不认 Markdown，调用方负责把文本节点
 * 拼成一段再交进来（见 `Markdown.tsx` 的 `boldQuotes`）。
 */

/** 成对的引号：开 → 闭。弯引号方向固定，按字符查表就行。 */
const PAIRS: Record<string, string> = {
  "「": "」",
  "『": "』",
  "“": "”",
  "‘": "’",
};

const CLOSERS = new Set(["」", "』", "”", "’"]);

/** 引号前面是这些字符，说明它是开引号（`他说：“走吧”`） */
const BEFORE_OPEN = /[（(【\[「『“‘—–…:：,，。！？!?、]/;
/** 引号后面是这些字符，说明它是闭引号（`“走吧。”`）。`]` 必须转义，否则字符类提前收尾 */
const AFTER_CLOSE = /[）)】\]」』”’"'。，、！？；：.,!?;:…—]/;

/**
 * 一段正文 = 若干个文本节点的正文拼起来（中间可能夹着 <br> 或行内强调）。
 * 引号的开合必须跨节点判断：`「你来了，⏎坐下吧。」` 的闭引号落在后一个节点上，
 * 逐个节点扫的话前半句加粗、后半句不加粗，一句话被劈成两半。
 *
 * 返回与 `texts` 等长的区间列表，下标都相对于各自的节点。
 */
export function planQuotes(texts: string[]): Array<Array<[number, number]>> {
  const base: number[] = [];
  let joined = "";
  for (const text of texts) {
    base.push(joined.length);
    joined += text;
  }

  const runs = findQuoteRuns(joined);
  return texts.map((text, index) => {
    const offset = base[index];
    const end = offset + text.length;
    const slices: Array<[number, number]> = [];
    for (const [start, stop] of runs) {
      const from = Math.max(start, offset);
      const to = Math.min(stop, end);
      if (to > from) slices.push([from - offset, to - offset]);
    }
    return slices;
  });
}

export function findQuoteRuns(text: string): Array<[number, number]> {
  const runs: Array<[number, number]> = [];
  /** 已开未闭的引号栈；栈底是最外层 */
  const open: Array<{ close: string; at: number }> = [];

  /**
   * 从第 `index` 个开引号处闭合。中间那些没等来闭引号的内层引号一并收掉：
   * 引号套引号时外层才是要加粗的那一段，内层漏一个反而不能把外层截断。
   */
  const close = (index: number, end: number) => {
    const start = open[index].at;
    open.length = index;
    // 「」这种空引号不值得加粗，多半是打错字
    if (!open.length && end - start > 2) runs.push([start, end]);
  };

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];

    const pair = PAIRS[ch];
    if (pair) {
      open.push({ close: pair, at: i });
      continue;
    }

    if (CLOSERS.has(ch)) {
      let k = open.length - 1;
      while (k >= 0 && open[k].close !== ch) k -= 1;
      if (k >= 0) close(k, i + 1);
      continue;
    }

    if (ch !== '"' && ch !== "'") continue;

    // 直引号开合同形，只能看位置：前面是空白 / 标点算开，后面是空白 / 标点算闭。
    // 两边都不像就当撇号跳过（`don't`、`5'10"`），否则整句会被一对撇号串起来加粗。
    const prev = text[i - 1] ?? "";
    const next = text[i + 1] ?? "";
    const beforeGap = !prev || /\s/.test(prev);
    const afterGap = !next || /\s/.test(next);
    const opens = !afterGap && (beforeGap || BEFORE_OPEN.test(prev));
    const closes = !beforeGap && (afterGap || AFTER_CLOSE.test(next));

    const top = open[open.length - 1];
    if (top && top.close === ch && closes) {
      close(open.length - 1, i + 1);
      continue;
    }
    // `'90s` 这种缩写撇号后面跟数字，开在句首又永远等不到闭引号，会一路粗到段尾
    if (opens && !(ch === "'" && /\d/.test(next))) open.push({ close: ch, at: i });
  }

  // 末尾还没闭合：流式期间先把已开的那句加粗，免得台词打到一半才突然变粗、行宽跳一下
  if (open.length && text.length - open[0].at > 1) runs.push([open[0].at, text.length]);

  return runs;
}
