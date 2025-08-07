/**
 * Data Flow Intermediate Representation for tracking global state and data dependencies
 */

export interface DataFlowLocation {
  start: number;
  end: number;
  line: number;
  column: number;
}

export interface GlobalStateAccess {
  variableName: string;
  accessType: 'read' | 'write' | 'read-write';
  location: DataFlowLocation;
  context?: string; // Additional context about the access
}

export interface FunctionInfo {
  name: string;
  filePath: string;
  location: DataFlowLocation;
  globalStateAccesses: GlobalStateAccess[];
  parameters: string[];
  returnType?: string;
  calls: FunctionCallInfo[];
  isAsync: boolean;
  complexity?: number;
}

export interface FunctionCallInfo {
  functionName: string;
  targetFile?: string;
  targetModule?: string;
  location: DataFlowLocation;
  arguments: DataFlowValue[];
}

export interface DataFlowValue {
  name: string;
  type: 'variable' | 'literal' | 'expression' | 'global';
  sourceLocation?: DataFlowLocation;
}

export interface DataFlowEdge {
  from: string; // function identifier
  to: string; // function identifier
  dataExchanged: DataFlowValue[];
  edgeType: 'function_call' | 'global_state' | 'parameter_passing' | 'return_value';
}

export interface GlobalStateVariable {
  name: string;
  type: string;
  declarationLocation: DataFlowLocation;
  accessedBy: string[]; // function identifiers
  modifications: {
    functionId: string;
    location: DataFlowLocation;
    operation: 'assign' | 'modify' | 'delete';
  }[];
}

export interface DataFlowAnalysisIR {
  functions: FunctionInfo[];
  globalStateVariables: GlobalStateVariable[];
  dataFlowEdges: DataFlowEdge[];
  title: string;
  rootFunction?: string;
  scope: 'function' | 'file' | 'module' | 'workspace';
  analysisTimestamp: number;
}