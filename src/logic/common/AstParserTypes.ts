import { FlowchartEdge, FlowchartNode } from "../../ir/ir";

export interface ProcessResult {
  nodes: FlowchartNode[];
  edges: FlowchartEdge[];
  entryNodeId?: string;
  exitPoints: { id: string; label?: string }[];
  nodesConnectedToExit: Set<string>;
}

export interface LoopContext {
  breakTargetId: string;
  continueTargetId: string;
}
