import { FlowchartIR, FlowchartNode, FlowchartEdge, NodeType } from "../../ir/ir";

export interface AnimationPath {
  id: string;
  nodes: string[];
  edges: string[];
  description: string;
}

export interface AnimationPathStep {
  nodeId: string;
  edgeId?: string;
  isLoopIteration?: boolean;
}

export class AnimationPathGenerator {
  private static readonly MAX_LOOP_ITERATIONS = 2;
  private static readonly MAX_PATH_LENGTH = 50; // Prevent infinite paths

  /**
   * Generate all possible execution paths through the flowchart
   */
  public static generatePaths(ir: FlowchartIR): AnimationPath[] {
    if (!ir.entryNodeId || ir.nodes.length === 0) {
      console.log('AnimationPathGenerator: No entry node or empty nodes');
      return [];
    }

    try {
      const paths: AnimationPath[] = [];
      const visited = new Set<string>();
      const pathSteps: AnimationPathStep[] = [];
      const nodeMap = new Map<string, FlowchartNode>();
      const edgeMap = new Map<string, FlowchartEdge[]>();

      // Build lookup maps
      for (const node of ir.nodes) {
        nodeMap.set(node.id, node);
      }

      for (const edge of ir.edges) {
        if (!edgeMap.has(edge.from)) {
          edgeMap.set(edge.from, []);
        }
        edgeMap.get(edge.from)!.push(edge);
      }

      console.log(`AnimationPathGenerator: Starting path generation from ${ir.entryNodeId}`);
      
      // Generate paths starting from entry node
      this.generatePathsFromNode(
        ir.entryNodeId,
        nodeMap,
        edgeMap,
        paths,
        visited,
        pathSteps,
        0
      );

      console.log(`AnimationPathGenerator: Generated ${paths.length} paths`);
      return paths.length > 0 ? paths : this.generateFallbackPath(ir);
    } catch (error) {
      console.error('AnimationPathGenerator: Error generating paths:', error);
      return this.generateFallbackPath(ir);
    }
  }

  private static generatePathsFromNode(
    nodeId: string,
    nodeMap: Map<string, FlowchartNode>,
    edgeMap: Map<string, FlowchartEdge[]>,
    paths: AnimationPath[],
    visited: Set<string>,
    pathSteps: AnimationPathStep[],
    depth: number
  ): void {
    // Prevent infinite recursion
    if (depth > this.MAX_PATH_LENGTH) {
      console.log(`AnimationPathGenerator: Max depth reached for node ${nodeId}`);
      return;
    }

    // Prevent cycles
    if (visited.has(nodeId)) {
      console.log(`AnimationPathGenerator: Cycle detected at node ${nodeId}`);
      return;
    }

    const node = nodeMap.get(nodeId);
    if (!node) {
      console.log(`AnimationPathGenerator: Node ${nodeId} not found`);
      return;
    }

    // Add current node to path and visited set
    pathSteps.push({ nodeId });
    visited.add(nodeId);

    // Check if this is an exit node
    if (this.isExitNode(node)) {
      this.createPathFromSteps(pathSteps, paths, nodeMap);
      pathSteps.pop();
      visited.delete(nodeId);
      return;
    }

    // Get outgoing edges
    const outgoingEdges = edgeMap.get(nodeId) || [];

    if (outgoingEdges.length === 0) {
      // Dead end - create path
      this.createPathFromSteps(pathSteps, paths, nodeMap);
      pathSteps.pop();
      visited.delete(nodeId);
      return;
    }

    // Handle different node types
    if (this.isDecisionNode(node)) {
      // For decision nodes, create separate paths for each branch
      for (const edge of outgoingEdges) {
        const edgeId = `${edge.from}_${edge.to}`;
        pathSteps[pathSteps.length - 1].edgeId = edgeId;
        
        this.generatePathsFromNode(
          edge.to,
          nodeMap,
          edgeMap,
          paths,
          new Set(visited), // Create new visited set for each branch
          [...pathSteps], // Create new path steps array
          depth + 1
        );
      }
    } else if (this.isLoopNode(node)) {
      // Handle loops with limited iterations
      const loopIterations = Math.min(outgoingEdges.length, this.MAX_LOOP_ITERATIONS);
      
      for (let i = 0; i < loopIterations; i++) {
        const edge = outgoingEdges[0]; // Assume first edge is the loop continuation
        const edgeId = `${edge.from}_${edge.to}`;
        
        pathSteps[pathSteps.length - 1].edgeId = edgeId;
        pathSteps[pathSteps.length - 1].isLoopIteration = i > 0;
        
        this.generatePathsFromNode(
          edge.to,
          nodeMap,
          edgeMap,
          paths,
          new Set(visited),
          [...pathSteps],
          depth + 1
        );
      }
    } else {
      // Regular node - follow first outgoing edge
      const edge = outgoingEdges[0];
      const edgeId = `${edge.from}_${edge.to}`;
      
      pathSteps[pathSteps.length - 1].edgeId = edgeId;
      
      this.generatePathsFromNode(
        edge.to,
        nodeMap,
        edgeMap,
        paths,
        visited,
        pathSteps,
        depth + 1
      );
    }

    pathSteps.pop();
    visited.delete(nodeId);
  }

