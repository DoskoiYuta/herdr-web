import { describe, expect, test } from "vitest";
import { collectDroppedFiles } from "./dropEntries";

interface FakeEntry {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file?(success: (file: File) => void, error: (err: unknown) => void): void;
  createReader?(): {
    readEntries(success: (entries: FakeEntry[]) => void, error: (err: unknown) => void): void;
  };
}

function fakeFileEntry(name: string, contents = "x"): FakeEntry {
  return {
    isFile: true,
    isDirectory: false,
    name,
    file: (success) => success(new File([contents], name)),
  };
}

function fakeDirEntry(name: string, batches: FakeEntry[][]): FakeEntry {
  let call = 0;
  return {
    isFile: false,
    isDirectory: true,
    name,
    createReader: () => ({
      readEntries: (success) => {
        const batch = batches[call] ?? [];
        call += 1;
        success(batch);
      },
    }),
  };
}

function fakeDataTransfer(entries: FakeEntry[]): DataTransfer {
  return {
    items: entries.map((entry) => ({
      kind: "file",
      webkitGetAsEntry: () => entry,
      getAsFile: () => null,
    })),
  } as unknown as DataTransfer;
}

async function names(dataTransfer: DataTransfer): Promise<string[]> {
  const files = await collectDroppedFiles(dataTransfer);
  return files.map((f) => f.name).sort();
}

describe("collectDroppedFiles", () => {
  test("a single dropped file becomes one File with its bare name", async () => {
    const dt = fakeDataTransfer([fakeFileEntry("a.txt")]);
    expect(await names(dt)).toEqual(["a.txt"]);
  });

  test("a nested folder's files get a slash-joined relative path", async () => {
    const dt = fakeDataTransfer([
      fakeDirEntry("photos", [
        [fakeFileEntry("a.jpg"), fakeDirEntry("sub", [[fakeFileEntry("b.jpg")], []])],
      ]),
    ]);
    expect(await names(dt)).toEqual(["photos/a.jpg", "photos/sub/b.jpg"]);
  });

  // Without paging through readEntries until an empty batch, a folder large
  // enough to be paged (Chrome caps a single call at ~100 entries) would
  // silently lose everything after the first batch.
  test("a directory reader that pages results across two batches yields both", async () => {
    const dt = fakeDataTransfer([
      fakeDirEntry("many", [[fakeFileEntry("1.txt")], [fakeFileEntry("2.txt")], []]),
    ]);
    expect(await names(dt)).toEqual(["many/1.txt", "many/2.txt"]);
  });
});
