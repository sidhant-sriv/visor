export interface Location {
    start: number;
    end: number;
}

export interface FlowchartNode {
    id: string;
    label: string;
    location?: Location;
    shape?: 'rect' | 'diamond' | 'round' | 'stadium';
    style?: string;
}

export interface FlowchartEdge {
    from: string; // nodeId
    to: string | null; // nodeId
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
    functionRange?: { start: number, end: number };
    title?: string;
} 