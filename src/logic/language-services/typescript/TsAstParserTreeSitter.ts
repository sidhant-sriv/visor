// Use require for tree-sitter modules to avoid TypeScript import issues
const Parser = require("tree-sitter");
const TypeScript = require("tree-sitter-typescript").typescript;

import {
  FlowchartIR,
  FlowchartNode,
  FlowchartEdge,
  LocationMapEntry,
} from "../../../ir/ir";
import { StringProcessor } from "../../utils/StringProcessor";

// Type definitions for tree-sitter
interface SyntaxNode {
  type: string;
  text: string;
  startIndex: number;
  endIndex: number;
  namedChildren: SyntaxNode[];
  namedChildCount: number;
  parent: SyntaxNode | null;
  childForFieldName(fieldName: string): SyntaxNode | null;
  descendantsOfType(type: string | string[]): SyntaxNode[];
}

interface Tree {
  rootNode: SyntaxNode;
}

interface ParserInstance {
  setLanguage(language: any): void;
  parse(code: string): Tree;
}

interface ProcessResult {
  nodes: FlowchartNode[];
  edges: FlowchartEdge[];
  entryNodeId?: string;
  exitPoints: { id: string; label?: string }[];
  nodesConnectedToExit: Set<string>;
}

interface LoopContext {
  breakTargetId: string;
  continueTargetId: string;
}

/**
 * Tree-sitter based TypeScript AST parser for generating flowcharts
 * This implementation follows the same pattern as PyAstParser but uses Tree-sitter for TypeScript
 */
export class TsAstParserTreeSitter {
  private nodeIdCounter = 0;
  private locationMap: LocationMapEntry[] = [];
  private shouldTerminateEarly = false;
  private recursionDepth = 0;

  // Performance limits
  private static readonly MAX_NODES = 200;
  private static readonly MAX_FUNCTION_SIZE = 5000;
  private static readonly MAX_RECURSION_DEPTH = 50;

  private readonly nodeStyles = {
    terminator: "fill:#eee,stroke:#000,stroke-width:4px,color:#000;",
    decision: "fill:#eee,stroke:#000,stroke-width:4px,color:#000;",
    process: "fill:#eee,stroke:#000,stroke-width:1px,color:#000;",
    special: "fill:#eee,stroke:#000,stroke-width:4px,color:#000",
    break: "fill:#eee,stroke:#000,stroke-width:2px,color:#000",
  };

  private generateNodeId(prefix: string): string {
    return `${prefix}_${this.nodeIdCounter++}`;
  }

  private escapeString(str: string): string {
    return StringProcessor.escapeString(str);
  }

  private checkPerformanceLimits(): boolean {
    if (this.nodeIdCounter >= TsAstParserTreeSitter.MAX_NODES) {
      this.shouldTerminateEarly = true;
      return false;
    }
    if (this.recursionDepth >= TsAstParserTreeSitter.MAX_RECURSION_DEPTH) {
      this.shouldTerminateEarly = true;
      return false;
    }
    return true;
  }

