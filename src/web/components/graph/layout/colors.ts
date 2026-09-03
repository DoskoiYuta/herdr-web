/**
 * Lane color palette and allocation.
 *
 * Medium-saturation colors chosen so they read clearly against both a light
 * and a dark terminal background (avoids near-white pastels and near-black
 * shades at either extreme).
 */
export const PALETTE: readonly string[] = [
  "#d9534f", // red
  "#5cb85c", // green
  "#3498db", // blue
  "#f0ad4e", // orange
  "#9b59b6", // purple
  "#1abc9c", // teal
  "#e67e22", // dark orange
  "#5bc0de", // cyan
  "#e91e8c", // pink
  "#8e9b0c", // olive
];

/**
 * Creates a stateful color allocator: each call to the returned function
 * hands out the next palette index, cycling through the palette while
 * avoiding indices used in the last `avoidWindow` allocations (so freshly
 * adjacent lanes don't end up the same color).
 *
 * A fresh allocator should be created per layout run to keep `layoutGraph`
 * deterministic for identical input.
 */
export function createColorAllocator(
  paletteSize: number = PALETTE.length,
  avoidWindow: number = 3,
): () => number {
  let cursor = 0;
  const recent: number[] = [];

  return function allocColor(): number {
    let chosen = cursor;
    for (let i = 0; i < paletteSize; i++) {
      const candidate = (cursor + i) % paletteSize;
      chosen = candidate;
      if (!recent.includes(candidate)) {
        break;
      }
    }
    cursor = (chosen + 1) % paletteSize;
    recent.push(chosen);
    if (recent.length > avoidWindow) {
      recent.shift();
    }
    return chosen;
  };
}
