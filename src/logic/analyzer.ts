import { Project, ScriptTarget } from "ts-morph";
import { TsAstParser } from "./TsAstParser";
import { MermaidGenerator } from "./MermaidGenerator";
import { FlowchartIR, LocationMapEntry } from "../ir/ir";

/**
 * Orchestrates the analysis of a TypeScript code string.
 * It creates an in-memory ts-morph project to parse the code.
 */
export function analyzeTypeScriptCode(
  code: string,
  position: number
): {
  flowchart: string;
  locationMap: LocationMapEntry[];
  functionRange?: { start: number; end: number };
} {
  try {
    const project = new Project({
      useInMemoryFileSystem: true,
      compilerOptions: {
        target: ScriptTarget.ESNext,
        allowJs: true,
      },
    });

    const sourceFile = project.createSourceFile("temp.ts", code);
    const parser = new TsAstParser();
    const ir = parser.generateFlowchart(sourceFile, position);

    const mermaidGenerator = new MermaidGenerator();
    const flowchart = mermaidGenerator.generate(ir);

    return { flowchart, locationMap: ir.locationMap, functionRange: ir.functionRange };
  } catch (error: any) {
    console.error("Error analyzing TypeScript code:", error);
    const errorMessage = `graph TD\n    A[Error: Unable to parse code]\n    A --> B["${
      error.message || error
    }"]`;
    return { flowchart: errorMessage, locationMap: [] };
  }
}
