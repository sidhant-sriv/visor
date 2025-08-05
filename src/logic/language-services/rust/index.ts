import { RustAstParser } from "./RustAstParser";
import { FlowchartIR } from "../../../ir/ir";

let rustParser: RustAstParser | null = null;

export async function initRustLanguageService(wasmPath: string): Promise<void> {
  try {
    rustParser = await RustAstParser.create(wasmPath);
    console.log("Rust language service initialized successfully");
  } catch (error) {
    console.error("Failed to initialize Rust language service:", error);
    throw error;
  }
}

export function analyzeRustCode(
  sourceCode: string,
  functionName?: string,
  position?: number
): FlowchartIR {
  if (!rustParser) {
    throw new Error(
      "Rust language service not initialized. Call initRustLanguageService first."
    );
  }

  return rustParser.generateFlowchart(sourceCode, functionName, position);
}

export function listRustFunctions(sourceCode: string): string[] {
  if (!rustParser) {
    throw new Error(
      "Rust language service not initialized. Call initRustLanguageService first."
    );
  }

  return rustParser.listFunctions(sourceCode);
}

export function findRustFunctionAtPosition(
  sourceCode: string,
  position: number
): string | undefined {
  if (!rustParser) {
    throw new Error(
      "Rust language service not initialized. Call initRustLanguageService first."
    );
  }

  return rustParser.findFunctionAtPosition(sourceCode, position);
}