  /**
   * Main public method to generate a flowchart from TypeScript source code
   * Similar to PyAstParser.generateFlowchart but uses Tree-sitter
   */
  public generateFlowchart(sourceCode: string, position: number): FlowchartIR {
    this.nodeIdCounter = 0;
    this.locationMap = [];
    this.shouldTerminateEarly = false;
    this.recursionDepth = 0;

    const parser: ParserInstance = new Parser();
    parser.setLanguage(TypeScript);

    let tree: Tree;
    try {
      tree = parser.parse(sourceCode);
    } catch (error) {
      return {
        nodes: [
          { id: "A", label: "Failed to parse TypeScript code.", shape: "rect" },
        ],
        edges: [],
        locationMap: [],
      };
    }

    const targetNode = this.findFunctionAtPosition(tree.rootNode, position);

    if (!targetNode) {
      return {
        nodes: [
          {
            id: "A",
            label:
              "Place cursor inside a function or method to generate a flowchart.",
            shape: "rect",
          },
        ],
        edges: [],
        locationMap: [],
      };
    }

    // Check function size before processing
    const functionText = targetNode.text;
    if (functionText.length > TsAstParserTreeSitter.MAX_FUNCTION_SIZE) {
      return {
        nodes: [
          {
            id: "A",
            label: `Function too large (${functionText.length} chars). Limit: ${TsAstParserTreeSitter.MAX_FUNCTION_SIZE}`,
            shape: "rect",
          },
        ],
        edges: [],
        locationMap: [],
      };
    }

    const functionName = this.getFunctionName(targetNode);
    const nodes: FlowchartNode[] = [];
    const edges: FlowchartEdge[] = [];

    const entryId = this.generateNodeId("start");
    const exitId = this.generateNodeId("end");

    nodes.push({
      id: entryId,
      label: `start: ${functionName}`,
      shape: "round",
      style: this.nodeStyles.terminator,
    });
    nodes.push({
      id: exitId,
      label: "end",
      shape: "round",
      style: this.nodeStyles.terminator,
    });

    const body = this.getFunctionBody(targetNode);

    if (body) {
      const bodyResult = this.processStatementList(body, exitId);

      // Check if we terminated early
      if (this.shouldTerminateEarly) {
        nodes.push({
          id: "truncated",
          label: `... (truncated at ${this.nodeIdCounter} nodes)`,
          shape: "rect",
          style: this.nodeStyles.special,
        });
        edges.push({ from: entryId, to: "truncated" });
        edges.push({ from: "truncated", to: exitId });
      } else {
        nodes.push(...bodyResult.nodes);
        edges.push(...bodyResult.edges);

        if (bodyResult.entryNodeId) {
          edges.push({ from: entryId, to: bodyResult.entryNodeId });
        } else {
          edges.push({ from: entryId, to: exitId });
        }

        bodyResult.exitPoints.forEach((exitPoint) => {
          if (!bodyResult.nodesConnectedToExit.has(exitPoint.id)) {
            edges.push({
              from: exitPoint.id,
              to: exitId,
              label: exitPoint.label,
            });
          }
        });
      }
    } else {
      edges.push({ from: entryId, to: exitId });
    }

    return {
      nodes,
      edges,
      locationMap: this.locationMap,
      functionRange: {
        start: targetNode.startIndex,
        end: targetNode.endIndex,
      },
      title: `Flowchart for ${functionName}`,
      entryNodeId: entryId,
      exitNodeId: exitId,
    };
  }

  private findFunctionAtPosition(
    rootNode: SyntaxNode,
    position: number
  ): SyntaxNode | null {
    // Look for function_declaration, method_definition, arrow_function, function_expression
    const functionTypes = [
      "function_declaration",
      "method_definition",
      "arrow_function",
      "function_expression",
    ];

    for (const functionType of functionTypes) {
      const functions = rootNode.descendantsOfType(functionType);
      for (const func of functions) {
        if (position >= func.startIndex && position <= func.endIndex) {
          return func;
        }
      }
    }

    return null;
  }

  private getFunctionName(functionNode: SyntaxNode): string {
    const nameNode = functionNode.childForFieldName("name");
    if (nameNode) {
      return nameNode.text;
    }

    // For arrow functions, try to get name from variable declaration
    if (functionNode.type === "arrow_function") {
      const parent = functionNode.parent;
      if (parent?.type === "variable_declarator") {
        const nameNode = parent.childForFieldName("name");
        if (nameNode) {
          return nameNode.text;
        }
      }
    }

    return "[anonymous]";
  }

  private getFunctionBody(functionNode: SyntaxNode): SyntaxNode | null {
    const body = functionNode.childForFieldName("body");
    if (body?.type === "statement_block") {
      return body;
    }

    // For arrow functions with expression bodies
    if (body && functionNode.type === "arrow_function") {
      return body;
    }

    return null;
  }

