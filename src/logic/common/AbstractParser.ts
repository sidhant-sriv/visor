import Parser from "web-tree-sitter"; // Changed from "tree-sitter"
import {
  FlowchartIR,
  FlowchartNode,
  FlowchartEdge,
  LocationMapEntry,
} from "../../ir/ir";
import { StringProcessor } from "../utils/StringProcessor";
import { ProcessResult, LoopContext } from "./AstParserTypes";

export abstract class AbstractParser {
  protected nodeIdCounter = 0;
  protected locationMap: LocationMapEntry[] = [];
  protected debug = false;
  
  // The parser instance is now required by the constructor
  protected parser: Parser;

  // Object pool for ProcessResult to reduce GC pressure
  private static processResultPool: ProcessResult[] = [];
  private static readonly MAX_POOL_SIZE = 50;
  
  protected constructor(parser: Parser) {
      this.parser = parser;
  }

  protected readonly nodeStyles = {
    terminator: "fill:#e8f5e8,stroke:#2e7d32,stroke-width:1.5px,color:#000",
    decision: "fill:#fff3e0,stroke:#f57c00,stroke-width:1.5px,color:#000",
    process: "fill:#f3e5f5,stroke:#7b1fa2,stroke-width:1.5px,color:#000",
    special: "fill:#e3f2fd,stroke:#0d47a1,stroke-width:1.5px,color:#000",
    break: "fill:#ffebee,stroke:#c62828,stroke-width:1.5px,color:#000",
    hof: "fill:#e8eaf6,stroke:#3f51b5,stroke-width:1.5px,color:#000",
  };

  protected log(message: string, ...args: unknown[]) {
    if (this.debug) console.log(`[ASTParser] ${message}`, ...args);
  }

  protected generateNodeId(prefix: string): string {
    return `${prefix}_${this.nodeIdCounter++}`;
  }

  protected escapeString(str: string): string {
    return StringProcessor.escapeString(str);
  }

  // Object pooling for ProcessResult
  protected createProcessResult(
    nodes: FlowchartNode[] = [],
    edges: FlowchartEdge[] = [],
    entryNodeId?: string,
    exitPoints: { id: string; label?: string }[] = [],
    nodesConnectedToExit: Set<string> = new Set()
  ): ProcessResult {
    let result = AbstractParser.processResultPool.pop();
    if (!result) {
      result = {
        nodes: [],
        edges: [],
        entryNodeId: undefined,
        exitPoints: [],
        nodesConnectedToExit: new Set(),
      };
    } else {
      // Reset the pooled object
      result.nodes.length = 0;
      result.edges.length = 0;
      result.entryNodeId = undefined;
      result.exitPoints.length = 0;
      result.nodesConnectedToExit.clear();
    }

    result.nodes.push(...nodes);
    result.edges.push(...edges);
    result.entryNodeId = entryNodeId;
    result.exitPoints.push(...exitPoints);
    nodesConnectedToExit.forEach((id) => result.nodesConnectedToExit.add(id));

    return result;
  }
  
  // Return ProcessResult to pool for reuse
  protected recycleProcessResult(result: ProcessResult): void {
    if (AbstractParser.processResultPool.length < AbstractParser.MAX_POOL_SIZE) {
      AbstractParser.processResultPool.push(result);
    }
  }

  abstract listFunctions(sourceCode: string): string[];
  abstract findFunctionAtPosition(sourceCode: string, position: number): string | undefined;
  abstract generateFlowchart(sourceCode: string, functionName?: string, position?: number): FlowchartIR;

  protected processBlock(
    blockNode: Parser.SyntaxNode | null,
    exitId: string,
    loopContext?: LoopContext,
    finallyContext?: { finallyEntryId: string }
  ): ProcessResult {
    if (!blockNode) {
      return this.createProcessResult();
    }

    // Pre-filter statements for better performance
    const statements = blockNode.namedChildren.filter(
      (s) =>
        ![
          "pass_statement",
          "comment",
          "elif_clause",
          "else_clause",
          "empty_statement",
        ].includes(s.type)
    );

    if (statements.length === 0) {
      return this.createProcessResult();
    }

    const nodes: FlowchartNode[] = [];
    const edges: FlowchartEdge[] = [];
    const nodesConnectedToExit = new Set<string>();
    let entryNodeId: string | undefined;
    let lastExitPoints: { id: string; label?: string }[] = [];

    // Process statements with improved loop
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      const result = this.processStatement(
        statement,
        exitId,
        loopContext,
        finallyContext
      );

      nodes.push(...result.nodes);
      edges.push(...result.edges);
      result.nodesConnectedToExit.forEach((n) => nodesConnectedToExit.add(n));

      if (!entryNodeId) entryNodeId = result.entryNodeId;
      if (lastExitPoints.length > 0 && result.entryNodeId) {
        for (const exitPoint of lastExitPoints) {
          edges.push({
            from: exitPoint.id,
            to: result.entryNodeId,
            label: exitPoint.label,
          });
        }
      }
      lastExitPoints = result.exitPoints;
    }

    return this.createProcessResult(
      nodes,
      edges,
      entryNodeId,
      lastExitPoints,
      nodesConnectedToExit
    );
  }

  protected abstract processStatement(
    statement: Parser.SyntaxNode,
    exitId: string,
    loopContext?: LoopContext,
    finallyContext?: { finallyEntryId: string }
  ): ProcessResult;

  protected processDefaultStatement(
    statement: Parser.SyntaxNode
  ): ProcessResult {
    const nodeId = this.generateNodeId("stmt");
    const node: FlowchartNode = {
      id: nodeId,
      label: this.escapeString(statement.text),
      shape: "rect",
      style: this.nodeStyles.process,
    };

    this.locationMap.push({
      start: statement.startIndex,
      end: statement.endIndex,
      nodeId,
    });

    return this.createProcessResult([node], [], nodeId, [{ id: nodeId }]);
  }

  // Memory management utilities
  protected resetState(): void {
    this.nodeIdCounter = 0;
    this.locationMap.length = 0;
  }

  // Performance monitoring
  protected measurePerformance<T>(operation: string, fn: () => T): T {
    if (this.debug) {
      const start = performance.now();
      const result = fn();
      const end = performance.now();
      this.log(`${operation} took ${(end - start).toFixed(2)}ms`);
      return result;
    }
    return fn();
  }

  // Cleanup method to be called when parser is no longer needed
  static cleanup(): void {
    AbstractParser.processResultPool.length = 0;
    StringProcessor.clearCache();
  }
}