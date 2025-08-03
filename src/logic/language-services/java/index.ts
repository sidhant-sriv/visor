import { JavaAstParser } from "./JavaAstParser";
import { FlowchartIR } from "../../../ir/ir";

let parserPromise: Promise<JavaAstParser> | null = null;

/**
 * Initializes the Java language service.
 * @param wasmPath The absolute path to the tree-sitter-java.wasm file.
 */
export function initJavaLanguageService(wasmPath: string) {
  parserPromise = JavaAstParser.create(wasmPath);
}

/**
 * Analyzes Java code.
 */
export async function analyzeJavaCode(
  code: string,
  position: number
): Promise<FlowchartIR> {
  if (!parserPromise) {
    throw new Error("Java language service not initialized.");
  }
  const parser = await parserPromise;
  return parser.generateFlowchart(code, undefined, position);
}

export { JavaAstParser };
