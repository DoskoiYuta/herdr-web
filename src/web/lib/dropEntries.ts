// OS drag-and-drop import (plan.md F9-7): turns a `DataTransfer` from a
// Finder/Explorer drop into flat `File`s whose `.name` is the path relative
// to the drop root, `/`-separated (a nested folder drop becomes
// `sub/dir/name.ext`) — `gitApi.upload` sends each `File`'s name as its
// multipart part filename, which the server treats as the write path
// relative to the target directory.

interface FileSystemEntryLike {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
}

interface FileSystemFileEntryLike extends FileSystemEntryLike {
  isFile: true;
  isDirectory: false;
  file(success: (file: File) => void, error: (err: unknown) => void): void;
}

interface FileSystemDirectoryEntryLike extends FileSystemEntryLike {
  isFile: false;
  isDirectory: true;
  createReader(): {
    readEntries(
      success: (entries: FileSystemEntryLike[]) => void,
      error: (err: unknown) => void,
    ): void;
  };
}

async function walk(entry: FileSystemEntryLike, prefix: string, out: File[]): Promise<void> {
  if (entry.isFile) {
    const fileEntry = entry as FileSystemFileEntryLike;
    const file = await new Promise<File>((resolve, reject) => fileEntry.file(resolve, reject));
    out.push(new File([file], `${prefix}${file.name}`, { type: file.type }));
    return;
  }
  if (!entry.isDirectory) return;
  const dirEntry = entry as FileSystemDirectoryEntryLike;
  const reader = dirEntry.createReader();
  const dirPrefix = `${prefix}${entry.name}/`;
  // Chrome's DirectoryReader hands back at most 100 entries per
  // `readEntries` call and signals the end with an empty batch — reading
  // once silently truncates any folder larger than that.
  for (;;) {
    const batch = await new Promise<FileSystemEntryLike[]>((resolve, reject) =>
      reader.readEntries(resolve, reject),
    );
    if (batch.length === 0) break;
    await Promise.all(batch.map((child) => walk(child, dirPrefix, out)));
  }
}

/** Recursively resolves a drop's `DataTransfer` into `File`s. Folders are
 * only expanded through `webkitGetAsEntry`; an item without an entry (a
 * plain file drag in a browser lacking the API) falls back to `getAsFile`
 * with no path prefix. */
export async function collectDroppedFiles(dataTransfer: DataTransfer): Promise<File[]> {
  const roots: { entry: FileSystemEntryLike | null; file: File | null }[] = [];
  for (const item of Array.from(dataTransfer.items)) {
    if (item.kind !== "file") continue;
    const getAsEntry = (
      item as DataTransferItem & { webkitGetAsEntry?: () => FileSystemEntryLike | null }
    ).webkitGetAsEntry;
    const entry = getAsEntry?.call(item) ?? null;
    roots.push({ entry, file: entry ? null : item.getAsFile() });
  }

  const out: File[] = [];
  await Promise.all(
    roots.map(({ entry, file }) => {
      if (entry) return walk(entry, "", out);
      if (file) out.push(file);
      return Promise.resolve();
    }),
  );
  return out;
}
