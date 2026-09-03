// Trimmed port of terminal-diff's src/client/components/Banners.tsx.
// Dropped: disconnected/reconnecting (SSE-only concepts) and notReady (herdr-web
// has no 503 "server not ready" path). Kept: the update-available banner
// (state.ts's updateBanner), a generic fetch-error banner, and the
// untracked-truncated notice.

import type { UpdateBanner } from "./state.ts";

export interface BannersProps {
  updateBanner: UpdateBanner | null;
  errorText: string | null;
  untrackedTruncated: boolean;
  onUpdate(): void;
}

export default function Banners({
  updateBanner,
  errorText,
  untrackedTruncated,
  onUpdate,
}: BannersProps) {
  return (
    <div id="banners" className="flex flex-col gap-1 empty:hidden">
      {updateBanner && (
        <div
          className="banner banner-update flex items-center justify-between gap-2 bg-accent px-2 py-1 text-sm text-accent-foreground"
          key="update"
        >
          <span>{updateBanner.text}</span>
          <button type="button" className="underline" onClick={onUpdate}>
            ↻ 更新 (r)
          </button>
        </div>
      )}
      {errorText && (
        <div
          className="banner banner-error bg-destructive/10 px-2 py-1 text-sm text-destructive"
          key="error"
        >
          <span>{errorText}</span>
        </div>
      )}
      {untrackedTruncated && (
        <div
          className="banner banner-truncated bg-accent px-2 py-1 text-sm text-accent-foreground"
          key="truncated"
        >
          <span>未追跡ファイルが多いため一部省略されています</span>
        </div>
      )}
    </div>
  );
}
