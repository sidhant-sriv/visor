import * as path from "path";
import {
  ModuleInfo,
  ImportInfo,
  ExportInfo,
  FunctionCallInfo,
  ModuleLocation,
} from "../../../ir/moduleIr";

/**
 * Analyzes Python module structure to extract imports, exports, and function calls
 */
export async function analyzePythonModule(
  code: string,
  filePath: string
): Promise<ModuleInfo> {
  const fileName = path.basename(filePath);
  const imports: ImportInfo[] = [];
  const exports: ExportInfo[] = [];
  const functionCalls: FunctionCallInfo[] = [];
  const functions: string[] = [];
  const classes: string[] = [];
  const variables: string[] = [];

  const lines = code.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const location: ModuleLocation = {
      start: 0,
      end: line.length,
      line: i + 1,
      column: 0,
    };

    // Parse imports
    if (line.startsWith("import ")) {
      const match = line.match(/^import\s+(.+)/);
      if (match) {
        const modules = match[1].split(",").map((m) => m.trim());
        for (const module of modules) {
          const parts = module.split(" as ");
          imports.push({
            name: parts.length > 1 ? parts[1] : parts[0],
            source: parts[0],
            type: "namespace",
            alias: parts.length > 1 ? parts[1] : undefined,
            location,
          });
        }
      }
    }

    // Parse from imports
    if (line.startsWith("from ")) {
      const match = line.match(/^from\s+(.+?)\s+import\s+(.+)/);
      if (match) {
        const source = match[1];
        const imports_str = match[2];

        if (imports_str.includes("*")) {
          imports.push({
            name: "*",
            source,
            type: "all",
            location,
          });
        } else {
          const importNames = imports_str.split(",").map((i) => i.trim());
          for (const importName of importNames) {
            const parts = importName.split(" as ");
            imports.push({
              name: parts.length > 1 ? parts[1] : parts[0],
              source,
              type: "named",
              alias: parts.length > 1 ? parts[1] : undefined,
              location,
            });
          }
        }
      }
    }

    // Parse function definitions
    if (line.startsWith("def ")) {
      const match = line.match(/^def\s+([a-zA-Z_][a-zA-Z0-9_]*)/);
      if (match) {
        const funcName = match[1];
        functions.push(funcName);

        // Functions are exportable in Python (unless they start with _)
        if (!funcName.startsWith("_")) {
          exports.push({
            name: funcName,
            type: "function",
            location,
          });
        }
      }
    }

    // Parse class definitions
    if (line.startsWith("class ")) {
      const match = line.match(/^class\s+([a-zA-Z_][a-zA-Z0-9_]*)/);
      if (match) {
        const className = match[1];
        classes.push(className);

        // Classes are exportable in Python (unless they start with _)
        if (!className.startsWith("_")) {
          exports.push({
            name: className,
            type: "class",
            location,
          });
        }
      }
    }

    // Parse variable assignments (top-level only)
    if (
      line.includes("=") &&
      !line.includes("==") &&
      !line.includes("!=") &&
      !line.includes("<=") &&
      !line.includes(">=") &&
      line.indexOf("=") > 0 &&
      !line.trim().startsWith("#")
    ) {
      const match = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*=/);
      if (match) {
        const varName = match[1];
        variables.push(varName);

        // Top-level variables are exportable (unless they start with _)
        if (!varName.startsWith("_")) {
          exports.push({
            name: varName,
            type: "variable",
            location,
          });
        }
      }
    }

    // Parse function calls with better module detection
    const funcCallRegex = /([a-zA-Z_][a-zA-Z0-9_.]*)\s*\(/g;
    let match;
    while ((match = funcCallRegex.exec(line)) !== null) {
      const callName = match[1];

      // Skip built-in functions and method definitions
      if (
        !isBuiltinFunction(callName) &&
        !line.startsWith("def ") &&
        !line.startsWith("class ") &&
        !line.includes("#") // Skip comments
      ) {
        let module: string | undefined;
        let functionName = callName;

        // Check if it's a module.function call (e.g., math.sqrt)
        if (callName.includes(".")) {
          const parts = callName.split(".");
          const potentialModule = parts[0];
          functionName = parts.slice(1).join(".");

          // Check if this module was imported
          const importedModule = imports.find(
            (imp) =>
              imp.name === potentialModule || imp.alias === potentialModule
          );
          if (importedModule) {
            module = importedModule.source;
          }
        } else {
          // Check if it's a directly imported function (e.g., calculate_average from utils)
          const directImport = imports.find(
            (imp) => imp.name === callName && imp.type === "named"
          );
          if (directImport) {
            module = directImport.source;
          }
        }

        functionCalls.push({
          functionName,
          module,
          location,
        });
      }
    }
  }

  const moduleInfo: ModuleInfo = {
    filePath,
    fileName,
    language: "python",
    imports,
    exports,
    functionCalls,
    functions,
    classes,
    variables,
  };

  console.log(`[PyModuleParser] Analysis complete for ${fileName}:`, {
    imports: imports.map((i) => `${i.name} from ${i.source} (${i.type})`),
    exports: exports.map((e) => `${e.name} (${e.type})`),
    functionCalls: functionCalls.map(
      (f) => `${f.functionName}${f.module ? ` from ${f.module}` : ""}`
    ),
  });

  return moduleInfo;
}

function isBuiltinFunction(name: string): boolean {
  const builtins = [
    "print",
    "len",
    "str",
    "int",
    "float",
    "list",
    "dict",
    "tuple",
    "set",
    "range",
    "enumerate",
    "zip",
    "map",
    "filter",
    "sum",
    "max",
    "min",
    "abs",
    "round",
    "sorted",
    "reversed",
    "open",
    "input",
    "type",
    "isinstance",
    "hasattr",
    "getattr",
    "setattr",
    "delattr",
  ];

  const simpleName = name.split(".")[0];
  return builtins.includes(simpleName);
}
