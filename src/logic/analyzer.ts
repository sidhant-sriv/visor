import { analyzePythonCode } from "./language-services/python";
import { FlowchartIR, LocationMapEntry } from "../ir/ir";
import { MermaidGenerator } from "./MermaidGenerator";

/**
 * Orchestrates the analysis of a code string.
 */
export async function analyzeCode(
  code: string,
  position: number,
  language: string
): Promise<{
  flowchart: string;
  locationMap: LocationMapEntry[];
  functionRange?: { start: number; end: number };
}> {
  let ir: FlowchartIR;

  // Language selection logic
  if (language === "python") {
    ir = await analyzePythonCode(code, position);
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
