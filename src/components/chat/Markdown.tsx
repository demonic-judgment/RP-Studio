import { useMemo } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { cn } from "../../lib/utils";

marked.setOptions({ gfm: true, breaks: true });

export function Markdown({ content, className }: { content: string; className?: string }) {
  const html = useMemo(() => {
    try {
      const raw = marked.parse(content, { async: false }) as string;
      return DOMPurify.sanitize(raw, {
        ADD_ATTR: ["target"],
        FORBID_TAGS: ["style", "form", "input"],
      });
    } catch {
      return DOMPurify.sanitize(content.replace(/</g, "&lt;"));
    }
  }, [content]);

  return <div className={cn("md", className)} dangerouslySetInnerHTML={{ __html: html }} />;
}
