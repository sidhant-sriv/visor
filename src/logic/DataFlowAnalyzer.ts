import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { DataFlowAnalysisIR, FunctionInfo, GlobalStateVariable, DataFlowEdge, DataFlowLocation, GlobalStateAccess, FunctionCallInfo, DataFlowValue } from "../ir/dataFlowIr";

export class DataFlowAnalyzer {
  private workspaceRoot: string;

  constructor() {
    this.workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || "";
  }

  /**
   * Analyze data flow starting from the current function context
   */
  public async analyzeCurrentFunctionContext(): Promise<DataFlowAnalysisIR> {
    console.log("DataFlowAnalyzer: Starting current function context analysis");
    
    const activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor) {
      console.error("DataFlowAnalyzer: No active editor found");
      throw new Error("No active editor found");
    }

    console.log("DataFlowAnalyzer: Active editor found:", {
      languageId: activeEditor.document.languageId,
      fileName: activeEditor.document.fileName,
      lineCount: activeEditor.document.lineCount,
      cursorLine: activeEditor.selection.active.line,
      cursorCharacter: activeEditor.selection.active.character
    });

    const document = activeEditor.document;
    const position = activeEditor.selection.active;
    const sourceCode = document.getText();
    const currentOffset = document.offsetAt(position);

    console.log("DataFlowAnalyzer: Document info:", {
      sourceCodeLength: sourceCode.length,
      currentOffset,
      positionLine: position.line,
      positionCharacter: position.character,
      firstChars: sourceCode.substring(0, 100).replace(/\n/g, '\\n')
    });

