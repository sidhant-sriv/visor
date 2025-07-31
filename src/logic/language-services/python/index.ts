import { PyAstParser } from "./PyAstParser";
import { MermaidGenerator } from "../../MermaidGenerator";
import { FlowchartIR, LocationMapEntry } from "../../../ir/ir";

let parserPromise: Promise<PyAstParser> | null = null;

/**
 * Initializes the Python language service by creating the parser instance.
 * This must be called once at extension activation.
 * @param wasmPath The absolute file path to the tree-sitter-python.wasm file.
 */
export function initPythonLanguageService(wasmPath: string) {
  parserPromise = PyAstParser.create(wasmPath);
}

/**
 * Orchestrates the analysis of a Python code string.
 * It uses web-tree-sitter to parse the code and find functions.
 */
export async function analyzePythonCode(
  code: string,
  position: number
): Promise<{
  flowchart: string;
  locationMap: LocationMapEntry[];
  functionRange?: { start: number; end: number };
}> {
  if (!parserPromise) {
    throw new Error("Python language service has not been initialized. Call initPythonLanguageService() first.");
  }

  try {
    const parser = await parserPromise;
    const ir = await parser.generateFlowchart(code, undefined, position);

    const mermaidGenerator = new MermaidGenerator();
    const flowchart = mermaidGenerator.generate(ir);

    return { flowchart, locationMap: ir.locationMap, functionRange: ir.functionRange };
  } catch (error: any) {
    console.error("Error analyzing Python code:", error);
    const errorMessage = `graph TD\n    A[Error: Unable to parse code]\n    A --> B["${
      error.message || error
    }"]`;
    return { flowchart: errorMessage, locationMap: [] };
  }
}
