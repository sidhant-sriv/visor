import * as path from "path";
import { ModuleInfo, ImportInfo, ExportInfo, FunctionCallInfo, ModuleLocation } from "../../../ir/moduleIr";

/**
 * Analyzes TypeScript/JavaScript module structure to extract imports, exports, and function calls
 */
export async function analyzeTypeScriptModule(code: string, filePath: string, language: string): Promise<ModuleInfo> {
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

    // Parse ES6 imports
    if (line.startsWith('import ')) {
      parseESImport(line, imports, location);
    }

    // Parse CommonJS require
    if (line.includes('require(')) {
      parseCommonJSImport(line, imports, location);
    }

    // Parse exports
    if (line.startsWith('export ')) {
      parseExport(line, exports, location);
    }

    // Parse function definitions
    if (line.includes('function ')) {
      const match = line.match(/function\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/);
      if (match) {
        const funcName = match[1];
        functions.push(funcName);
        
        if (line.startsWith('export ')) {
          exports.push({
            name: funcName,
            type: 'function',
            location
          });
        }
      }
    }

    // Parse arrow functions
    const arrowFunctionMatch = line.match(/(?:const|let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*\(/);
    if (arrowFunctionMatch && line.includes('=>')) {
      const funcName = arrowFunctionMatch[1];
      functions.push(funcName);
      
      if (line.startsWith('export ')) {
        exports.push({
          name: funcName,
          type: 'function',
          location
        });
      }
    }

    // Parse class definitions
    if (line.includes('class ')) {
      const match = line.match(/class\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/);
      if (match) {
        const className = match[1];
        classes.push(className);
        
        if (line.startsWith('export ')) {
          exports.push({
            name: className,
            type: 'class',
            location
          });
        }
      }
    }

    // Parse variable declarations
    const varMatch = line.match(/(?:const|let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/);
    if (varMatch && !line.includes('=>')) {
      const varName = varMatch[1];
      variables.push(varName);
      
      if (line.startsWith('export ')) {
        exports.push({
          name: varName,
          type: 'variable',
          location
        });
      }
    }

    // Parse function calls
    const funcCallMatches = line.matchAll(/([a-zA-Z_$][a-zA-Z0-9_$.]*)\s*\(/g);
    for (const match of funcCallMatches) {
      const callName = match[1];
      
      if (!isBuiltinFunction(callName) && !line.startsWith('function ') && !line.startsWith('class ')) {
        let module: string | undefined;
        
        // Check if it's a module.function call
        if (callName.includes('.')) {
          const parts = callName.split('.');
          const potentialModule = parts[0];
          
          // Check if this module was imported
          const importedModule = imports.find(imp => imp.name === potentialModule || imp.alias === potentialModule);
          if (importedModule) {
            module = importedModule.source;
          }
        }
        
        functionCalls.push({
          functionName: callName,
          module,
          location
        });
      }
    }
  }

  return {
    filePath,
    fileName,
    language,
    imports,
    exports,
    functionCalls,
    functions,
    classes,
    variables
  };
}

function parseESImport(line: string, imports: ImportInfo[], location: ModuleLocation) {
  // Default import: import React from 'react'
  let match = line.match(/^import\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s+from\s+['"`]([^'"`]+)['"`]/);
  if (match) {
    imports.push({
      name: match[1],
      source: match[2],
      type: 'default',
      location
    });
    return;
  }

  // Named imports: import { a, b as c } from 'module'
  match = line.match(/^import\s+\{\s*([^}]+)\s*\}\s+from\s+['"`]([^'"`]+)['"`]/);
  if (match) {
    const namedImports = match[1].split(',').map(i => i.trim());
    for (const namedImport of namedImports) {
      const parts = namedImport.split(' as ').map(p => p.trim());
      imports.push({
        name: parts.length > 1 ? parts[1] : parts[0],
        source: match[2],
        type: 'named',
        alias: parts.length > 1 ? parts[1] : undefined,
        location
      });
    }
    return;
  }

  // Namespace import: import * as fs from 'fs'
  match = line.match(/^import\s+\*\s+as\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s+from\s+['"`]([^'"`]+)['"`]/);
  if (match) {
    imports.push({
      name: match[1],
      source: match[2],
      type: 'namespace',
      location
    });
    return;
  }

  // Side-effect import: import 'module'
  match = line.match(/^import\s+['"`]([^'"`]+)['"`]/);
  if (match) {
    imports.push({
      name: '*',
      source: match[1],
      type: 'all',
      location
    });
  }
}

function parseCommonJSImport(line: string, imports: ImportInfo[], location: ModuleLocation) {
  // const fs = require('fs')
  const match = line.match(/(?:const|let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*require\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/);
  if (match) {
    imports.push({
      name: match[1],
      source: match[2],
      type: 'namespace',
      location
    });
  }
}

function parseExport(line: string, exports: ExportInfo[], location: ModuleLocation) {
  // export default
  if (line.includes('export default')) {
    const match = line.match(/export\s+default\s+(?:function\s+)?([a-zA-Z_$][a-zA-Z0-9_$]*)/);
    if (match) {
      exports.push({
        name: match[1],
        type: 'default',
        location
      });
    }
    return;
  }

  // export { a, b }
  const namedMatch = line.match(/export\s+\{\s*([^}]+)\s*\}/);
  if (namedMatch) {
    const exportNames = namedMatch[1].split(',').map(e => e.trim());
    for (const exportName of exportNames) {
      exports.push({
        name: exportName,
        type: 'variable',
        location
      });
    }
  }
}

function isBuiltinFunction(name: string): boolean {
  const builtins = [
    'console', 'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'decodeURI',
    'decodeURIComponent', 'encodeURI', 'encodeURIComponent', 'escape', 'unescape',
    'Object', 'Array', 'String', 'Number', 'Boolean', 'Date', 'RegExp',
    'Error', 'EvalError', 'RangeError', 'ReferenceError', 'SyntaxError',
    'TypeError', 'URIError', 'JSON', 'Math', 'Promise', 'setTimeout',
    'clearTimeout', 'setInterval', 'clearInterval'
  ];
  
  const simpleName = name.split('.')[0];
  return builtins.includes(simpleName);
}