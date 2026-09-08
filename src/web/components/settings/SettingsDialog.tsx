// 軽量な設定ダイアログ（ui-redesign.md §4.2 D8, §5.5）。config.json の編集は
// しない — ここで持つのはブラウザ側 localStorage の値（テーマ・ビューア設定・
// Diff の既定表示）と、読み取り専用の接続情報だけ。

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { configApi, healthApi } from "@/lib/api";
import { readLayout, LAYOUT_STORAGE_KEY } from "@/lib/layout";
import { useSettings } from "@/components/diff/state";
import type { DiffStyle, Overflow } from "@/components/diff/state";
import { loadTheme, setTheme, type Theme } from "@/lib/theme";
import { MAX_FONT_SIZE, MIN_FONT_SIZE } from "@/lib/codeFont";
import { useViewerSettings } from "@/lib/viewerSettings";

const KEYBOARD_SHORTCUTS: { keys: string; description: string }[] = [
  { keys: "j / k", description: "一覧内を移動" },
  { keys: "r", description: "更新" },
  { keys: "f", description: "fetch（Graph）" },
  { keys: "1–9", description: "行を開く" },
  { keys: "⌘Enter", description: "送信" },
  { keys: "Esc", description: "閉じる / キャンセル" },
  { keys: "⌘⇧M", description: "Terminal / Tool の最大化切替" },
  { keys: "⌘I", description: "Inbox の開閉" },
];

function Kbd({ children }: { children: string }) {
  return (
    <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px]">
      {children}
    </kbd>
  );
}

export interface SettingsDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const [theme, setThemeState] = useState<Theme>(() => loadTheme());
  const [viewerSettings, updateViewerSettings] = useViewerSettings();
  const [diffSettings, updateDiffSettings] = useSettings();

  const handleThemeChange = (next: Theme) => {
    setTheme(next);
    setThemeState(next);
  };

  const healthQuery = useQuery({
    queryKey: ["health"],
    queryFn: () => healthApi.get(),
    enabled: open,
    retry: false,
    staleTime: Infinity,
  });

  const configQuery = useQuery({
    queryKey: ["config"],
    queryFn: () => configApi.get(),
    enabled: open,
    retry: false,
    staleTime: Infinity,
  });

  const layout = readLayout(
    typeof localStorage !== "undefined" ? localStorage.getItem(LAYOUT_STORAGE_KEY) : null,
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>設定</DialogTitle>
        </DialogHeader>

        <section className="flex flex-col gap-3 text-sm">
          <h3 className="text-xs font-semibold text-muted-foreground">表示</h3>

          <div className="flex items-center justify-between gap-2">
            <span>テーマ</span>
            <Tabs value={theme} onValueChange={(v) => handleThemeChange(v as Theme)}>
              <TabsList>
                <TabsTrigger value="system">システム</TabsTrigger>
                <TabsTrigger value="light">ライト</TabsTrigger>
                <TabsTrigger value="dark">ダーク</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          <div className="flex items-center justify-between gap-2">
            <span>コードの文字サイズ</span>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="文字を小さく"
                disabled={viewerSettings.fontSize <= MIN_FONT_SIZE}
                onClick={() =>
                  updateViewerSettings({
                    fontSize: Math.max(MIN_FONT_SIZE, viewerSettings.fontSize - 1),
                  })
                }
              >
                <Minus className="size-3.5" aria-hidden="true" />
              </Button>
              <span className="w-6 text-center font-mono text-xs">{viewerSettings.fontSize}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="文字を大きく"
                disabled={viewerSettings.fontSize >= MAX_FONT_SIZE}
                onClick={() =>
                  updateViewerSettings({
                    fontSize: Math.min(MAX_FONT_SIZE, viewerSettings.fontSize + 1),
                  })
                }
              >
                <Plus className="size-3.5" aria-hidden="true" />
              </Button>
            </div>
          </div>

          <div className="flex items-center justify-between gap-2">
            <span>Diff の既定表示</span>
            <div className="flex items-center gap-2">
              <Tabs
                value={diffSettings.diffStyle}
                onValueChange={(v) => updateDiffSettings({ diffStyle: v as DiffStyle })}
              >
                <TabsList>
                  <TabsTrigger value="split">split</TabsTrigger>
                  <TabsTrigger value="unified">unified</TabsTrigger>
                </TabsList>
              </Tabs>
              <Tabs
                value={diffSettings.overflow}
                onValueChange={(v) => updateDiffSettings({ overflow: v as Overflow })}
              >
                <TabsList>
                  <TabsTrigger value="wrap">wrap</TabsTrigger>
                  <TabsTrigger value="scroll">scroll</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 text-muted-foreground">
            <span>既定レイアウト</span>
            <span>{`ターミナル主（Tool ${layout.toolWidth}px）`}</span>
          </div>
        </section>

        <section className="flex min-w-0 flex-col gap-1.5 text-sm">
          <h3 className="text-xs font-semibold text-muted-foreground">接続</h3>
          <div className="flex items-center justify-between gap-2">
            <span>herdr socket</span>
            <span className="text-muted-foreground">
              {healthQuery.data?.herdr.connected
                ? `接続済み · protocol ${healthQuery.data.herdr.protocol ?? "?"}`
                : "未接続"}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span>hw の宛先</span>
            <span className="truncate font-mono text-xs text-muted-foreground">
              {typeof location !== "undefined" ? location.origin : ""}
            </span>
          </div>
          <div className="flex min-w-0 items-center justify-between gap-2">
            <span className="shrink-0">設定ファイル</span>
            <span
              className="min-w-0 flex-1 truncate text-right font-mono text-xs text-muted-foreground"
              title={configQuery.data?.paths.config}
            >
              {configQuery.data?.paths.config ?? "…"}
            </span>
          </div>
          <div className="flex min-w-0 items-center justify-between gap-2">
            <span className="shrink-0">DB</span>
            <span
              className="min-w-0 flex-1 truncate text-right font-mono text-xs text-muted-foreground"
              title={configQuery.data?.paths.db}
            >
              {configQuery.data?.paths.db ?? "…"}
            </span>
          </div>
        </section>

        <section className="flex flex-col gap-1.5 text-sm">
          <h3 className="text-xs font-semibold text-muted-foreground">キーボード</h3>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
            {KEYBOARD_SHORTCUTS.map((s) => (
              <div key={s.keys} className="contents">
                <dt>
                  <Kbd>{s.keys}</Kbd>
                </dt>
                <dd className="text-muted-foreground">{s.description}</dd>
              </div>
            ))}
          </dl>
        </section>

        <div className="flex justify-end">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            閉じる
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default SettingsDialog;
