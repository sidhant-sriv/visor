import * as vscode from "vscode";
import * as path from "path";
import { ModuleAnalysisIR, ModuleInfo, ImportInfo, ExportInfo, FunctionCallInfo, ModuleDependency, ModuleLocation } from "../ir/moduleIr";
import { analyzePythonModule } from "./language-services/python/PyModuleParser";
import { analyzeTypeScriptModule } from "./language-services/typescript/TsModuleParser";
import { analyzeJavaModule } from "./language-services/java/JavaModuleParser";

export class ModuleAnalyzer {
  private supportedLanguages = ['python', 'typescript', 'javascript', 'java'];
  private supportedExtensions = new Map([
    ['.py', 'python'],
    ['.ts', 'typescript'], 
    ['.js', 'javascript'],
    ['.tsx', 'typescript'],
    ['.jsx', 'javascript'],
    ['.java', 'java']
  ]);

  /**
   * Analyzes all modules in the current workspace
   */
  public async analyzeWorkspace(): Promise<ModuleAnalysisIR> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      throw new Error("No workspace folder found");
    }

    const rootPath = workspaceFolders[0].uri.fsPath;
    const modules: ModuleInfo[] = [];
    
    // Find all supported files in the workspace
    const files = await this.findSupportedFiles(rootPath);
    
    // Analyze each file
    for (const file of files) {
      try {
        const moduleInfo = await this.analyzeFile(file);
        if (moduleInfo) {
          modules.push(moduleInfo);
        }
      } catch (error) {
        console.warn(`Failed to analyze file ${file}:`, error);
      }
    }

    // Build dependency graph
    const dependencies = this.buildDependencyGraph(modules);

    return {
      modules,
      dependencies,
      title: `Module Analysis - ${path.basename(rootPath)}`,
      rootModule: modules.length > 0 ? modules[0].filePath : undefined,
      analysisTimestamp: Date.now()
    };
  }

  /**
   * Analyzes modules related to the current active file
   */
  public async analyzeActiveFileContext(): Promise<ModuleAnalysisIR> {
    const activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor) {
      throw new Error("No active editor");
    }

    const currentFile = activeEditor.document.fileName;
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(activeEditor.document.uri);
    if (!workspaceFolder) {
      throw new Error("File is not in a workspace");
    }

    const modules: ModuleInfo[] = [];
    const analyzed = new Set<string>();
    
    // Analyze current file and its dependencies recursively
    await this.analyzeFileRecursive(currentFile, modules, analyzed, 2); // Max depth of 2

    // Build dependency graph
    const dependencies = this.buildDependencyGraph(modules);

    return {
      modules,
      dependencies,
      title: `Module Context - ${path.basename(currentFile)}`,
      rootModule: currentFile,
      analysisTimestamp: Date.now()
    };
  }

  private async findSupportedFiles(rootPath: string): Promise<string[]> {
    const files: string[] = [];
    const pattern = '**/*.{py,ts,js,tsx,jsx,java}';
    const exclude = '**/node_modules/**';
    
    const fileUris = await vscode.workspace.findFiles(pattern, exclude);
    return fileUris.map(uri => uri.fsPath);
  }

  private async analyzeFile(filePath: string): Promise<ModuleInfo | null> {
    const extension = path.extname(filePath);
    const language = this.supportedExtensions.get(extension);
    
    if (!language) {
      return null;
    }

    try {
      const document = await vscode.workspace.openTextDocument(filePath);
      const code = document.getText();

      switch (language) {
        case 'python':
          return await analyzePythonModule(code, filePath);
        case 'typescript':
        case 'javascript':
          return await analyzeTypeScriptModule(code, filePath, language);
        case 'java':
          return await analyzeJavaModule(code, filePath);
        default:
          return null;
      }
    } catch (error) {
      console.warn(`Failed to analyze file ${filePath}:`, error);
      return null;
    }
  }

  private async analyzeFileRecursive(
    filePath: string, 
    modules: ModuleInfo[], 
    analyzed: Set<string>, 
    maxDepth: number
  ): Promise<void> {
    if (analyzed.has(filePath) || maxDepth <= 0) {
      return;
    }

    analyzed.add(filePath);
    const moduleInfo = await this.analyzeFile(filePath);
    
    if (moduleInfo) {
      modules.push(moduleInfo);

      // Analyze imported modules
      for (const importInfo of moduleInfo.imports) {
        const resolvedPath = this.resolveImportPath(importInfo.source, filePath);
        if (resolvedPath && !analyzed.has(resolvedPath)) {
          await this.analyzeFileRecursive(resolvedPath, modules, analyzed, maxDepth - 1);
        }
      }
    }
  }

  private resolveImportPath(importSource: string, currentFile: string): string | null {
    // Handle relative imports
    if (importSource.startsWith('./') || importSource.startsWith('../')) {
      const currentDir = path.dirname(currentFile);
      const resolvedPath = path.resolve(currentDir, importSource);
      
      // Try different extensions
      for (const [ext, _] of this.supportedExtensions) {
        const fullPath = resolvedPath + ext;
        if (this.fileExists(fullPath)) {
          return fullPath;
        }
      }

      // Try index files
      for (const [ext, _] of this.supportedExtensions) {
        const indexPath = path.join(resolvedPath, 'index' + ext);
        if (this.fileExists(indexPath)) {
          return indexPath;
        }
      }
    }

    // For absolute imports, we'd need more sophisticated resolution
    // For now, return null for simplicity
    return null;
  }

  private fileExists(filePath: string): boolean {
    try {
      const fs = require('fs');
      return fs.existsSync(filePath);
    } catch {
      return false;
    }
  }

  private buildDependencyGraph(modules: ModuleInfo[]): ModuleDependency[] {
    const dependencies: ModuleDependency[] = [];
    const moduleMap = new Map(modules.map(m => [m.filePath, m]));

    for (const module of modules) {
      for (const importInfo of module.imports) {
        const resolvedPath = this.resolveImportPath(importInfo.source, module.filePath);
        if (resolvedPath && moduleMap.has(resolvedPath)) {
          dependencies.push({
            from: module.filePath,
            to: resolvedPath,
            importedItems: [importInfo.name],
            dependencyType: 'import'
          });
        }
      }

      // Add function call dependencies
      for (const call of module.functionCalls) {
        if (call.module) {
          const targetModule = modules.find(m => m.fileName === call.module);
          if (targetModule) {
            dependencies.push({
              from: module.filePath,
              to: targetModule.filePath,
              importedItems: [call.functionName],
              dependencyType: 'function_call'
            });
          }
        }
      }
    }

    return dependencies;
  }
}