  private processStatementList(
    bodyNode: SyntaxNode,
    exitId: string,
    loopContext?: LoopContext
  ): ProcessResult {
    this.recursionDepth++;

    if (!this.checkPerformanceLimits()) {
      this.recursionDepth--;
      return {
        nodes: [],
        edges: [],
        entryNodeId: "",
        exitPoints: [],
        nodesConnectedToExit: new Set<string>(),
      };
    }

    const nodes: FlowchartNode[] = [];
    const edges: FlowchartEdge[] = [];
    let entryNodeId: string = "";
    const nodesConnectedToExit = new Set<string>();
    let lastExitPoints: { id: string; label?: string }[] = [];

    const statements = bodyNode.namedChildren;

    if (statements.length === 0) {
      this.recursionDepth--;
      return {
        nodes: [],
        edges: [],
        entryNodeId: "",
        exitPoints: [],
        nodesConnectedToExit,
      };
    }

    for (const statement of statements) {
      if (this.shouldTerminateEarly) break;

      const result = this.processStatement(statement, exitId, loopContext);
      nodes.push(...result.nodes);
      edges.push(...result.edges);

      if (lastExitPoints.length > 0) {
        // Connect the exits of the previous statement to the entry of the current one.
        lastExitPoints.forEach((exitPoint) => {
          if (result.entryNodeId) {
            edges.push({
              from: exitPoint.id,
              to: result.entryNodeId,
              label: exitPoint.label,
            });
          }
        });
      } else {
        // This is the first statement in the block, so it's the entry point.
        entryNodeId = result.entryNodeId || "";
      }

      lastExitPoints = result.exitPoints;
      result.nodesConnectedToExit.forEach((n) => nodesConnectedToExit.add(n));
    }

    this.recursionDepth--;
    return {
      nodes,
      edges,
      entryNodeId,
      exitPoints: lastExitPoints,
      nodesConnectedToExit,
    };
  }

  private processStatement(
    statement: SyntaxNode,
    exitId: string,
    loopContext?: LoopContext
  ): ProcessResult {
    switch (statement.type) {
      case "if_statement":
        return this.processIfStatement(statement, exitId, loopContext);
      case "for_statement":
        return this.processForStatement(statement, exitId);
      case "for_in_statement":
        return this.processForInStatement(statement, exitId);
      case "while_statement":
        return this.processWhileStatement(statement, exitId);
      case "do_statement":
        return this.processDoWhileStatement(statement, exitId);
      case "try_statement":
        return this.processTryStatement(statement, exitId, loopContext);
      case "switch_statement":
        return this.processSwitchStatement(statement, exitId, loopContext);
      case "return_statement":
        return this.processReturnStatement(statement, exitId);
      case "break_statement":
        if (loopContext) {
          return this.processBreakStatement(statement, loopContext);
        }
        break;
      case "continue_statement":
        if (loopContext) {
          return this.processContinueStatement(statement, loopContext);
        }
        break;
      case "statement_block":
        return this.processBlock(statement, exitId, loopContext);
      case "expression_statement":
        return this.processExpressionStatement(statement, exitId);
      case "variable_declaration":
        return this.processVariableDeclaration(statement);
    }

    return this.processDefaultStatement(statement);
  }

