import { analyzeTypeScriptCode } from "./language-services/typescript";
import { analyzePythonCode } from "./language-services/python";
import { analyzeJavaCode } from "./language-services/java";
import { analyzeCppCode } from "./language-services/cpp/index";
import { FlowchartIR, LocationMapEntry } from "../ir/ir";
import { MermaidGenerator } from "./MermaidGenerator";

/**
 * Orchestrates the analysis of a code string.
 */
export function analyzeCode(
  code: string,
  position: number,
  language: string
): {
  flowchart: string;
  locationMap: LocationMapEntry[];
  functionRange?: { start: number; end: number };
} {
  let ir: FlowchartIR;

  // Language selection logic
  if (language === "typescript" || language === "javascript") {
    ir = analyzeTypeScriptCode(code, position);
  } else if (language === "python") {
    ir = analyzePythonCode(code, position);
  } else if (language === "java") {
    ir = analyzeJavaCode(code, position);
  } else if (language === "cpp" || language === "c++") {
    ir = analyzeCppCode(code, undefined, position);
  } else {
    // Default or unsupported language
    ir = {
      nodes: [
        {
          id: "A",
          label: `Error: Unsupported language: ${language}`,
          shape: "rect",
        },
      ],
      edges: [],
      locationMap: [],
    };
  }

  const mermaidGenerator = new MermaidGenerator();
  const flowchart = mermaidGenerator.generate(ir);

  return {
    flowchart,
    locationMap: ir.locationMap,
    functionRange: ir.functionRange,
  };
}
