import * as path from "path";
import { ModuleInfo, ImportInfo, ExportInfo, FunctionCallInfo, ModuleLocation } from "../../../ir/moduleIr";

/**
 * Analyzes Java module structure to extract imports, exports (public methods/classes), and function calls
 */
export async function analyzeJavaModule(code: string, filePath: string): Promise<ModuleInfo> {
  const fileName = path.basename(filePath);
  const imports: ImportInfo[] = [];
  const exports: ExportInfo[] = [];
  const functionCalls: FunctionCallInfo[] = [];
  const functions: string[] = [];
  const classes: string[] = [];
  const variables: string[] = [];

  const lines = code.split('\n');
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const location: ModuleLocation = { start: 0, end: line.length, line: i + 1, column: 0 };

    // Parse imports
    if (line.startsWith('import ')) {
      const match = line.match(/^import\s+(?:static\s+)?([a-zA-Z_][a-zA-Z0-9_.]*(?:\.\*)?);?/);
      if (match) {
        const importPath = match[1];
        const parts = importPath.split('.');
        const name = parts[parts.length - 1];
        
        imports.push({
          name: name === '*' ? parts[parts.length - 2] : name,
          source: importPath,
          type: name === '*' ? 'all' : 'named',
          location
        });
      }
    }

    // Parse public class definitions
    if (line.includes('class ')) {
      const match = line.match(/(?:public\s+)?class\s+([a-zA-Z_][a-zA-Z0-9_]*)/);
      if (match) {
        const className = match[1];
        classes.push(className);
        
        // Public classes are exportable
        if (line.includes('public ')) {
          exports.push({
            name: className,
            type: 'class',
            location
          });
        }
      }
    }

    // Parse method definitions
    if (line.includes('(') && line.includes(')') && 
        (line.includes('public ') || line.includes('private ') || line.includes('protected '))) {
      // Simple regex to match method signatures
      const match = line.match(/(?:public|private|protected)\s+(?:static\s+)?(?:[a-zA-Z_][a-zA-Z0-9_<>[\]]*\s+)?([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/);
      if (match) {
        const methodName = match[1];
        
        // Exclude constructors (methods with same name as class)
        const isConstructor = classes.some(className => className === methodName);
        if (!isConstructor && !isJavaKeyword(methodName)) {
          functions.push(methodName);
          
          // Public methods are exportable
          if (line.includes('public ')) {
            exports.push({
              name: methodName,
              type: 'function',
              location
            });
          }
        }
      }
    }

    // Parse field definitions
    if ((line.includes('public ') || line.includes('private ') || line.includes('protected ')) && 
        line.includes('=') && !line.includes('(')) {
      const match = line.match(/(?:public|private|protected)\s+(?:static\s+)?(?:final\s+)?[a-zA-Z_][a-zA-Z0-9_<>[\]]*\s+([a-zA-Z_][a-zA-Z0-9_]*)/);
      if (match) {
        const fieldName = match[1];
        variables.push(fieldName);
        
        // Public fields are exportable
        if (line.includes('public ')) {
          exports.push({
            name: fieldName,
            type: 'variable',
            location
          });
        }
      }
    }

    // Parse method calls
    const funcCallMatches = line.matchAll(/([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g);
    for (const match of funcCallMatches) {
      const callName = match[1];
      
      if (!isJavaKeyword(callName) && !isBuiltinMethod(callName) && 
          !line.includes(' class ') && !line.includes('public ') && !line.includes('private ')) {
        let module: string | undefined;
        
        // Check for static method calls (ClassName.methodName)
        const staticCallMatch = line.match(/([a-zA-Z_][a-zA-Z0-9_]*)\\.([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/);
        if (staticCallMatch) {
          const className = staticCallMatch[1];
          const methodName = staticCallMatch[2];
          
          // Check if this class was imported
          const importedClass = imports.find(imp => imp.name === className);
          if (importedClass) {
            module = importedClass.source;
          }
          
          functionCalls.push({
            functionName: `${className}.${methodName}`,
            module,
            location
          });
        } else {
          functionCalls.push({
            functionName: callName,
            module,
            location
          });
        }
      }
    }
  }

  return {
    filePath,
    fileName,
    language: 'java',
    imports,
    exports,
    functionCalls,
    functions,
    classes,
    variables
  };
}

function isJavaKeyword(name: string): boolean {
  const keywords = [
    'abstract', 'assert', 'boolean', 'break', 'byte', 'case', 'catch', 'char',
    'class', 'const', 'continue', 'default', 'do', 'double', 'else', 'enum',
    'extends', 'final', 'finally', 'float', 'for', 'goto', 'if', 'implements',
    'import', 'instanceof', 'int', 'interface', 'long', 'native', 'new',
    'package', 'private', 'protected', 'public', 'return', 'short', 'static',
    'strictfp', 'super', 'switch', 'synchronized', 'this', 'throw', 'throws',
    'transient', 'try', 'void', 'volatile', 'while'
  ];
  
  return keywords.includes(name);
}

function isBuiltinMethod(name: string): boolean {
  const builtins = [
    'println', 'print', 'toString', 'equals', 'hashCode', 'getClass',
    'notify', 'notifyAll', 'wait', 'finalize', 'clone', 'length', 'size',
    'isEmpty', 'contains', 'add', 'remove', 'clear', 'get', 'set', 'put'
  ];
  
  return builtins.includes(name);
}