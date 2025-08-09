import { GoAstParser } from "./GoAstParser";
import { FlowchartIR } from "../../../ir/ir";

let goParser: GoAstParser | null = null;

export async function initGoLanguageService(wasmPath: string): Promise<void> {
  try {
    goParser = await GoAstParser.create(wasmPath);
    console.log("Go language service initialized successfully");
  } catch (error) {
    console.error("Failed to initialize Go language service:", error);
    throw error;
  }
}

export function analyzeGoCode(
  sourceCode: string,
  functionName?: string,
  position?: number
): FlowchartIR {
  if (!goParser) {
    throw new Error(
      "Go language service not initialized. Call initGoLanguageService first."
    );
  }

  return goParser.generateFlowchart(sourceCode, functionName, position);
}

export function listGoFunctions(sourceCode: string): string[] {
  if (!goParser) {
    throw new Error(
      "Go language service not initialized. Call initGoLanguageService first."
    );
  }
  return goParser.listFunctions(sourceCode);
}

export { GoAstParser };

