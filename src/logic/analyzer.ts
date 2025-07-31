import { analyzePythonCode } from "./language-services/python";
import { LocationMapEntry } from "../ir/ir";

/**
 * Orchestrates the analysis of a code string.
 */
export async function analyzeCode(
  code: string,
  position: number,
  language: string
): Promise<{
  flowchart: string;
  locationMap: LocationMapEntry[];
  functionRange?: { start: number; end: number };
}> {
  // Language selection logic
  
  if (language === 'python') {
    return await analyzePythonCode(code, position);
  }
  
  // Default or unsupported language
  return {
    flowchart: 'graph TD\n    A[Error: Unsupported language]\n    A --> B["' + language + '"]',
    locationMap: []
  };
}
