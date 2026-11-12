import { useRef, useState } from "react";
import { ArrowUpRight, ImagePlus, Link2, Sparkles, Trash2 } from "lucide-react";
import { useStore } from "../../lib/store";
import { prepareBackgroundImage } from "../../lib/image";
import type { BackgroundConfig } from "../../lib/types";
import { Button } from "../ui/Button";
import { Field, Input, Slider } from "../ui/Form";

/** 拖滑杆时只在内存里改，停手 320ms 才写库（背景图是几百 KB 的 data URL） */
const PERSIST_DELAY = 320;

export function BackgroundSettings() {
  const background = useStore((s) => s.settings.background);
  const setSettings = useStore((s) => s.setSettings);
  const toast = useStore((s) => s.toast);

  const fileRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<number | null>(null);
  const [picking, setPicking] = useState(false);
  const [urlDraft, setUrlDraft] = useState("");

  const commit = (next: BackgroundConfig | undefined, persist: boolean) => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    void setSettings({ background: next }, { persist: false });
    if (persist) {
      void setSettings({ background: next }, { persist: true });
      return;
    }
    timerRef.current = window.setTimeout(() => {
      void setSettings({ background: next }, { persist: true });
      timerRef.current = null;
    }, PERSIST_DELAY);
  };

  const handleFile = async (file: File) => {
    if (picking) return;
    setPicking(true);
    try {
      const url = await prepareBackgroundImage(file);
      commit({ url, opacity: background?.opacity ?? 1, blur: background?.blur ?? 0 }, true);
      toast({ title: "背景已更新", description: describeSize(url), variant: "success" });
    } catch (err) {
      toast({
        title: "这张图用不了",
        description: err instanceof Error ? err.message : String(err),
        variant: "error",
      });
    } finally {
      setPicking(false);
    }
  };

  const applyUrl = () => {
    const raw = urlDraft.trim();
    if (!raw) return;
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      toast({ title: "链接不完整", description: "需要完整的 http(s) 图片地址", variant: "error" });
      return;
    }
    if (!/^https?:$/.test(parsed.protocol)) {
      toast({ title: "只支持 http(s) 链接", variant: "error" });
      return;
    }
    commit({ url: parsed.toString(), opacity: background?.opacity ?? 1, blur: background?.blur ?? 0 }, true);
    setUrlDraft("");
    toast({ title: "背景已更新", description: "图裂了的话，下载后再上传", variant: "success" });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[12.5px] font-medium text-fg-muted">主页背景</p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-fg-subtle">
            建议选对比度低一些的图，正文更好读
          </p>
        </div>
        <a
          href="https://www.pixiv.net/discovery"
          target="_blank"
          rel="noreferrer noopener"
          className="flex shrink-0 items-center gap-1 rounded-full bg-secondary-container px-inset-pill py-1 text-[10.5px] text-on-primary-container transition-colors hover:bg-primary-container"
        >
          <Sparkles size={11} />
          去 Pixiv 找图
          <ArrowUpRight size={11} />
        </a>
      </div>

      <div className="overflow-hidden rounded-2xl border border-line bg-surface-2">
        <div
          className="relative flex aspect-[16/9] items-center justify-center bg-cover bg-center"
          style={
            background
              ? {
                  backgroundImage: `url(${background.url})`,
                  filter: background.blur ? `blur(${Math.min(background.blur, 12)}px)` : undefined,
                  opacity: background.opacity,
                }
              : undefined
          }
        >
          {!background && (
            <div className="flex flex-col items-center gap-1 text-fg-subtle">
              <ImagePlus size={18} />
              <p className="text-[11px]">还没有背景图</p>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-line px-inset-sm py-2">
          <Button
            size="sm"
            variant="outline"
            leading={<ImagePlus size={13} />}
            onClick={() => fileRef.current?.click()}
            disabled={picking}
          >
            {picking ? "处理中…" : "选择图片"}
          </Button>
          {background && (
            <Button
              size="sm"
              variant="ghost"
              className="text-danger"
              leading={<Trash2 size={13} />}
              onClick={() => {
                commit(undefined, true);
                toast({ title: "已移除背景", variant: "default" });
              }}
            >
              移除
            </Button>
          )}
          <span className="ml-auto text-[10.5px] text-fg-subtle">{describeSize(background?.url)}</span>
        </div>
      </div>

      <Field label="图片直链" hint="建议下载后上传：很多站点的外链直接填会裂图">
        <div className="flex gap-2">
          <Input
            value={urlDraft}
            onChange={(e) => setUrlDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                applyUrl();
              }
            }}
            placeholder="https://…/cover.jpg"
            className="h-9 text-[12.5px]"
          />
          <Button size="sm" variant="outline" leading={<Link2 size={13} />} onClick={applyUrl} disabled={!urlDraft.trim()}>
            使用
          </Button>
        </div>
      </Field>

      {background && (
        <div className="space-y-3 rounded-2xl bg-surface-2 p-inset-sm">
          <div>
            <p className="mb-1.5 text-[12px] text-fg">不透明度</p>
            <Slider
              value={Math.round(background.opacity * 100)}
              min={20}
              max={100}
              step={1}
              suffix="%"
              onChange={(value) => commit({ ...background, opacity: value / 100 }, false)}
            />
          </div>
          <div>
            <p className="mb-1.5 text-[12px] text-fg">模糊</p>
            <Slider
              value={background.blur}
              min={0}
              max={24}
              step={1}
              suffix="px"
              onChange={(value) => commit({ ...background, blur: value }, false)}
            />
          </div>
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
          e.target.value = "";
        }}
      />
    </div>
  );
}

/** data URL 的实际体积，外链则只给个「外链」字样 */
function describeSize(url: string | undefined): string {
  if (!url) return "";
  if (!url.startsWith("data:")) return "外链";
  const base64 = url.slice(url.indexOf(",") + 1);
  return `约 ${Math.max(1, Math.round((base64.length * 3) / 4 / 1024))} KB`;
}
