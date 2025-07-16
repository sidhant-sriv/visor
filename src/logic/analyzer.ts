import { Project, ScriptTarget } from "ts-morph";
import { FlowchartGenerator, LocationMapEntry } from "./FlowchartGenerator";

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
    const generator = new FlowchartGenerator();
    return generator.generateFlowchart(sourceFile, position);
  } catch (error: any) {
    console.error("Error analyzing TypeScript code:", error);
    const errorMessage = `graph TD\n    A[Error: Unable to parse code]\n    A --> B["${
      error.message || error
    }"]`;
    return { flowchart: errorMessage, locationMap: [] };
  }
}
