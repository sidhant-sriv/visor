import { TsAstParserTreeSitter } from "./TsAstParserTreeSitter";
import { FlowchartIR } from "../../../ir/ir";

/**
 * Orchestrates the analysis of a TypeScript code string.
 * Now uses Tree-sitter instead of ts-morph for better performance and simpler API.
 */
export function analyzeTypeScriptCode(
  code: string,
  position: number
): FlowchartIR {
  try {
    const parser = new TsAstParserTreeSitter();
    return parser.generateFlowchart(code, undefined, position);
  } catch (error: any) {
    console.error("Error analyzing TypeScript code:", error);
    return {
      nodes: [
        {
          id: "A",
          label: `Error: Unable to parse code. ${error.message || error}`,
          shape: "rect",
        },
      ],
      edges: [],
      locationMap: [],
    };
  }
}
