export interface Location {
  start: number;
  end: number;
}

export enum NodeType {
  ENTRY = "entry",
  EXIT = "exit",
  PROCESS = "process",
  DECISION = "decision",
  LOOP_START = "loop_start",
  LOOP_END = "loop_end",
  EXCEPTION = "exception",
  BREAK_CONTINUE = "break_continue",
  FUNCTION_CALL = "function_call",
  ASSIGNMENT = "assignment",
  RETURN = "return",
  ASYNC_OPERATION = "async_operation",
  // New Rust-specific node types
  AWAIT = "await",
  PANIC = "panic",
  EARLY_RETURN_ERROR = "early_return_error",
  METHOD_CALL = "method_call",
  MACRO_CALL = "macro_call",
}

export enum NodeCategory {
  CONTROL_FLOW = "control_flow",
  DATA_OPERATION = "data_operation",
  FUNCTION_BOUNDARY = "function_boundary",
  EXCEPTION_HANDLING = "exception_handling",
  LOOP_CONTROL = "loop_control",
  ASYNC_CONTROL = "async_control",
}

export interface SemanticNodeInfo {
  complexity?: "low" | "medium" | "high";
  cyclomaticComplexity?: number;
  complexityRating?: "low" | "medium" | "high" | "very-high";
  importance?: "low" | "medium" | "high";
  codeType?: "synchronous" | "asynchronous" | "callback";
  language?: string;
}

export interface FlowchartNode {
  id: string;
  label: string;
  location?: Location;
  shape?: "rect" | "diamond" | "round" | "stadium";
  style?: string;

  // Enhanced node categorization
  nodeType?: NodeType;
  nodeCategory?: NodeCategory;

  // Semantic information for enhanced styling
  semanticInfo?: SemanticNodeInfo;
}

export interface FlowchartEdge {
  from: string; // nodeId
  to: string; // nodeId
  label?: string;
}

export interface LocationMapEntry {
  start: number;
  end: number;
  nodeId: string;
}

export interface FlowchartIR {
  nodes: FlowchartNode[];
  edges: FlowchartEdge[];
  entryNodeId?: string;
  exitNodeId?: string;
  locationMap: LocationMapEntry[];
  functionRange?: { start: number; end: number };
  title?: string;
  functionComplexity?: {
    cyclomaticComplexity: number;
    rating: "low" | "medium" | "high" | "very-high";
    description: string;
  };
}