  private processDefaultStatement(statement: SyntaxNode): ProcessResult {
    const nodeId = this.generateNodeId("stmt");

    // Create a safe, shorter label for complex statements
    let nodeText = statement.text.trim();

    // Remove problematic characters that break Mermaid
    nodeText = nodeText
      .replace(/\n/g, " ") // Replace newlines with spaces
      .replace(/\s+/g, " ") // Collapse multiple spaces
      .trim();

    // For certain statement types, create more descriptive labels
    if (statement.type === "expression_statement") {
      const expr = statement.namedChildren[0];
      if (expr) {
        switch (expr.type) {
          case "call_expression":
            const callee = expr.childForFieldName("function");
            if (callee) {
              // Clean function name to avoid problematic characters
              const funcName = callee.text.replace(/[[\]().]/g, "");
              nodeText = `Call ${funcName}`;
            } else {
              nodeText = "Function call";
            }
            break;
          case "assignment_expression":
            nodeText = "Assignment";
            break;
          default:
            nodeText =
              expr.text.length > 50
                ? expr.text.substring(0, 47) + "..."
                : expr.text;
        }
      }
    } else if (statement.type === "variable_declaration") {
      const declarators = statement.descendantsOfType("variable_declarator");
      if (declarators.length > 0) {
        const varName =
          declarators[0].childForFieldName("name")?.text || "variable";
        nodeText = `Declare ${varName}`;
      } else {
        nodeText = "Variable declaration";
      }
    }

    // Apply final length limit before escaping
    if (nodeText.length > 80) {
      nodeText = nodeText.substring(0, 77) + "...";
    }

    const nodes: FlowchartNode[] = [
      {
        id: nodeId,
        label: this.escapeString(nodeText),
        shape: "rect",
        style: this.nodeStyles.process,
      },
    ];

    this.locationMap.push({
      start: statement.startIndex,
      end: statement.endIndex,
      nodeId,
    });

    return {
      nodes,
      edges: [],
      entryNodeId: nodeId,
      exitPoints: [{ id: nodeId }],
      nodesConnectedToExit: new Set<string>(),
    };
  }

  private processIfStatement(
    statement: SyntaxNode,
    exitId: string,
    loopContext?: LoopContext
  ): ProcessResult {
    const condition = statement.childForFieldName("condition");

    // Create a safe condition text
    let conditionText = "condition";
    if (condition) {
      let rawText = condition.text.trim();
      // Clean up condition text - remove outer parentheses if present
      if (rawText.startsWith("(") && rawText.endsWith(")")) {
        rawText = rawText.slice(1, -1);
      }
      // Limit condition text length
      if (rawText.length > 60) {
        rawText = rawText.substring(0, 57) + "...";
      }
      // Clean up the text
      rawText = rawText.replace(/\n/g, " ").replace(/\s+/g, " ").trim();
      conditionText = rawText || "condition";
    }

    const conditionId = this.generateNodeId("if_cond");

    const nodes: FlowchartNode[] = [];
    const edges: FlowchartEdge[] = [];
    nodes.push({
      id: conditionId,
      label: this.escapeString(conditionText),
      shape: "diamond",
      style: this.nodeStyles.decision,
    });

    this.locationMap.push({
      start: statement.startIndex,
      end: statement.endIndex,
      nodeId: conditionId,
    });

    const exitPoints: { id: string; label?: string }[] = [];
    const nodesConnectedToExit = new Set<string>();

    // Process "then" branch
    const consequence = statement.childForFieldName("consequence");
    if (consequence) {
      // Always process through processBlock, regardless of whether it's a statement_block or single statement
      const thenResult = this.processBlock(consequence, exitId, loopContext);

      nodes.push(...thenResult.nodes);
      edges.push(...thenResult.edges);
      if (thenResult.entryNodeId) {
        edges.push({
          from: conditionId,
          to: thenResult.entryNodeId,
          label: "Yes",
        });
      }
      exitPoints.push(...thenResult.exitPoints);
      thenResult.nodesConnectedToExit.forEach((n) =>
        nodesConnectedToExit.add(n)
      );
    }

    // Process "else" branch if it exists
    const alternative = statement.childForFieldName("alternative");
    if (alternative) {
      // For TypeScript, the alternative might be an else_clause or another if_statement (else if)
      let elseBody = alternative;

      // If it's an else clause, get the body from it
      if (alternative.type === "else_clause") {
        elseBody =
          alternative.childForFieldName("body") || alternative.namedChildren[0];
      }

      if (elseBody) {
        // Always process through processBlock, regardless of type
        const elseResult = this.processBlock(elseBody, exitId, loopContext);

        nodes.push(...elseResult.nodes);
        edges.push(...elseResult.edges);
        if (elseResult.entryNodeId) {
          edges.push({
            from: conditionId,
            to: elseResult.entryNodeId,
            label: "No",
          });
        }
        exitPoints.push(...elseResult.exitPoints);
        elseResult.nodesConnectedToExit.forEach((n) =>
          nodesConnectedToExit.add(n)
        );
      }
    } else {
      // If no 'else', the "No" path from the condition is a valid exit from this structure.
      exitPoints.push({ id: conditionId, label: "No" });
    }

    return {
      nodes,
      edges,
      entryNodeId: conditionId,
      exitPoints,
      nodesConnectedToExit,
    };
  }

