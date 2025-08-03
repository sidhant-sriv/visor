import * as vscode from "vscode";
import { FlowchartIR } from "../ir/ir";
import { analyzePythonCode } from "./language-services/python";
import { analyzeTypeScriptCode } from "./language-services/typescript";
import { analyzeJavaCode } from "./language-services/java";
import { analyzeCppCode } from "./language-services/cpp";

/**
 * Analyzes the given source code and generates a flowchart.
 * @param sourceCode - The source code to analyze.
 * @param languageId - The language identifier (e.g., 'python', 'typescript', etc.).
 * @param functionName - Optional function name to analyze specifically.
 * @param position - Optional position in the source code to analyze.
 * @returns A FlowchartIR representation of the code.
 */
export async function analyzeCode(
  sourceCode: string,
  languageId: string,
  functionName?: string,
  position?: number
): Promise<FlowchartIR> {
  switch (languageId) {
    case "python":
      return await analyzePythonCode(sourceCode, position || 0);
    case "typescript":
    case "javascript":
      return await analyzeTypeScriptCode(sourceCode, position || 0);
    case "java":
      return await analyzeJavaCode(sourceCode, position || 0);
    case "cpp":
    case "c":
      return analyzeCppCode(sourceCode, functionName, position);
    default:
      throw new Error(`Unsupported language: ${languageId}`);
  }
}
