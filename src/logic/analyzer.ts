import { analyzeTypeScriptCode } from "./language-services/typescript";
import { LocationMapEntry } from "../ir/ir";

/**
 * Orchestrates the analysis of a code string.
 * It creates an in-memory ts-morph project to parse the code.
 */
export function analyzeCode(
  code: string,
  position: number,
  language: string
): {
  flowchart: string;
  locationMap: LocationMapEntry[];
  functionRange?: { start: number; end: number };
} {
  // TODO: Add language selection logic
  if (language === 'typescript' || language === 'javascript') {
    return analyzeTypeScriptCode(code, position);
  }
  
  // Default or unsupported language
  return {
    flowchart: 'graph TD\n    A[Error: Unsupported language]\n    A --> B["' + language + '"]',
    locationMap: []
  };
}
