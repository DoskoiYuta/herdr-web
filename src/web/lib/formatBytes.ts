/** Human file-size label for the Files header ("4.2 KB" / "80 bytes"),
 * matching design.pen's compact `path · size · language` line. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  const units = ["KB", "MB", "GB"] as const;
  let value = bytes / 1024;
  let unitIndex = 0;
  // Compares the *rounded* value against the unit boundary: a raw value
  // like 1023.99 is < 1024 but rounds to "1024.0", which must still bump to
  // the next unit rather than print "1024.0 KB".
  while (unitIndex < units.length - 1 && Number(value.toFixed(1)) >= 1024) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}
