import { CAstParser } from "./CAstParser";
import { FlowchartIR } from "../../../ir/ir";

let cParser: CAstParser | null = null;

export async function initCLanguageService(wasmPath: string): Promise<void> {
  try {
    cParser = await CAstParser.create(wasmPath);
    console.log("C language service initialized successfully");
  } catch (error) {
    console.error("Failed to initialize C language service:", error);
    throw error;
  }
}

export function analyzeCCode(
  sourceCode: string,
  functionName?: string,
  position?: number
): FlowchartIR {
  if (!cParser) {
    throw new Error(
      "C language service not initialized. Call initCLanguageService first."
    );
  }

  return cParser.generateFlowchart(sourceCode, functionName, position);
}

export function listCFunctions(sourceCode: string): string[] {
  if (!cParser) {
    throw new Error(
      "C language service not initialized. Call initCLanguageService first."
    );
  }

  return cParser.listFunctions(sourceCode);
}

export function findCFunctionAtPosition(
  sourceCode: string,
  position: number
): string | undefined {
  if (!cParser) {
    throw new Error(
      "C language service not initialized. Call initCLanguageService first."
    );
  }

  return cParser.findFunctionAtPosition(sourceCode, position);
}
