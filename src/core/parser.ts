import { Parser, Language } from 'web-tree-sitter';
import type { Tree } from 'web-tree-sitter';
import * as path from 'path';

/** Loads tree-sitter WASM grammars on demand and parses text with them. */
export class ParserService {
  private langs = new Map<string, Promise<Language>>();
  private parser!: Parser;
  private ready: Promise<void>;
  private parseQueue: Promise<any> = Promise.resolve();

  /** `wasmDir` must contain tree-sitter.wasm plus a grammars/ folder of tree-sitter-*.wasm. */
  constructor(private wasmDir: string) {
    this.ready = Parser.init({
      locateFile: (name: string) => path.join(wasmDir, name),
    }).then(() => {
      this.parser = new Parser();
    });
  }

  private language(grammar: string): Promise<Language> {
    let p = this.langs.get(grammar);
    if (!p) {
      p = Language.load(path.join(this.wasmDir, 'grammars', `${grammar}.wasm`));
      this.langs.set(grammar, p);
    }
    return p;
  }

  async parse(text: string, grammar: string): Promise<Tree> {
    const task = async () => {
      await this.ready;
      const lang = await this.language(grammar);
      this.parser.setLanguage(lang);
      const tree = this.parser.parse(text);
      if (!tree) throw new Error(`parse failed for grammar ${grammar}`);
      return tree;
    };
    const p = this.parseQueue.then(task, task);
    this.parseQueue = p;
    return p;
  }
}
