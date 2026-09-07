import { useMemo } from "react";
import { PathTree, type PathTreeDecoration } from "@/components/tree/PathTree";
import { useViewerSettings } from "@/lib/viewerSettings";
import { useCommit, UNCOMMITTED_HASH } from "./hooks/useCommit";
import { buildDecorations, buildGitStatus } from "./fileDecorations";

export interface CommitDetailProps {
  repo: string;
  hash: string;
  /** ファイル行のクリック（Graph → Diff 遷移、ui-redesign.md §5.4）。未指定なら
   * ツリーの行クリックは何もしない。 */
  onOpenFile?(path: string): void;
  /**
   * Inline note shown above the metadata, e.g. for a root commit ("no
   * parent to diff against").
   */
  note?: string;
}

function formatDate(epochSeconds: number): string {
  if (!epochSeconds) return "";
  return new Date(epochSeconds * 1000).toLocaleString();
}

export default function CommitDetail({ repo, hash, onOpenFile, note }: CommitDetailProps) {
  const isUncommitted = hash === UNCOMMITTED_HASH;
  const query = useCommit(repo, hash);
  const [viewerSettings] = useViewerSettings();
  const files = useMemo(() => query.data?.files ?? [], [query.data]);
  const paths = useMemo(() => files.map((f) => f.path), [files]);
  const gitStatus = useMemo(() => buildGitStatus(files), [files]);
  const baseDecorations = useMemo(() => buildDecorations(files), [files]);
  // Trailing "→" only when a click actually goes somewhere (Diff jump).
  const decorations = useMemo(() => {
    if (!onOpenFile) return baseDecorations;
    const merged = new Map<string, PathTreeDecoration>();
    for (const path of paths) {
      const base = baseDecorations.get(path);
      merged.set(path, {
        text: base ? `${base.text} →` : "→",
        parts: base?.parts,
        title: base?.title,
      });
    }
    return merged;
  }, [baseDecorations, onOpenFile, paths]);

  return (
    <div className="px-2 py-1 text-sm" role="region" aria-label="commit detail">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-mono text-xs text-muted-foreground">
          {hash === UNCOMMITTED_HASH ? hash : hash.slice(0, 12)}
        </span>
      </div>

      {note && (
        <div className="mb-2 rounded-sm border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-xs text-amber-700 dark:text-amber-400">
          {note}
        </div>
      )}

      {isUncommitted ? (
        <div className="text-sm text-muted-foreground">未コミットの変更</div>
      ) : query.isLoading ? (
        <div className="text-sm text-muted-foreground">読み込み中…</div>
      ) : query.isError ? (
        <div className="text-sm text-destructive">
          {query.error instanceof Error ? query.error.message : String(query.error)}
        </div>
      ) : query.data ? (
        <div className="flex flex-col gap-2">
          <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-xs">
            <dt className="text-muted-foreground">hash</dt>
            <dd className="font-mono">{query.data.hash}</dd>
            <dt className="text-muted-foreground">parents</dt>
            <dd className="font-mono">
              {query.data.parents.length > 0 ? query.data.parents.join(" ") : "(root)"}
            </dd>
            <dt className="text-muted-foreground">author</dt>
            <dd>
              {query.data.author} &lt;{query.data.authorEmail}&gt;
            </dd>
            <dt className="text-muted-foreground">date</dt>
            <dd>{formatDate(query.data.authorDate)}</dd>
          </dl>
          <pre className="whitespace-pre-wrap font-sans text-sm">
            {query.data.subject}
            {query.data.body ? `\n\n${query.data.body}` : ""}
          </pre>
          <div
            className="rounded-sm border border-border"
            // Sized to the file count (rows are ~24px; ancestor directory
            // rows are mostly flattened away) and capped — the tree scrolls
            // internally beyond that.
            style={{ height: Math.min(320, 24 * paths.length + 32) }}
            // ルートコミットなど onOpenFile が渡らないケースは、行をクリック
            // しても Diff へは飛べない（GraphRow 参照）。
            aria-disabled={!onOpenFile}
          >
            <PathTree
              paths={paths}
              gitStatus={gitStatus}
              decorations={decorations}
              initialExpansion="open"
              fontSize={viewerSettings.fontSize}
              selectedPath={null}
              search={false}
              onSelectFile={onOpenFile}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
