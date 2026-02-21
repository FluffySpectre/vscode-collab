import { minimatch } from "minimatch";

export function isIgnoredByPatterns(relativePath: string, patterns: string[]): boolean {
  return patterns.some((p) => minimatch(relativePath, p, { dot: true }));
}
