import type { LanguagePlugin } from '../core/types';
import { typescript } from './typescript';
import { python } from './python';
import { cfamily } from './cfamily';
import { java } from './java';
import { go } from './go';
import { csharp } from './csharp';

/** Add a language: write a plugin, append it here, add its extensions to the host's file glob. */
export const plugins: LanguagePlugin[] = [typescript, python, cfamily, java, go, csharp];

const byExt = new Map<string, LanguagePlugin>();
for (const p of plugins) for (const e of p.extensions) byExt.set(e, p);

export function extOf(path: string): string {
  const i = path.lastIndexOf('.');
  return i < 0 ? '' : path.slice(i).toLowerCase();
}
export function pluginFor(path: string): LanguagePlugin | undefined {
  return byExt.get(extOf(path));
}
export const allExtensions = [...byExt.keys()];
