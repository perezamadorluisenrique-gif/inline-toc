/** Index of the last heading at or above `topLine`, or -1 before the first one. `lines` is sorted. */
export function activeIndex(lines: number[], topLine: number): number {
  let lo = 0;
  let hi = lines.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid] <= topLine) {
      best = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return best;
}