  private processForStatement(
    statement: SyntaxNode,
    exitId: string
  ): ProcessResult {
    const loopId = this.generateNodeId("for_loop");
    const afterLoopId = this.generateNodeId("after_for");

    // Create descriptive label for the for loop
    const initializer = statement.childForFieldName("initializer");
    const condition = statement.childForFieldName("condition");
    const increment = statement.childForFieldName("increment");

    let loopText = "for loop";
    if (initializer && condition) {
      // Clean up the text components
      const initText = initializer.text
        .trim()
        .substring(0, 15)
        .replace(/[;]/g, "");
      const condText = condition.text.trim().substring(0, 15);
      loopText = `for ${initText} while ${condText}`;
    }

    const nodes: FlowchartNode[] = [
      {
        id: loopId,
        label: this.escapeString(loopText),
        shape: "diamond",
        style: this.nodeStyles.decision,
      },
    ];

    this.locationMap.push({
      start: statement.startIndex,
      end: statement.endIndex,
      nodeId: loopId,
    });

    const loopContext: LoopContext = {
      breakTargetId: afterLoopId,
      continueTargetId: loopId,
    };

    const body = statement.childForFieldName("body");
    if (body) {
      // Always process the body through processBlock, regardless of whether it's a statement_block or single statement
      const bodyResult = this.processBlock(body, exitId, loopContext);

      nodes.push(...bodyResult.nodes);

      const edges: FlowchartEdge[] = [...bodyResult.edges];

      if (bodyResult.entryNodeId) {
        edges.push({
          from: loopId,
          to: bodyResult.entryNodeId,
          label: "True",
        });
      }

      // Connect exit points back to loop condition
      for (const exitPoint of bodyResult.exitPoints) {
        edges.push({
          from: exitPoint.id,
          to: loopId,
        });
      }

      return {
        nodes,
        edges,
        entryNodeId: loopId,
        exitPoints: [{ id: loopId, label: "False" }],
        nodesConnectedToExit: new Set<string>(),
      };
    }

    return {
      nodes,
      edges: [],
      entryNodeId: loopId,
      exitPoints: [{ id: loopId, label: "False" }],
      nodesConnectedToExit: new Set<string>(),
    };
  }

  private processForInStatement(
    statement: SyntaxNode,
    exitId: string
  ): ProcessResult {
    const loopId = this.generateNodeId("for_in_loop");

    const left = statement.childForFieldName("left");
    const right = statement.childForFieldName("right");

    let loopText = "for...in loop";
    if (left && right) {
      const leftText = left.text.trim();
      const rightText = right.text.trim().substring(0, 20);
      loopText = `for (${leftText} in ${rightText})`;
    }

    const nodes: FlowchartNode[] = [
      {
        id: loopId,
        label: this.escapeString(loopText),
        shape: "diamond",
        style: this.nodeStyles.decision,
      },
    ];

    this.locationMap.push({
      start: statement.startIndex,
      end: statement.endIndex,
      nodeId: loopId,
    });

    const loopContext: LoopContext = {
      breakTargetId: exitId,
      continueTargetId: loopId,
    };

    const body = statement.childForFieldName("body");
    if (body) {
      // Always process the body through processBlock, regardless of type
      const bodyResult = this.processBlock(body, exitId, loopContext);

      nodes.push(...bodyResult.nodes);

      const edges: FlowchartEdge[] = [...bodyResult.edges];
      if (bodyResult.entryNodeId) {
        edges.push({
          from: loopId,
          to: bodyResult.entryNodeId,
          label: "True",
        });
      }

      // Connect exit points back to loop condition
      for (const exitPoint of bodyResult.exitPoints) {
        edges.push({
          from: exitPoint.id,
          to: loopId,
        });
      }

      return {
        nodes,
        edges,
        entryNodeId: loopId,
        exitPoints: [{ id: loopId, label: "False" }],
        nodesConnectedToExit: new Set<string>(),
      };
    }

    return {
      nodes,
      edges: [],
      entryNodeId: loopId,
      exitPoints: [{ id: loopId, label: "False" }],
      nodesConnectedToExit: new Set<string>(),
    };
  }

