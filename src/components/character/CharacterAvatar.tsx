import { useState } from "react";
import type { Character, Space } from "../../lib/types";
import { cn } from "../../lib/utils";

/** 角色当前用的底图：自己选的优先，没选就退回空间底图库第一张 */
export function characterSeed(
  character?: Pick<Character, "activeSeed"> | null,
  space?: Pick<Space, "imageSeeds"> | null,
): string {
  return character?.activeSeed || space?.imageSeeds?.find(Boolean) || "";
}

/**
 * 角色头像 = 这个角色的底图，2:3 圆角矩形。
 *
 * 底图缺图 / 加载失败时退回 emoji 占位，盒子比例不变，
 * 免得列表、消息头在切角色时跳一下。
 */
export function CharacterAvatar({
  seed,
  emoji,
  className,
  rounded = "rounded-[5px]",
  emojiSize = 14,
  alt = "",
}: {
  seed: string;
  emoji: string;
  /** 只管宽度；高度按 2:3 自动算 */
  className?: string;
  rounded?: string;
  emojiSize?: number;
  alt?: string;
}) {
  // 记住是哪一张图坏了：换了底图要重新试，不能一次失败就永久显示 emoji
  const [failed, setFailed] = useState<string | null>(null);
  const broken = !seed || failed === seed;

  return (
    <span
      className={cn(
        "relative block aspect-[2/3] shrink-0 overflow-hidden bg-surface-2",
        rounded,
        className,
      )}
    >
      {broken ? (
        <span
          className="flex h-full w-full items-center justify-center leading-none"
          style={{ fontSize: emojiSize }}
        >
          {emoji}
        </span>
      ) : (
        <img
          src={seed}
          alt={alt}
          loading="lazy"
          draggable={false}
          onError={() => setFailed(seed)}
          className="h-full w-full object-cover"
        />
      )}
    </span>
  );
}
