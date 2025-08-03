import { CppAstParser } from "./CppAstParser";
import { FlowchartIR } from "../../../ir/ir";

let cppParser: CppAstParser | null = null;

export async function initCppLanguageService(wasmPath: string): Promise<void> {
  try {
    cppParser = await CppAstParser.create(wasmPath);
    console.log("C++ language service initialized successfully");
  } catch (error) {
    console.error("Failed to initialize C++ language service:", error);
    throw error;
  }
}

export function analyzeCppCode(
  sourceCode: string,
  functionName?: string,
  position?: number
): FlowchartIR {
  if (!cppParser) {
    throw new Error(
      "C++ language service not initialized. Call initCppLanguageService first."
    );
  }

  return cppParser.generateFlowchart(sourceCode, functionName, position);
}

export function listCppFunctions(sourceCode: string): string[] {
  if (!cppParser) {
    throw new Error(
      "C++ language service not initialized. Call initCppLanguageService first."
    );
  }

  return cppParser.listFunctions(sourceCode);
}

export function findCppFunctionAtPosition(
  sourceCode: string,
  position: number
): string | undefined {
  if (!cppParser) {
    throw new Error(
      "C++ language service not initialized. Call initCppLanguageService first."
    );
  }

  return cppParser.findFunctionAtPosition(sourceCode, position);
}
