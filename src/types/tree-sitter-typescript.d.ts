declare module "web-tree-sitter" {
  namespace Parser {
    interface Language {
      load(input: string | Uint8Array | ArrayBuffer): Promise<Language>;
    }
  }
}
