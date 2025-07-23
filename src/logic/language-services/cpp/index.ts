import { CppAstParser } from "./CppAstParser";
import { FlowchartIR } from "../../../ir/ir";

export function analyzeCppCode(
  sourceCode: string,
  functionName?: string,
  position?: number
): FlowchartIR {
  const parser = new CppAstParser();
  return parser.generateFlowchart(sourceCode, functionName, position);
}

export function listCppFunctions(sourceCode: string): string[] {
  const parser = new CppAstParser();
  return parser.listFunctions(sourceCode);
}

export function findCppFunctionAtPosition(
  sourceCode: string,
  position: number
): string | undefined {
  const parser = new CppAstParser();
  return parser.findFunctionAtPosition(sourceCode, position);
}
