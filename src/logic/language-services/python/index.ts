import { PyAstParser } from "./PyAstParser";
import { MermaidGenerator } from "../../MermaidGenerator";
import { FlowchartIR, LocationMapEntry } from "../../../ir/ir";

/**
 * Orchestrates the analysis of a Python code string.
 * It uses tree-sitter to parse the code and find functions.
 */
export function analyzePythonCode(
  code: string,
  position: number
): {
  flowchart: string;
  locationMap: LocationMapEntry[];
  functionRange?: { start: number; end: number };
} {
  try {
    const parser = new PyAstParser();
    const ir = parser.generateFlowchart(code, undefined, position);

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