  private processWhileStatement(
    statement: SyntaxNode,
    exitId: string
  ): ProcessResult {
    const loopId = this.generateNodeId("while_loop");

    const condition = statement.childForFieldName("condition");
    let conditionText = "while condition";
    if (condition) {
      let rawText = condition.text.trim();
      // Remove outer parentheses if present
      if (rawText.startsWith("(") && rawText.endsWith(")")) {
        rawText = rawText.slice(1, -1);
      }
      if (rawText.length > 40) {
        rawText = rawText.substring(0, 37) + "...";
      }
      conditionText = `while ${rawText}`;
    }

    const nodes: FlowchartNode[] = [
      {
        id: loopId,
        label: this.escapeString(conditionText),
        shape: "diamond",
        style: this.nodeStyles.decision,
      },
    ];

    this.locationMap.push({
      start: statement.startIndex,
      end: statement.endIndex,
      nodeId: loopId,
    });

    const loopContext: LoopContext = {
      breakTargetId: exitId,
      continueTargetId: loopId,
    };

    const body = statement.childForFieldName("body");
    if (body) {
      // Always process the body through processBlock, regardless of type
      const bodyResult = this.processBlock(body, exitId, loopContext);

      nodes.push(...bodyResult.nodes);

      const edges: FlowchartEdge[] = [...bodyResult.edges];
      if (bodyResult.entryNodeId) {
        edges.push({
          from: loopId,
          to: bodyResult.entryNodeId,
          label: "True",
        });
      }

      // Connect exit points back to loop condition
      for (const exitPoint of bodyResult.exitPoints) {
        edges.push({
          from: exitPoint.id,
          to: loopId,
        });
      }

      return {
        nodes,
        edges,
        entryNodeId: loopId,
        exitPoints: [{ id: loopId, label: "False" }],
        nodesConnectedToExit: new Set<string>(),
      };
    }

    return {
      nodes,
      edges: [],
      entryNodeId: loopId,
      exitPoints: [{ id: loopId, label: "False" }],
      nodesConnectedToExit: new Set<string>(),
    };
  }

  private processBlock(
    blockNode: SyntaxNode | null,
    exitId: string,
    loopContext?: LoopContext
  ): ProcessResult {
    if (!blockNode) {
      return {
        nodes: [],
        edges: [],
        entryNodeId: undefined,
        exitPoints: [],
        nodesConnectedToExit: new Set<string>(),
      };
    }

    // If it's not a statement_block, it's a single statement, so process it directly
    if (blockNode.type !== "statement_block") {
      return this.processStatement(blockNode, exitId, loopContext);
    }

    // Get all statements from the block, filtering out non-statement nodes
    const statements = blockNode.namedChildren.filter((child) => {
      // Filter out comments and other non-executable nodes
      return !["comment", "empty_statement"].includes(child.type);
    });

    if (statements.length === 0) {
      return {
        nodes: [],
        edges: [],
        entryNodeId: undefined,
        exitPoints: [],
        nodesConnectedToExit: new Set<string>(),
      };
    }

    const allNodes: FlowchartNode[] = [];
    const allEdges: FlowchartEdge[] = [];
    const nodesConnectedToExit = new Set<string>();
    let firstEntryNodeId: string | undefined;
    let lastExitPoints: { id: string; label?: string }[] = [];

    for (const statement of statements) {
      const result = this.processStatement(statement, exitId, loopContext);

      allNodes.push(...result.nodes);
      allEdges.push(...result.edges);
      result.nodesConnectedToExit.forEach((n) => nodesConnectedToExit.add(n));

      // Set the first entry node
      if (!firstEntryNodeId && result.entryNodeId) {
        firstEntryNodeId = result.entryNodeId;
      }

      // Connect previous statement exit points to current statement entry
      if (lastExitPoints.length > 0 && result.entryNodeId) {
        for (const exitPoint of lastExitPoints) {
          allEdges.push({
            from: exitPoint.id,
            to: result.entryNodeId,
            label: exitPoint.label,
          });
        }
      }

      lastExitPoints = result.exitPoints;
    }

    return {
      nodes: allNodes,
      edges: allEdges,
      entryNodeId: firstEntryNodeId,
      exitPoints: lastExitPoints,
      nodesConnectedToExit,
    };
  }

