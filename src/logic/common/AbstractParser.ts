import Parser from "tree-sitter";
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
  protected readonly nodeStyles = {
    terminator: "fill:#e8f5e8,stroke:#2e7d32,stroke-width:1.5px,color:#000",
    decision: "fill:#fff3e0,stroke:#f57c00,stroke-width:1.5px,color:#000",
    process: "fill:#f3e5f5,stroke:#7b1fa2,stroke-width:1.5px,color:#000",
    special: "fill:#e3f2fd,stroke:#0d47a1,stroke-width:1.5px,color:#000",
    break: "fill:#ffebee,stroke:#c62828,stroke-width:1.5px,color:#000",
    hof: "fill:#e8eaf6,stroke:#3f51b5,stroke-width:1.5px,color:#000",
  };

  protected log(message: string, ...args: any[]) {
    if (this.debug) console.log(`[ASTParser] ${message}`, ...args);
  }

  protected generateNodeId(prefix: string): string {
    return `${prefix}_${this.nodeIdCounter++}`;
  }

  protected escapeString(str: string): string {
    return StringProcessor.escapeString(str);
  }

  abstract listFunctions(sourceCode: string): string[];
  abstract findFunctionAtPosition(
    sourceCode: string,
    position: number
  ): string | undefined;
  abstract generateFlowchart(
    sourceCode: string,
    functionName?: string,
    position?: number
  ): FlowchartIR;

  protected processBlock(
    blockNode: Parser.SyntaxNode | null,
    exitId: string,
    loopContext?: LoopContext,
    finallyContext?: { finallyEntryId: string }
  ): ProcessResult {
    if (!blockNode)
      return {
        nodes: [],
        edges: [],
        entryNodeId: undefined,
        exitPoints: [],
        nodesConnectedToExit: new Set<string>(),
      };

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
    if (statements.length === 0)
      return {
        nodes: [],
        edges: [],
        entryNodeId: undefined,
        exitPoints: [],
        nodesConnectedToExit: new Set<string>(),
      };

    const nodes: FlowchartNode[] = [];
    const edges: FlowchartEdge[] = [];
    const nodesConnectedToExit = new Set<string>();
    let entryNodeId: string | undefined;
    let lastExitPoints: { id: string; label?: string }[] = [];

    for (const statement of statements) {
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
        lastExitPoints.forEach((exitPoint) => {
          edges.push({
            from: exitPoint.id,
            to: result.entryNodeId!,
            label: exitPoint.label,
          });
        });
      }
      lastExitPoints = result.exitPoints;
    }

    return {
      nodes,
      edges,
      entryNodeId,
      exitPoints: lastExitPoints,
      nodesConnectedToExit,
    };
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
    const nodeText = this.escapeString(statement.text);
    const node: FlowchartNode = {
      id: nodeId,
      label: nodeText,
      shape: "rect",
      style: this.nodeStyles.process,
    };
    this.locationMap.push({
      start: statement.startIndex,
      end: statement.endIndex,
      nodeId,
    });
    return {
      nodes: [node],
      edges: [],
      entryNodeId: nodeId,
      exitPoints: [{ id: nodeId }],
      nodesConnectedToExit: new Set<string>(),
    };
  }
}