    try {
      // Start with current function and expand outward
      const currentFunction = await this.extractCurrentFunction(sourceCode, document.languageId, currentOffset);
      if (!currentFunction) {
        console.warn("DataFlowAnalyzer: No function found at current position");
        // Instead of throwing error, create a minimal analysis
        const analysis: DataFlowAnalysisIR = {
          functions: [],
          globalStateVariables: [],
          dataFlowEdges: [],
          title: `No function found at cursor`,
          scope: 'function',
          analysisTimestamp: Date.now()
        };

        // Try to find all functions in the file
        console.log("DataFlowAnalyzer: Attempting to find all functions in file");
        const allFunctions = this.findAllFunctions(sourceCode, document.languageId);
        console.log("DataFlowAnalyzer: Found functions:", allFunctions.map(f => f.name));
        
        if (allFunctions.length > 0) {
          analysis.functions = allFunctions;
          analysis.title = `Functions in ${document.fileName.split('/').pop() || 'file'}`;
        }

        return analysis;
      }

      console.log("DataFlowAnalyzer: Found current function:", {
        name: currentFunction.name,
        parameters: currentFunction.parameters,
        isAsync: currentFunction.isAsync,
        locationLine: currentFunction.location.line
      });

      const analysis: DataFlowAnalysisIR = {
        functions: [currentFunction],
        globalStateVariables: [],
        dataFlowEdges: [],
        title: `Data Flow: ${currentFunction.name}`,
        rootFunction: currentFunction.name,
        scope: 'function',
        analysisTimestamp: Date.now()
      };

      // Extract global state accesses from the current function
      console.log("DataFlowAnalyzer: Analyzing global state usage");
      await this.analyzeGlobalStateUsage(analysis, [document.uri.fsPath]);

      console.log("DataFlowAnalyzer: Global state analysis complete:", {
        globalVarsFound: analysis.globalStateVariables.length,
        globalVarNames: analysis.globalStateVariables.map(g => g.name)
      });

      // Expand to find functions that share data with the current function
      console.log("DataFlowAnalyzer: Expanding data flow analysis");
      await this.expandDataFlowAnalysis(analysis, currentFunction);

      console.log("DataFlowAnalyzer: Analysis complete:", {
        totalFunctions: analysis.functions.length,
        totalGlobalVars: analysis.globalStateVariables.length,
        totalDataFlowEdges: analysis.dataFlowEdges.length
      });

      return analysis;
    } catch (error) {
      console.error("DataFlowAnalyzer: Error in analysis:", error);
      throw error;
    }
  }

  /**
   * Analyze data flow for the entire workspace
   */
  public async analyzeWorkspaceDataFlow(): Promise<DataFlowAnalysisIR> {
    console.log("DataFlowAnalyzer: Starting workspace data flow analysis");
    
    if (!this.workspaceRoot) {
      console.error("DataFlowAnalyzer: No workspace found");
      throw new Error("No workspace found");
    }

    console.log("DataFlowAnalyzer: Workspace root:", this.workspaceRoot);

    try {
      // Find all source files in the workspace
      console.log("DataFlowAnalyzer: Finding source files in workspace");
      const sourceFiles = await this.findSourceFiles(this.workspaceRoot);
      console.log("DataFlowAnalyzer: Found source files:", {
        count: sourceFiles.length,
        files: sourceFiles.slice(0, 10).map(f => f.split('/').pop()) // Show first 10 filenames
      });
      
      const analysis: DataFlowAnalysisIR = {
        functions: [],
        globalStateVariables: [],
        dataFlowEdges: [],
        title: "Workspace Data Flow",
        scope: 'workspace',
        analysisTimestamp: Date.now()
      };

      // Analyze each file for functions and global state
      let filesAnalyzed = 0;
      for (const filePath of sourceFiles.slice(0, 20)) { // Limit to first 20 files for performance
        try {
          console.log(`DataFlowAnalyzer: Analyzing file ${filesAnalyzed + 1}/${Math.min(sourceFiles.length, 20)}: ${filePath.split('/').pop()}`);
          await this.analyzeFileForDataFlow(analysis, filePath);
          filesAnalyzed++;
        } catch (error) {
          console.warn(`DataFlowAnalyzer: Failed to analyze file ${filePath}:`, error);
        }
      }

      console.log("DataFlowAnalyzer: File analysis complete:", {
        filesAnalyzed,
        functionsFound: analysis.functions.length,
        globalVarsFound: analysis.globalStateVariables.length
      });

      // Build data flow edges between functions
      console.log("DataFlowAnalyzer: Building data flow connections");
      await this.buildDataFlowConnections(analysis);

      console.log("DataFlowAnalyzer: Workspace analysis complete:", {
        totalFunctions: analysis.functions.length,
        totalGlobalVars: analysis.globalStateVariables.length,
        totalDataFlowEdges: analysis.dataFlowEdges.length
      });

      return analysis;
    } catch (error) {
      console.error("DataFlowAnalyzer: Error in workspace analysis:", error);
      throw error;
    }
  }

  /**
   * Find all functions in the source code (fallback when cursor detection fails)
   */
  private findAllFunctions(sourceCode: string, languageId: string): FunctionInfo[] {
    console.log("DataFlowAnalyzer: Finding all functions in file");
    const lines = sourceCode.split('\n');
    const functions: FunctionInfo[] = [];
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const functionMatch = this.matchFunctionDefinition(line, languageId);
      if (functionMatch) {
        console.log(`DataFlowAnalyzer: Found function '${functionMatch.name}' at line ${i + 1}`);
        
        const functionStart = lines.slice(0, i).join('\n').length + (i > 0 ? 1 : 0);
        const functionEnd = this.findFunctionEnd(lines, i, languageId);
        
        const functionInfo: FunctionInfo = {
          name: functionMatch.name,
          filePath: vscode.window.activeTextEditor?.document.uri.fsPath || '',
          location: {
            start: functionStart,
            end: functionEnd,
            line: i + 1,
            column: functionMatch.column
          },
          globalStateAccesses: [],
          parameters: functionMatch.parameters,
          calls: [],
          isAsync: functionMatch.isAsync,
        };
        
        functions.push(functionInfo);
      }
    }
    
    console.log(`DataFlowAnalyzer: Found ${functions.length} functions total`);
    return functions;
  }

  /**
   * Extract the current function at the given position
   */
  private async extractCurrentFunction(sourceCode: string, languageId: string, position: number): Promise<FunctionInfo | null> {
    // This is a simplified implementation - would use proper AST parsing in production
    const lines = sourceCode.split('\n');
    let currentLine = 0;
    let currentPos = 0;

    // Find the line containing the position
    for (let i = 0; i < lines.length; i++) {
      if (currentPos + lines[i].length >= position) {
        currentLine = i;
        break;
      }
      currentPos += lines[i].length + 1; // +1 for newline
    }

    // Look backwards to find a function definition
    for (let i = currentLine; i >= 0; i--) {
      const line = lines[i];
      const functionMatch = this.matchFunctionDefinition(line, languageId);
      if (functionMatch) {
        const functionStart = lines.slice(0, i).join('\n').length + (i > 0 ? 1 : 0);
        const functionEnd = this.findFunctionEnd(lines, i, languageId);
        
        return {
          name: functionMatch.name,
          filePath: vscode.window.activeTextEditor?.document.uri.fsPath || '',
          location: {
            start: functionStart,
            end: functionEnd,
            line: i + 1,
            column: functionMatch.column
          },
          globalStateAccesses: [],
          parameters: functionMatch.parameters,
          calls: [],
          isAsync: functionMatch.isAsync,
        };
      }
    }

    return null;
  }

  /**
   * Match function definition patterns for different languages
   */
  private matchFunctionDefinition(line: string, languageId: string): {name: string, parameters: string[], column: number, isAsync: boolean} | null {
    let patterns: RegExp[] = [];
    
    switch (languageId) {
      case 'typescript':
      case 'javascript':
        patterns = [
          /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/,
          /(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s+)?\([^)]*\)\s*=>/,
          /(\w+)\s*:\s*\([^)]*\)\s*=>/,
          /(?:async\s+)?(\w+)\s*\([^)]*\)\s*{/
        ];
        break;
      case 'python':
        patterns = [
          /def\s+(\w+)\s*\(([^)]*)\):/,
          /async\s+def\s+(\w+)\s*\(([^)]*)\):/
        ];
        break;
      default:
        patterns = [/function\s+(\w+)\s*\(([^)]*)\)/];
    }

    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (match) {
        const isAsync = line.includes('async');
        const parameters = match[2] ? match[2].split(',').map(p => p.trim()) : [];
        return {
          name: match[1],
          parameters,
          column: match.index || 0,
          isAsync
        };
      }
    }

    return null;
  }

  /**
   * Find the end of a function (simplified implementation)
   */
  private findFunctionEnd(lines: string[], startLine: number, languageId: string): number {
    let braceCount = 0;
    let inFunction = false;

    for (let i = startLine; i < lines.length; i++) {
      const line = lines[i];
      
      for (const char of line) {
        if (char === '{') {
          braceCount++;
          inFunction = true;
        } else if (char === '}') {
          braceCount--;
          if (inFunction && braceCount === 0) {
            return lines.slice(0, i + 1).join('\n').length;
          }
        }
      }
    }

    return lines.join('\n').length;
  }

  /**
   * Analyze global state usage in the given files
   */
  private async analyzeGlobalStateUsage(analysis: DataFlowAnalysisIR, filePaths: string[]): Promise<void> {
    for (const filePath of filePaths) {
      try {
        const content = await fs.promises.readFile(filePath, 'utf-8');
        const languageId = this.getLanguageFromPath(filePath);
        
        // Extract global variables and their usage
        const globals = this.extractGlobalVariables(content, languageId, filePath);
        analysis.globalStateVariables.push(...globals);
        
        // Update function global accesses
        for (const func of analysis.functions) {
          if (func.filePath === filePath) {
            func.globalStateAccesses = this.extractGlobalAccesses(content, func, globals);
          }
        }
      } catch (error) {
        console.warn(`Failed to analyze file ${filePath}:`, error);
      }
    }
  }

  /**
   * Extract global variables from source code (simplified implementation)
   */
  private extractGlobalVariables(content: string, languageId: string, filePath: string): GlobalStateVariable[] {
    const globals: GlobalStateVariable[] = [];
    const lines = content.split('\n');

    lines.forEach((line, index) => {
      let patterns: RegExp[] = [];
      
      switch (languageId) {
        case 'typescript':
        case 'javascript':
          patterns = [
            /(?:export\s+)?(?:let|const|var)\s+(\w+)/g,
            /(?:export\s+)?class\s+(\w+)/g,
            /(?:export\s+)?interface\s+(\w+)/g
          ];
          break;
        case 'python':
          patterns = [/^(\w+)\s*=/g];
          break;
      }

      for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(line)) !== null) {
          globals.push({
            name: match[1],
            type: 'unknown',
            declarationLocation: {
              start: content.split('\n').slice(0, index).join('\n').length,
              end: content.split('\n').slice(0, index + 1).join('\n').length,
              line: index + 1,
              column: match.index || 0
            },
            accessedBy: [],
            modifications: []
          });
        }
      }
    });

    return globals;
  }

  /**
   * Extract global accesses within a function
   */
  private extractGlobalAccesses(content: string, func: FunctionInfo, globals: GlobalStateVariable[]): GlobalStateAccess[] {
    const accesses: GlobalStateAccess[] = [];
    const funcContent = content.substring(func.location.start, func.location.end);
    
    globals.forEach(globalVar => {
      const readPattern = new RegExp(`\\b${globalVar.name}\\b(?!\\s*=)`, 'g');
      const writePattern = new RegExp(`\\b${globalVar.name}\\s*=`, 'g');
      
      let match;
      while ((match = readPattern.exec(funcContent)) !== null) {
        accesses.push({
          variableName: globalVar.name,
          accessType: 'read',
          location: {
            start: func.location.start + match.index,
            end: func.location.start + match.index + match[0].length,
            line: 0, // Would calculate properly in production
            column: match.index
          }
        });
      }
      
      while ((match = writePattern.exec(funcContent)) !== null) {
        accesses.push({
          variableName: globalVar.name,
          accessType: 'write',
          location: {
            start: func.location.start + match.index,
            end: func.location.start + match.index + match[0].length,
            line: 0,
            column: match.index
          }
        });
      }
    });

    return accesses;
  }

  /**
   * Expand analysis to include functions that share data with the current function
   */
  private async expandDataFlowAnalysis(analysis: DataFlowAnalysisIR, rootFunction: FunctionInfo): Promise<void> {
    // Find functions that read/write the same global state
    const relatedGlobals = rootFunction.globalStateAccesses.map(access => access.variableName);
    
    if (relatedGlobals.length === 0) {
      return;
    }

    // Find other files that might contain functions using the same globals
    const workspaceFiles = await this.findSourceFiles(this.workspaceRoot);
    
    for (const filePath of workspaceFiles.slice(0, 10)) { // Limit for performance
      if (filePath === rootFunction.filePath) continue;
      
      try {
        const content = await fs.promises.readFile(filePath, 'utf-8');
        const hasSharedGlobals = relatedGlobals.some(global => 
          content.includes(global)
        );
        
        if (hasSharedGlobals) {
          // Extract functions from this file that use shared globals
          const functions = await this.extractFunctionsFromFile(filePath, content);
          const relevantFunctions = functions.filter(func => 
            func.globalStateAccesses.some(access => 
              relatedGlobals.includes(access.variableName)
            )
          );
          
          analysis.functions.push(...relevantFunctions);
        }
      } catch (error) {
        console.warn(`Failed to expand analysis for ${filePath}:`, error);
      }
    }

    // Update scope to reflect expansion
    analysis.scope = 'module';
    analysis.title = `Data Flow: ${rootFunction.name} + Dependencies`;
  }

  /**
   * Find all source files in the workspace
   */
  private async findSourceFiles(rootPath: string): Promise<string[]> {
    const sourceFiles: string[] = [];
    const extensions = ['.ts', '.js', '.py', '.java', '.cpp', '.c', '.rs'];
    
    const traverseDirectory = async (dirPath: string) => {
      try {
        const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
        
        for (const entry of entries) {
          const fullPath = path.join(dirPath, entry.name);
          
          if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
            await traverseDirectory(fullPath);
          } else if (entry.isFile() && extensions.some(ext => entry.name.endsWith(ext))) {
            sourceFiles.push(fullPath);
          }
        }
      } catch (error) {
        console.warn(`Failed to traverse directory ${dirPath}:`, error);
      }
    };

    await traverseDirectory(rootPath);
    return sourceFiles.slice(0, 50); // Limit for performance
  }

  /**
   * Extract functions from a file
   */
  private async extractFunctionsFromFile(filePath: string, content: string): Promise<FunctionInfo[]> {
    const functions: FunctionInfo[] = [];
    const languageId = this.getLanguageFromPath(filePath);
    const lines = content.split('\n');
    
    lines.forEach((line, index) => {
      const functionMatch = this.matchFunctionDefinition(line, languageId);
      if (functionMatch) {
        const functionStart = lines.slice(0, index).join('\n').length + (index > 0 ? 1 : 0);
        const functionEnd = this.findFunctionEnd(lines, index, languageId);
        
        functions.push({
          name: functionMatch.name,
          filePath,
          location: {
            start: functionStart,
            end: functionEnd,
            line: index + 1,
            column: functionMatch.column
          },
          globalStateAccesses: [],
          parameters: functionMatch.parameters,
          calls: [],
          isAsync: functionMatch.isAsync,
        });
      }
    });

    return functions;
  }

  /**
   * Get language ID from file path
   */
  private getLanguageFromPath(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    switch (ext) {
      case '.ts': return 'typescript';
      case '.js': return 'javascript';
      case '.py': return 'python';
      case '.java': return 'java';
      case '.cpp': case '.cc': case '.cxx': return 'cpp';
      case '.c': return 'c';
      case '.rs': return 'rust';
      default: return 'unknown';
    }
  }

  /**
   * Analyze a file for data flow (stub implementation)
   */
  private async analyzeFileForDataFlow(analysis: DataFlowAnalysisIR, filePath: string): Promise<void> {
    // Implementation would extract functions and global state from the file
    // This is a simplified stub
  }

  /**
   * Build data flow connections between functions
   */
  private async buildDataFlowConnections(analysis: DataFlowAnalysisIR): Promise<void> {
    // Implementation would analyze function calls and shared global state
    // to create data flow edges
  }
}