import * as path from 'path';

export const posix = path.posix;

export function toPosix(p: string): string {
  return p.replace(/\\/g, '/');
}

export function unquote(s: string): string {
  const t = s.trim();
  if (t.length >= 2 && /["'`]/.test(t[0]) && t[t.length - 1] === t[0]) return t.slice(1, -1);
  return t;
}

/** Strip // and block comments (good enough for config text we regex over). */
export function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
}

/** Length of the shared leading directory path of two files. */
export function sharedPrefixLen(a: string, b: string): number {
  const pa = a.split('/');
  const pb = b.split('/');
  let i = 0;
  while (i < pa.length - 1 && i < pb.length - 1 && pa[i] === pb[i]) i++;
  return i;
}

/**
 * Files whose path ends with `/${suffix}`. If several match, keep the one closest to `from`.
 * Returns [] when nothing matches.
 */
export function suffixMatch(
  suffix: string,
  from: string,
  filesByBase: ReadonlyMap<string, string[]>
): string[] {
  const base = suffix.slice(suffix.lastIndexOf('/') + 1);
  const hits = (filesByBase.get(base) ?? []).filter((f) => f === suffix || f.endsWith('/' + suffix));
  if (hits.length <= 1) return hits;
  hits.sort((x, y) => sharedPrefixLen(y, from) - sharedPrefixLen(x, from));
  return [hits[0]];
}
