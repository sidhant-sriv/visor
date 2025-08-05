import Parser from "web-tree-sitter";

let parserInitialized = false;
let parserInitPromise: Promise<void> | null = null;

/**
 * Ensures Parser.init() is called only once globally.
 * Multiple calls to this function will return the same promise.
 */
export async function ensureParserInit(): Promise<void> {
  if (parserInitialized) {
    return;
  }

  if (parserInitPromise) {
    return parserInitPromise;
  }

  parserInitPromise = Parser.init().then(() => {
    parserInitialized = true;
    console.log("web-tree-sitter initialized successfully");
  });

  return parserInitPromise;
}
