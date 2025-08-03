import { PyAstParser } from "./PyAstParser";
import { FlowchartIR } from "../../../ir/ir";

let parserPromise: Promise<PyAstParser> | null = null;

/**
 * Initializes the Python language service.
 * @param wasmPath The absolute path to the tree-sitter-python.wasm file.
 */
export function initPythonLanguageService(wasmPath: string) {
  parserPromise = PyAstParser.create(wasmPath);
}

/**
 * Analyzes Python code.
 */
export async function analyzePythonCode(
  code: string,
  position: number
): Promise<FlowchartIR> {
  if (!parserPromise) {
    throw new Error("Python language service not initialized.");
  }
  const parser = await parserPromise;
  return parser.generateFlowchart(code, undefined, position);
}
