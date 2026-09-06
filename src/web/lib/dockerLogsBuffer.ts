export type DockerLogLine = { stream: "stdout" | "stderr"; text: string };

/** Appends `lines` to `buf`, keeping only the last `max` entries — the
 * client only ever needs the tail (F11-9: "末尾 2000 行だけ保持"). */
export function appendLines(
  buf: readonly DockerLogLine[],
  lines: readonly DockerLogLine[],
  max: number,
): DockerLogLine[] {
  return [...buf, ...lines].slice(-max);
}