  private processReturnStatement(
    statement: SyntaxNode,
    exitId: string
  ): ProcessResult {
    const nodeId = this.generateNodeId("return_stmt");
    const nodeText = this.escapeString(statement.text);
    const nodes: FlowchartNode[] = [
      {
        id: nodeId,
        label: nodeText,
        shape: "stadium",
        style: this.nodeStyles.special,
      },
    ];
    const edges: FlowchartEdge[] = [{ from: nodeId, to: exitId }];

    this.locationMap.push({
      start: statement.startIndex,
      end: statement.endIndex,
      nodeId,
    });

    return {
      nodes,
      edges,
      entryNodeId: nodeId,
      exitPoints: [],
      nodesConnectedToExit: new Set<string>().add(nodeId),
    };
  }

  private processBreakStatement(
    statement: SyntaxNode,
    loopContext: LoopContext
  ): ProcessResult {
    const nodeId = this.generateNodeId("break_stmt");
    const nodes: FlowchartNode[] = [
      {
        id: nodeId,
        label: "break",
        shape: "stadium",
        style: this.nodeStyles.break,
      },
    ];
    const edges: FlowchartEdge[] = [
      { from: nodeId, to: loopContext.breakTargetId },
    ];

    this.locationMap.push({
      start: statement.startIndex,
      end: statement.endIndex,
      nodeId,
    });

    return {
      nodes,
      edges,
      entryNodeId: nodeId,
      exitPoints: [],
      nodesConnectedToExit: new Set<string>().add(nodeId),
    };
  }

  private processContinueStatement(
    statement: SyntaxNode,
    loopContext: LoopContext
  ): ProcessResult {
    const nodeId = this.generateNodeId("continue_stmt");
    const nodes: FlowchartNode[] = [
      {
        id: nodeId,
        label: "continue",
        shape: "stadium",
        style: this.nodeStyles.break,
      },
    ];
    const edges: FlowchartEdge[] = [
      { from: nodeId, to: loopContext.continueTargetId },
    ];

    this.locationMap.push({
      start: statement.startIndex,
      end: statement.endIndex,
      nodeId,
    });

    return {
      nodes,
      edges,
      entryNodeId: nodeId,
      exitPoints: [],
      nodesConnectedToExit: new Set<string>().add(nodeId),
    };
  }

  private processExpressionStatement(
    statement: SyntaxNode,
    exitId: string
  ): ProcessResult {
    // TODO: Handle await expressions, call expressions, etc.
    return this.processDefaultStatement(statement);
  }

  private processVariableDeclaration(statement: SyntaxNode): ProcessResult {
    // TODO: Handle ternary operators and complex initializers
    return this.processDefaultStatement(statement);
  }

  // Placeholder implementations for other statement types
  private processDoWhileStatement(
    statement: SyntaxNode,
    exitId: string
  ): ProcessResult {
    // TODO: Implement do-while loop processing
    return this.processDefaultStatement(statement);
  }

  private processTryStatement(
    statement: SyntaxNode,
    exitId: string,
    loopContext?: LoopContext
  ): ProcessResult {
    // TODO: Implement try-catch-finally processing
    return this.processDefaultStatement(statement);
  }

  private processSwitchStatement(
    statement: SyntaxNode,
    exitId: string,
    loopContext?: LoopContext
  ): ProcessResult {
    // TODO: Implement switch statement processing
    return this.processDefaultStatement(statement);
  }
}