  private static isExitNode(node: FlowchartNode): boolean {
    return (
      node.nodeType === NodeType.EXIT ||
      node.nodeType === NodeType.RETURN ||
      node.label.toLowerCase().includes('return') ||
      node.label.toLowerCase().includes('exit')
    );
  }

  private static isDecisionNode(node: FlowchartNode): boolean {
    return (
      node.nodeType === NodeType.DECISION ||
      node.shape === 'diamond' ||
      node.label.toLowerCase().includes('if') ||
      node.label.toLowerCase().includes('else') ||
      node.label.toLowerCase().includes('switch') ||
      node.label.toLowerCase().includes('case')
    );
  }

  private static isLoopNode(node: FlowchartNode): boolean {
    return (
      node.nodeType === NodeType.LOOP_START ||
      node.nodeType === NodeType.LOOP_END ||
      node.label.toLowerCase().includes('for') ||
      node.label.toLowerCase().includes('while') ||
      node.label.toLowerCase().includes('loop')
    );
  }

  private static createPathFromSteps(
    steps: AnimationPathStep[],
    paths: AnimationPath[],
    nodeMap: Map<string, FlowchartNode>
  ): void {
    if (steps.length === 0) {
      return;
    }

    const pathId = `path_${paths.length}`;
    const nodes: string[] = [];
    const edges: string[] = [];
    let description = '';

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      nodes.push(step.nodeId);
      
      if (step.edgeId) {
        edges.push(step.edgeId);
      }

      // Build description
      const node = nodeMap.get(step.nodeId);
      if (node) {
        if (i === 0) {
          description = `Start: ${node.label}`;
        } else if (step.isLoopIteration) {
          description += ` → [Loop] ${node.label}`;
        } else {
          description += ` → ${node.label}`;
        }
      }
    }

    // Add end marker
    if (steps.length > 1) {
      description += ' → End';
    }

    paths.push({
      id: pathId,
      nodes,
      edges,
      description
    });
  }

  private static generateFallbackPath(ir: FlowchartIR): AnimationPath[] {
    // If no paths were generated, create a simple linear path
    const nodes = ir.nodes.map(n => n.id);
    const edges: string[] = [];
    
    // Create edges between consecutive nodes
    for (let i = 0; i < nodes.length - 1; i++) {
      edges.push(`${nodes[i]}_${nodes[i + 1]}`);
    }

    return [{
      id: 'path_0',
      nodes,
      edges,
      description: `Linear path: ${nodes.join(' → ')}`
    }];
  }

  /**
   * Get a simplified path description for UI display
   */
  public static getPathDescription(path: AnimationPath, maxLength: number = 50): string {
    if (path.description.length <= maxLength) {
      return path.description;
    }
    
    return path.description.substring(0, maxLength - 3) + '...';
  }

  /**
   * Check if a path contains loops
   */
  public static hasLoops(path: AnimationPath): boolean {
    const nodeCounts = new Map<string, number>();
    
    for (const nodeId of path.nodes) {
      const count = nodeCounts.get(nodeId) || 0;
      nodeCounts.set(nodeId, count + 1);
    }
    
    return Array.from(nodeCounts.values()).some(count => count > 1);
  }
}
