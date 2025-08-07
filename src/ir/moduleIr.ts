export interface ModuleLocation {
  start: number;
  end: number;
  line: number;
  column: number;
}

export interface ImportInfo {
  name: string;
  source: string;
  type: 'default' | 'named' | 'namespace' | 'all';
  alias?: string;
  location: ModuleLocation;
}

export interface ExportInfo {
  name: string;
  type: 'function' | 'class' | 'variable' | 'type' | 'default';
  location: ModuleLocation;
}

export interface FunctionCallInfo {
  functionName: string;
  module?: string; // If it's a cross-module call
  location: ModuleLocation;
}

export interface ModuleInfo {
  filePath: string;
  fileName: string;
  language: string;
  imports: ImportInfo[];
  exports: ExportInfo[];
  functionCalls: FunctionCallInfo[];
  functions: string[];
  classes: string[];
  variables: string[];
}

export interface ModuleDependency {
  from: string; // module path
  to: string; // module path
  importedItems: string[];
  dependencyType: 'import' | 'function_call' | 'class_usage';
}

export interface ModuleAnalysisIR {
  modules: ModuleInfo[];
  dependencies: ModuleDependency[];
  title: string;
  rootModule?: string;
  analysisTimestamp: number;
}