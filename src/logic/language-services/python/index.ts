import { PyAstParser } from "./PyAstParser";
import { FlowchartIR } from "../../../ir/ir";

/**
 * Orchestrates the analysis of a Python code string.
 * It uses tree-sitter to parse the code and find functions.
 */
export function analyzePythonCode(
  code: string,
  position: number
): FlowchartIR {
  try {
    const parser = new PyAstParser();
    return parser.generateFlowchart(code, undefined, position);
  } catch (error: any) {
    console.error("Error analyzing Python code:", error);
    return { 
      nodes: [{ id: 'A', label: `Error: Unable to parse code. ${error.message || error}`, shape: 'rect' }],
      edges: [],
      locationMap: []
    };
  }
} 