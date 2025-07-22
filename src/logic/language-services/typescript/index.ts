import { Project, ScriptTarget, SourceFile } from "ts-morph";
import { TsAstParser } from "./TsAstParser";
import { MermaidGenerator } from "../../MermaidGenerator";
import { FlowchartIR, LocationMapEntry } from "../../../ir/ir";

// Project pool for reuse
class ProjectPool {
  private static instance: ProjectPool;
  private projects: Project[] = [];
  private maxPoolSize = 3;

  static getInstance(): ProjectPool {
    if (!ProjectPool.instance) {
      ProjectPool.instance = new ProjectPool();
    }
    return ProjectPool.instance;
  }

  getProject(): Project {
    if (this.projects.length > 0) {
      return this.projects.pop()!;
    }
    
    return new Project({
      useInMemoryFileSystem: true,
      compilerOptions: {
        target: ScriptTarget.ESNext,
        allowJs: true,
      },
    });
  }

  releaseProject(project: Project): void {
    if (this.projects.length < this.maxPoolSize) {
      // Clear all files from project before reuse
      project.getSourceFiles().forEach(sf => sf.forget());
      this.projects.push(project);
    }
  }
}

/**
 * Orchestrates the analysis of a TypeScript code string.
 * Uses project pooling for better memory efficiency.
 */
export function analyzeTypeScriptCode(
  code: string,
  position: number
): {
  flowchart: string;
  locationMap: LocationMapEntry[];
  functionRange?: { start: number; end: number };
} {
  const projectPool = ProjectPool.getInstance();
  const project = projectPool.getProject();

  try {
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
  } finally {
    projectPool.releaseProject(project);
  }
} 