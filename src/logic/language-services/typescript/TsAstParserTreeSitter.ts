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
  firstNamedChild: SyntaxNode | null;
  childForFieldName(fieldName: string): SyntaxNode | null;
  descendantsOfType(type: string | string[]): SyntaxNode[];
  descendantForIndex(index: number): SyntaxNode | null;
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

interface FinallyContext {
    finallyEntryId: string;
}

// Helper to detect arrow function expression bodies
function isArrowFunctionExpressionBody(node: SyntaxNode): boolean {
  return node.parent?.type === 'arrow_function' &&
         node.parent.childForFieldName("body") === node &&
         node.type !== "statement_block";
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
  private static readonly MAX_NODES = 250;
  private static readonly MAX_FUNCTION_SIZE = 5000;
  private static readonly MAX_RECURSION_DEPTH = 50;
  private static readonly HOF_NAMES = ["map", "filter", "forEach", "reduce"];

  private readonly nodeStyles = {
    terminator: "fill:#eee,stroke:#000,stroke-width:4px,color:#000;",
    decision: "fill:#eee,stroke:#000,stroke-width:4px,color:#000;",
    process: "fill:#eee,stroke:#000,stroke-width:1px,color:#000;",
    special: "fill:#eee,stroke:#000,stroke-width:4px,color:#000",
    break: "fill:#eee,stroke:#000,stroke-width:2px,color:#000",
    hof: "fill:#e3f2fd,stroke:#0d47a1,stroke-width:1.5px,color:#000",
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
        const message = error instanceof Error ? error.message : "Unknown parsing error";
        return {
            nodes: [{
                id: "A",
                label: `TS Parse Error: ${message}`,
                shape: "rect"
            }],
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
    const functionTypes = [
      "function_declaration",
      "method_definition",
      "arrow_function",
      "function_expression",
    ];

    // Traverse up from the node at position to find nearest function
    let node: SyntaxNode | null = rootNode.descendantForIndex(position);
    while (node) {
      if (functionTypes.includes(node.type)) {
        return node;
      }
      node = node.parent;
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
      let parent = functionNode.parent;
      // Handle cases like `export default () => {}`
      if (parent?.type === 'export_statement') {
          parent = parent.parent;
      }
      if (parent?.type === "variable_declarator") {
        const nameNode = parent.childForFieldName("name");
        if (nameNode) {
          return nameNode.text;
        }
      }
    }

    return "[anonymous]";
  }

  // Modified getFunctionBody to handle concise arrow function bodies
  private getFunctionBody(functionNode: SyntaxNode): SyntaxNode | null {
      if (functionNode.type === "arrow_function") {
          return functionNode.childForFieldName("body");
      }
      return functionNode.childForFieldName("body");
  }


  private isHofCall(node: SyntaxNode | null): boolean {
    if (!node || node.type !== "call_expression") return false;

    const memberAccess = node.childForFieldName("function");
    if (memberAccess?.type !== "member_expression") return false;

    const functionName = memberAccess.childForFieldName("property")?.text;
    return !!functionName && TsAstParserTreeSitter.HOF_NAMES.includes(functionName);
  }

  private processStatementList(
    bodyNode: SyntaxNode,
    exitId: string,
    loopContext?: LoopContext,
    finallyContext?: FinallyContext
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
    let entryNodeId: string | undefined;
    const nodesConnectedToExit = new Set<string>();
    let lastExitPoints: { id: string; label?: string }[] = [];

    const statements = bodyNode.namedChildren;

    if (statements.length === 0) {
        // Handle empty body or single expression body
        if (isArrowFunctionExpressionBody(bodyNode)) {
            return this.processReturnStatementForExpression(bodyNode, exitId, finallyContext);
        }

        this.recursionDepth--;
        return {
            nodes: [],
            edges: [],
            exitPoints: [],
            nodesConnectedToExit,
        };
    }

    for (const statement of statements) {
      if (this.shouldTerminateEarly) break;

      // Added explicit handling for expression bodies in arrow functions
      let result;
      if (isArrowFunctionExpressionBody(statement)) {
          result = this.processReturnStatementForExpression(statement, exitId, finallyContext);
      } else {
          result = this.processStatement(statement, exitId, loopContext, finallyContext);
      }

      nodes.push(...result.nodes);
      edges.push(...result.edges);

      if (lastExitPoints.length > 0 && result.entryNodeId) {
        // Connect the exits of the previous statement to the entry of the current one.
        lastExitPoints.forEach((exitPoint) => {
            edges.push({
              from: exitPoint.id,
              to: result.entryNodeId!,
              label: exitPoint.label,
            });
        });
      } else if (!entryNodeId) {
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
    loopContext?: LoopContext,
    finallyContext?: FinallyContext
  ): ProcessResult {
    switch (statement.type) {
      case "if_statement":
        return this.processIfStatement(statement, exitId, loopContext, finallyContext);
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
        return this.processSwitchStatement(statement, exitId);
      case "return_statement":
        return this.processReturnStatement(statement, exitId, finallyContext);
      case "throw_statement":
          return this.processThrowStatement(statement, exitId, finallyContext);
      case "break_statement":
        if (loopContext) {
          return this.processBreakStatement(statement, loopContext, finallyContext);
        }
        break;
      case "continue_statement":
        if (loopContext) {
          return this.processContinueStatement(statement, loopContext, finallyContext);
        }
        break;
      case "statement_block":
        return this.processBlock(statement, exitId, loopContext, finallyContext);
      case "expression_statement":
        return this.processExpressionStatement(statement);
      case "lexical_declaration": // let, const
      case "variable_declaration": // var
        const declarator = statement.namedChildren[0];
        if (declarator) {
            return this.processVariableDeclaration(declarator);
        }
        break;
    }

    return this.processDefaultStatement(statement);
  }

  private processDefaultStatement(statement: SyntaxNode): ProcessResult {
    const nodeId = this.generateNodeId("stmt");
    let nodeText = statement.text.trim();

    nodeText = nodeText
      .replace(/\n/g, " ")
      .replace(/\s+/g, " ")
      .trim();

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
    loopContext?: LoopContext,
    finallyContext?: FinallyContext
  ): ProcessResult {
    const condition = statement.childForFieldName("condition");

    let conditionText = "condition";
    if (condition) {
      let rawText = condition.text.trim();
      if (rawText.startsWith("(") && rawText.endsWith(")")) {
        rawText = rawText.slice(1, -1);
      }
      if (rawText.length > 60) {
        rawText = rawText.substring(0, 57) + "...";
      }
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

    const consequence = statement.childForFieldName("consequence");
    if (consequence) {
      const thenResult = this.processBlock(consequence, exitId, loopContext, finallyContext);

      nodes.push(...thenResult.nodes);
      edges.push(...thenResult.edges);
      if (thenResult.entryNodeId) {
        edges.push({
          from: conditionId,
          to: thenResult.entryNodeId,
          label: "Yes",
        });
      } else {
         exitPoints.push({id: conditionId, label: 'Yes'});
      }
      exitPoints.push(...thenResult.exitPoints);
      thenResult.nodesConnectedToExit.forEach((n) =>
        nodesConnectedToExit.add(n)
      );
    }

    const alternative = statement.childForFieldName("alternative");
    if (alternative) {
      // The alternative is an `else_clause` which contains either an `if_statement` (else if) or a `statement_block` (else)
      const elseBody = alternative.namedChildren[0];
      if (elseBody) {
        const elseResult = this.processStatement(elseBody, exitId, loopContext, finallyContext);

        nodes.push(...elseResult.nodes);
        edges.push(...elseResult.edges);
        if (elseResult.entryNodeId) {
          edges.push({
            from: conditionId,
            to: elseResult.entryNodeId,
            label: "No",
          });
        } else {
           exitPoints.push({id: conditionId, label: 'No'});
        }
        exitPoints.push(...elseResult.exitPoints);
        elseResult.nodesConnectedToExit.forEach((n) =>
          nodesConnectedToExit.add(n)
        );
      }
    } else {
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

    const initializer = statement.childForFieldName("initializer");
    const condition = statement.childForFieldName("condition");

    let loopText = "for loop";
    if (condition) {
      loopText = `for (${initializer?.text ?? ''}; ${condition.text}; ...)`
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

      for (const exitPoint of bodyResult.exitPoints) {
        edges.push({ from: exitPoint.id, to: loopId });
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

    // Find the 'in' or 'of' keyword
    let keyword = 'in/of';
    const keywordNode = statement.namedChildren.find(n => n.type === 'in' || n.type === 'of');
    if (keywordNode) {
        keyword = keywordNode.text;
    }


    let loopText = "for...in/of loop";
    if (left && right) {
      loopText = `for (${left.text} ${keyword} ${right.text})`;
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
      const bodyResult = this.processBlock(body, exitId, loopContext);
      nodes.push(...bodyResult.nodes);
      const edges: FlowchartEdge[] = [...bodyResult.edges];

      if (bodyResult.entryNodeId) {
        edges.push({ from: loopId, to: bodyResult.entryNodeId, label: "Loop" });
      }

      for (const exitPoint of bodyResult.exitPoints) {
        edges.push({ from: exitPoint.id, to: loopId });
      }

      return {
        nodes,
        edges,
        entryNodeId: loopId,
        exitPoints: [{ id: loopId, label: "End Loop" }],
        nodesConnectedToExit: bodyResult.nodesConnectedToExit,
      };
    }

    return {
      nodes,
      edges: [],
      entryNodeId: loopId,
      exitPoints: [{ id: loopId, label: "End Loop" }],
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
      conditionText = `while ${condition.text}`;
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
      const bodyResult = this.processBlock(body, exitId, loopContext);
      nodes.push(...bodyResult.nodes);
      const edges: FlowchartEdge[] = [...bodyResult.edges];

      if (bodyResult.entryNodeId) {
        edges.push({ from: loopId, to: bodyResult.entryNodeId, label: "True" });
      }

      for (const exitPoint of bodyResult.exitPoints) {
        edges.push({ from: exitPoint.id, to: loopId });
      }

      return {
        nodes,
        edges,
        entryNodeId: loopId,
        exitPoints: [{ id: loopId, label: "False" }],
        nodesConnectedToExit: bodyResult.nodesConnectedToExit,
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

    private processDoWhileStatement(
      statement: SyntaxNode,
      exitId: string
    ): ProcessResult {
        const body = statement.childForFieldName("body");
        const condition = statement.childForFieldName("condition");

        if (!body) return { nodes: [], edges: [], exitPoints: [], nodesConnectedToExit: new Set() };

        const bodyResult = this.processBlock(body, exitId);

        const conditionId = this.generateNodeId("do_while_cond");
        const nodes = [...bodyResult.nodes];
        nodes.push({
            id: conditionId,
            label: this.escapeString(condition?.text ?? "condition"),
            shape: "diamond",
            style: this.nodeStyles.decision,
        });

        const edges = [...bodyResult.edges];
        // Connect body exits to the condition
        for (const exitPoint of bodyResult.exitPoints) {
            edges.push({ from: exitPoint.id, to: conditionId });
        }

        // Loop back to the body if condition is true
        if (bodyResult.entryNodeId) {
            edges.push({ from: conditionId, to: bodyResult.entryNodeId, label: "True" });
        }

        return {
            nodes,
            edges,
            entryNodeId: bodyResult.entryNodeId,
            exitPoints: [{ id: conditionId, label: "False" }],
            nodesConnectedToExit: new Set<string>(),
        };
    }

  private processBlock(
    blockNode: SyntaxNode | null,
    exitId: string,
    loopContext?: LoopContext,
    finallyContext?: FinallyContext,
  ): ProcessResult {
    if (!blockNode) {
      return { nodes: [], edges: [], exitPoints: [], nodesConnectedToExit: new Set() };
    }

    if (blockNode.type !== "statement_block") {
      return this.processStatement(blockNode, exitId, loopContext, finallyContext);
    }

    return this.processStatementList(blockNode, exitId, loopContext, finallyContext);
  }

  private processReturnStatement(
    statement: SyntaxNode,
    exitId: string,
    finallyContext?: FinallyContext
  ): ProcessResult {
      const valueNode = statement.firstNamedChild;
      if (valueNode) {
          const exprResult = this.processExpression(valueNode);
          if (exprResult) {
              const returnId = this.generateNodeId("return");
              exprResult.nodes.push({
                  id: returnId,
                  label: "return",
                  shape: "stadium",
                  style: this.nodeStyles.special,
              });
              this.locationMap.push({ start: statement.startIndex, end: statement.endIndex, nodeId: returnId });

              exprResult.exitPoints.forEach(ep => {
                  exprResult.edges.push({ from: ep.id, to: returnId, label: ep.label });
              });
              const targetId = finallyContext ? finallyContext.finallyEntryId : exitId;
              exprResult.edges.push({ from: returnId, to: targetId });

              return {
                  ...exprResult,
                  exitPoints: [],
                  nodesConnectedToExit: new Set<string>([returnId])
              };
          }
      }

      const nodeId = this.generateNodeId("return_stmt");
      const nodeText = this.escapeString(statement.text);
      const nodes: FlowchartNode[] = [
          { id: nodeId, label: nodeText, shape: "stadium", style: this.nodeStyles.special, }
      ];
      const targetId = finallyContext ? finallyContext.finallyEntryId : exitId;
      const edges: FlowchartEdge[] = [{ from: nodeId, to: targetId }];

      this.locationMap.push({ start: statement.startIndex, end: statement.endIndex, nodeId });

      return {
          nodes, edges, entryNodeId: nodeId, exitPoints: [], nodesConnectedToExit: new Set<string>().add(nodeId),
      };
  }

    private processReturnStatementForExpression(
      exprNode: SyntaxNode,
      exitId: string,
      finallyContext?: FinallyContext
    ): ProcessResult {
        const result = this.processExpression(exprNode);
        if (result) {
            const returnId = this.generateNodeId("return_expr");
            result.nodes.push({
                id: returnId,
                label: 'return value',
                shape: 'stadium',
                style: this.nodeStyles.special,
            });

            const targetId = finallyContext ? finallyContext.finallyEntryId : exitId;
            result.exitPoints.forEach(ep => {
                result.edges.push({ from: ep.id, to: returnId, label: ep.label });
            });
            result.edges.push({ from: returnId, to: targetId });

            result.exitPoints = [];
            if(result.nodesConnectedToExit) {
                result.nodesConnectedToExit.add(returnId);
            }
            return result;
        }
        return this.processDefaultStatement(exprNode);
    }

    private processThrowStatement(
        statement: SyntaxNode,
        exitId: string,
        finallyContext?: FinallyContext
    ): ProcessResult {
        const nodeId = this.generateNodeId("throw_stmt");
        const nodeText = this.escapeString(statement.text);
        const nodes: FlowchartNode[] = [
            { id: nodeId, label: nodeText, shape: "stadium", style: this.nodeStyles.special }
        ];
        const targetId = finallyContext ? finallyContext.finallyEntryId : exitId;
        const edges: FlowchartEdge[] = [{ from: nodeId, to: targetId }];

        this.locationMap.push({ start: statement.startIndex, end: statement.endIndex, nodeId });

        return {
            nodes, edges, entryNodeId: nodeId, exitPoints: [], nodesConnectedToExit: new Set<string>([nodeId])
        };
    }

    private processBreakStatement(
        statement: SyntaxNode,
        loopContext: LoopContext,
        finallyContext?: FinallyContext
    ): ProcessResult {
        const nodeId = this.generateNodeId("break_stmt");
        const nodes: FlowchartNode[] = [
            { id: nodeId, label: "break", shape: "stadium", style: this.nodeStyles.break }
        ];

        // If in a try block with a finally, must go to finally before breaking.
        const targetId = finallyContext ? finallyContext.finallyEntryId : loopContext.breakTargetId;
        const edges: FlowchartEdge[] = [{ from: nodeId, to: targetId }];

        this.locationMap.push({ start: statement.startIndex, end: statement.endIndex, nodeId });
        return { nodes, edges, entryNodeId: nodeId, exitPoints: [], nodesConnectedToExit: new Set<string>([nodeId]) };
    }

    private processContinueStatement(
        statement: SyntaxNode,
        loopContext: LoopContext,
        finallyContext?: FinallyContext
    ): ProcessResult {
        const nodeId = this.generateNodeId("continue_stmt");
        const nodes: FlowchartNode[] = [
            { id: nodeId, label: "continue", shape: "stadium", style: this.nodeStyles.break }
        ];

        // If in a try block with a finally, must go to finally before continuing.
        const targetId = finallyContext ? finallyContext.finallyEntryId : loopContext.continueTargetId;
        const edges: FlowchartEdge[] = [{ from: nodeId, to: targetId }];

        this.locationMap.push({ start: statement.startIndex, end: statement.endIndex, nodeId });
        return { nodes, edges, entryNodeId: nodeId, exitPoints: [], nodesConnectedToExit: new Set<string>([nodeId]) };
    }

    private processExpression(expression: SyntaxNode): ProcessResult | null {
        switch(expression.type) {
            case "call_expression":
                if (this.isHofCall(expression)) {
                    return this.processHigherOrderFunctionCall(expression);
                }
                const memberAccess = expression.childForFieldName("function");
                if (memberAccess?.type === 'member_expression' && ['then', 'catch', 'finally'].includes(memberAccess.childForFieldName('property')?.text ?? '')) {
                    return this.processPromiseChain(expression);
                }
                return this.processDefaultStatement(expression);
            case "await_expression":
                return this.processAwaitExpression(expression);
            default:
                return null; // Let the caller handle it.
        }
    }

    private processExpressionStatement(statement: SyntaxNode): ProcessResult {
        const expression = statement.firstNamedChild;
        if (expression) {
            const result = this.processExpression(expression);
            if (result) return result;
        }
        return this.processDefaultStatement(statement);
    }

    private processVariableDeclaration(declarator: SyntaxNode): ProcessResult {
        const valueNode = declarator?.childForFieldName("value");

        if (valueNode) {
            const result = this.processExpression(valueNode);
            if (result) {
                // Prepend a node for the variable assignment
                const varName = declarator.childForFieldName("name")?.text;
                const assignId = this.generateNodeId("assign");
                result.nodes.unshift({
                    id: assignId,
                    label: `let ${varName} = ...`,
                    shape: 'rect',
                    style: this.nodeStyles.process
                });

                if (result.entryNodeId) {
                    result.edges.unshift({ from: assignId, to: result.entryNodeId });
                }
                result.entryNodeId = assignId;
                return result;
            }
        }
        return this.processDefaultStatement(declarator);
    }

    private processAwaitExpression(awaitNode: SyntaxNode): ProcessResult {
      const nodeId = this.generateNodeId("await");
      const nodes: FlowchartNode[] = [
        {
          id: nodeId,
          // Improved labeling
          label: `await ${this.escapeString(awaitNode.firstNamedChild?.text || 'promise')}`,
          shape: "rect",
          style: this.nodeStyles.process,
        },
      ];
      // Added location mapping
      this.locationMap.push({ start: awaitNode.startIndex, end: awaitNode.endIndex, nodeId });

      return {
        nodes,
        edges: [],
        entryNodeId: nodeId,
        exitPoints: [{ id: nodeId }],
        nodesConnectedToExit: new Set<string>()
      };
    }

    // in class TsAstParserTreeSitter

private processPromiseChain(callNode: SyntaxNode): ProcessResult {
    const allNodes: FlowchartNode[] = [];
    const allEdges: FlowchartEdge[] = [];
    const nodesConnectedToExit = new Set<string>();

    let currentNode: SyntaxNode | null = callNode;
    let chain: SyntaxNode[] = [];

    // Corrected loop to walk up the promise chain
    while (currentNode?.type === 'call_expression') {
        const member = currentNode.childForFieldName('function');
        if (member?.type === 'member_expression') {
            chain.unshift(currentNode);
            currentNode = member.childForFieldName('object');
        } else {
            // Reached the initial call (e.g., fetch()), which is not a member expression.
            break;
        }
    }

    // Add the initial call (which is the final currentNode) to the front of the chain.
    if (currentNode) {
        chain.unshift(currentNode);
    }

    // Add limit for promise chain nodes
    if (chain.length > 5) {
      const truncatedId = this.generateNodeId("prom_trunc");
      return {
        nodes: [{
          id: truncatedId,
          label: "Promise chain too long",
          shape: "rect",
          style: this.nodeStyles.special
        }],
        edges: [],
        entryNodeId: truncatedId,
        exitPoints: [{ id: truncatedId }],
        nodesConnectedToExit: new Set()
      };
    }

    const initialCall = chain[0];
    if (!initialCall) return this.processDefaultStatement(callNode);

    const initialResult = this.processExpression(initialCall) ?? this.processDefaultStatement(initialCall);
    allNodes.push(...initialResult.nodes);
    allEdges.push(...initialResult.edges);

    let lastSuccessExit = initialResult.exitPoints[0]?.id;
    let potentialRejectionSources: string[] = lastSuccessExit ? [lastSuccessExit] : [];
    const entryNodeId = initialResult.entryNodeId;

    // Process the .then, .catch, .finally chain (starts from the second link)
    for (let i = 1; i < chain.length; i++) {
        const chainLink = chain[i];
        const member = chainLink.childForFieldName('function');
        const propName = member?.childForFieldName('property')?.text;

        const nodeId = this.generateNodeId(propName ?? 'promise');
        const argText = chainLink.childForFieldName('arguments')?.text ?? '()';
        allNodes.push({
            id: nodeId,
            label: `.${propName}${this.escapeString(argText)}`,
            shape: 'rect',
            style: this.nodeStyles.process,
        });
        this.locationMap.push({ start: chainLink.startIndex, end: chainLink.endIndex, nodeId });

        if (propName === 'then') {
            if (lastSuccessExit) {
                allEdges.push({ from: lastSuccessExit, to: nodeId, label: 'onFulfilled' });
            }
            lastSuccessExit = nodeId;
            potentialRejectionSources.push(lastSuccessExit);
        } else if (propName === 'catch') {
            potentialRejectionSources.forEach(sourceId => {
                allEdges.push({ from: sourceId, to: nodeId, label: 'onRejected' });
            });
            lastSuccessExit = nodeId;
            potentialRejectionSources = [lastSuccessExit];
        } else if (propName === 'finally') {
            if (lastSuccessExit) {
                allEdges.push({ from: lastSuccessExit, to: nodeId });
            }
            potentialRejectionSources.forEach(sourceId => {
                allEdges.push({ from: sourceId, to: nodeId });
            });
            lastSuccessExit = nodeId;
            potentialRejectionSources = [lastSuccessExit];
        }
    }

    const exitPoints = lastSuccessExit ? [{ id: lastSuccessExit }] : [];

    return {
        nodes: allNodes,
        edges: allEdges,
        entryNodeId,
        exitPoints,
        nodesConnectedToExit
    };
}

    private processTryStatement(
        statement: SyntaxNode,
        exitId: string,
        loopContext?: LoopContext
    ): ProcessResult {
        const allNodes: FlowchartNode[] = [];
        const allEdges: FlowchartEdge[] = [];
        const nodesConnectedToExit = new Set<string>();
        let allExitPoints: { id: string; label?: string }[] = [];

        const tryBlock = statement.childForFieldName("body");
        const catchClause = statement.childForFieldName("catch_clause");
        const finallyClause = statement.childForFieldName("finally_clause");

        const entryId = this.generateNodeId("try_entry");
        allNodes.push({ id: entryId, label: "try", shape: "stadium" });

        let finallyResult: ProcessResult | undefined;
        let finallyContext: FinallyContext | undefined;

        if (finallyClause) {
            const finallyBlock = finallyClause.namedChildren[0];
            if (finallyBlock) {
                finallyResult = this.processBlock(finallyBlock, exitId, loopContext);
                if (finallyResult.entryNodeId) {
                    allNodes.push(...finallyResult.nodes);
                    allEdges.push(...finallyResult.edges);
                    finallyResult.nodesConnectedToExit.forEach(n => nodesConnectedToExit.add(n));
                    finallyContext = { finallyEntryId: finallyResult.entryNodeId };
                    allExitPoints.push(...finallyResult.exitPoints);
                }
            }
        }

        if (tryBlock) {
            const tryResult = this.processBlock(tryBlock, exitId, loopContext, finallyContext);
            allNodes.push(...tryResult.nodes);
            allEdges.push(...tryResult.edges);
            tryResult.nodesConnectedToExit.forEach(n => nodesConnectedToExit.add(n));

            if (tryResult.entryNodeId) {
                allEdges.push({ from: entryId, to: tryResult.entryNodeId });
            } else if (finallyContext) {
                allEdges.push({ from: entryId, to: finallyContext.finallyEntryId });
            } else {
                allExitPoints.push({ id: entryId });
            }

            tryResult.exitPoints.forEach(ep => {
                if (finallyContext) {
                    allEdges.push({ from: ep.id, to: finallyContext.finallyEntryId, label: ep.label });
                } else {
                    allExitPoints.push(ep);
                }
            });
        }


        if (catchClause) {
            const catchBlock = catchClause.childForFieldName("body");
            if (catchBlock) {
                const catchResult = this.processBlock(catchBlock, exitId, loopContext, finallyContext);
                allNodes.push(...catchResult.nodes);
                allEdges.push(...catchResult.edges);
                catchResult.nodesConnectedToExit.forEach(n => nodesConnectedToExit.add(n));

                if (catchResult.entryNodeId) {
                    const paramNode = catchClause.firstNamedChild;
                    const param = paramNode?.type === 'variable_declarator' ? `on ${paramNode.text}` : 'on error';
                    allEdges.push({ from: entryId, to: catchResult.entryNodeId, label: param });

                    catchResult.exitPoints.forEach(ep => {
                        if (finallyContext) {
                            allEdges.push({ from: ep.id, to: finallyContext.finallyEntryId, label: ep.label });
                        } else {
                            allExitPoints.push(ep);
                        }
                    });
                }
            }
        }

        return {
            nodes: allNodes, edges: allEdges, entryNodeId: entryId, exitPoints: allExitPoints, nodesConnectedToExit,
        };
    }

  private processSwitchStatement(
    statement: SyntaxNode,
    exitId: string,
  ): ProcessResult {
    const valueNode = statement.childForFieldName('value');
    const bodyNode = statement.childForFieldName('body');
    if (!valueNode || !bodyNode) return this.processDefaultStatement(statement);

    const switchEntryId = this.generateNodeId("switch_entry");
    const nodes: FlowchartNode[] = [{
        id: switchEntryId,
        label: `switch (${this.escapeString(valueNode.text)})`,
        shape: 'rect',
        style: this.nodeStyles.process,
    }];
    const edges: FlowchartEdge[] = [];
    const nodesConnectedToExit = new Set<string>();
    const allExitPoints: {id: string, label?: string}[] = [];
    let lastConditionExitId = switchEntryId;

    const caseClauses = bodyNode.namedChildren.filter(c => c.type === 'switch_case');

    for (const clause of caseClauses) {
        const caseValueNode = clause.childForFieldName('value');
        if (!caseValueNode) continue; // default case

        const caseConditionId = this.generateNodeId('case_cond');
        nodes.push({
            id: caseConditionId,
            label: `case ${this.escapeString(caseValueNode.text)}`,
            shape: 'diamond',
            style: this.nodeStyles.decision,
        });
        edges.push({ from: lastConditionExitId, to: caseConditionId });

        const caseBodyResult = this.processStatementList(clause, exitId, {breakTargetId: exitId, continueTargetId: ''});
        nodes.push(...caseBodyResult.nodes);
        edges.push(...caseBodyResult.edges);
        caseBodyResult.nodesConnectedToExit.forEach(n => nodesConnectedToExit.add(n));

        if (caseBodyResult.entryNodeId) {
            edges.push({ from: caseConditionId, to: caseBodyResult.entryNodeId, label: 'True'});
        }
        allExitPoints.push(...caseBodyResult.exitPoints);

        lastConditionExitId = caseConditionId; // Next case comes from the 'False' path of this one
    }

    const defaultClause = bodyNode.namedChildren.find(c => c.type === 'switch_default');
    if (defaultClause) {
        const defaultResult = this.processStatementList(defaultClause, exitId, {breakTargetId: exitId, continueTargetId: ''});
        nodes.push(...defaultResult.nodes);
        edges.push(...defaultResult.edges);
        defaultResult.nodesConnectedToExit.forEach(n => nodesConnectedToExit.add(n));
        if (defaultResult.entryNodeId) {
            edges.push({ from: lastConditionExitId, to: defaultResult.entryNodeId, label: 'default'});
        }
        allExitPoints.push(...defaultResult.exitPoints);
    } else {
        allExitPoints.push({id: lastConditionExitId, label: 'False'});
    }


    return {
        nodes,
        edges,
        entryNodeId: switchEntryId,
        exitPoints: allExitPoints,
        nodesConnectedToExit,
    };
  }

    private processHigherOrderFunctionCall(callNode: SyntaxNode): ProcessResult | null {
        const memberExpr = callNode.childForFieldName("function");
        const functionName = memberExpr?.childForFieldName("property")?.text;

        switch (functionName) {
            case "map":
              return this.processMap(callNode);
            case "filter":
              return this.processFilter(callNode);
            case "forEach":
              return this.processForEach(callNode);
            case "reduce":
              return this.processReduce(callNode);
            default:
              return null;
        }
    }

    private processMap(callNode: SyntaxNode): ProcessResult {
        const args = callNode.childForFieldName("arguments")?.namedChildren || [];
        if (args.length < 1) return this.processDefaultStatement(callNode);

        const [functionArg] = args;
        const memberExpr = callNode.childForFieldName("function");
        const iterableNode = memberExpr?.childForFieldName("object");

        const functionText = this.escapeString(functionArg.text);
        const lambdaBodyText = functionArg.type === "arrow_function" && functionArg.childForFieldName("body")
            ? this.escapeString(functionArg.childForFieldName("body")!.text)
            : `${functionText}(item)`;

        const nodes: FlowchartNode[] = [];
        const edges: FlowchartEdge[] = [];

        const mapHeaderId = this.generateNodeId("map_header");
        nodes.push({
            id: mapHeaderId,
            label: `For each item in ${this.escapeString(iterableNode?.text ?? 'array')}`,
            shape: "diamond",
            style: this.nodeStyles.hof,
        });
        this.locationMap.push({ start: callNode.startIndex, end: callNode.endIndex, nodeId: mapHeaderId });

        const applyId = this.generateNodeId("map_apply");
        nodes.push({
            id: applyId,
            label: `Apply: ${lambdaBodyText}`,
            shape: "rect",
            style: this.nodeStyles.process,
        });
        this.locationMap.push({ start: functionArg.startIndex, end: functionArg.endIndex, nodeId: applyId });
        edges.push({ from: mapHeaderId, to: applyId, label: "Loop" });

        const collectId = this.generateNodeId("map_collect");
        nodes.push({
            id: collectId,
            label: "Collect result",
            shape: "rect",
            style: this.nodeStyles.process,
        });
        edges.push({ from: applyId, to: collectId });
        edges.push({ from: collectId, to: mapHeaderId });

        return {
            nodes,
            edges,
            entryNodeId: mapHeaderId,
            exitPoints: [{ id: mapHeaderId, label: "End Loop" }],
            nodesConnectedToExit: new Set<string>(),
        };
    }

    private processFilter(callNode: SyntaxNode): ProcessResult {
        const args = callNode.childForFieldName("arguments")?.namedChildren || [];
        if (args.length < 1) return this.processDefaultStatement(callNode);

        const [functionArg] = args;
        const memberExpr = callNode.childForFieldName("function");
        const iterableNode = memberExpr?.childForFieldName("object");

        const functionText = this.escapeString(functionArg.text);
        const conditionText = functionArg.type === "arrow_function" && functionArg.childForFieldName("body")
            ? this.escapeString(functionArg.childForFieldName("body")!.text)
            : `${functionText}(item)`;

        const nodes: FlowchartNode[] = [];
        const edges: FlowchartEdge[] = [];

        const filterHeaderId = this.generateNodeId("filter_header");
        nodes.push({
            id: filterHeaderId,
            label: `For each item in ${this.escapeString(iterableNode?.text ?? 'array')}`,
            shape: "diamond",
            style: this.nodeStyles.hof,
        });
        this.locationMap.push({ start: callNode.startIndex, end: callNode.endIndex, nodeId: filterHeaderId });

        const conditionId = this.generateNodeId("filter_cond");
        nodes.push({
            id: conditionId,
            label: `If ${conditionText}`,
            shape: "diamond",
            style: this.nodeStyles.decision,
        });
        this.locationMap.push({ start: functionArg.startIndex, end: functionArg.endIndex, nodeId: conditionId });
        edges.push({ from: filterHeaderId, to: conditionId, label: "Loop" });

        const collectId = this.generateNodeId("filter_collect");
        nodes.push({
            id: collectId,
            label: "Keep item",
            shape: "rect",
            style: this.nodeStyles.process,
        });
        edges.push({ from: conditionId, to: collectId, label: "True" });
        edges.push({ from: collectId, to: filterHeaderId });
        edges.push({ from: conditionId, to: filterHeaderId, label: "False" });


        return {
            nodes,
            edges,
            entryNodeId: filterHeaderId,
            exitPoints: [{ id: filterHeaderId, label: "End Loop" }],
            nodesConnectedToExit: new Set<string>(),
        };
    }
    
    private processForEach(callNode: SyntaxNode): ProcessResult {
        const args = callNode.childForFieldName("arguments")?.namedChildren || [];
        if (args.length < 1) return this.processDefaultStatement(callNode);

        const [functionArg] = args;
        const memberExpr = callNode.childForFieldName("function");
        const iterableNode = memberExpr?.childForFieldName("object");

        const functionText = this.escapeString(functionArg.text);
        const actionText = functionArg.type === "arrow_function" && functionArg.childForFieldName("body")
            ? this.escapeString(functionArg.childForFieldName("body")!.text)
            : `${functionText}(item)`;

        const nodes: FlowchartNode[] = [];
        const edges: FlowchartEdge[] = [];

        const forEachHeaderId = this.generateNodeId("forEach_header");
        nodes.push({
            id: forEachHeaderId,
            label: `For each item in ${this.escapeString(iterableNode?.text ?? 'array')}`,
            shape: "diamond",
            style: this.nodeStyles.hof,
        });
        this.locationMap.push({ start: callNode.startIndex, end: callNode.endIndex, nodeId: forEachHeaderId });

        const applyId = this.generateNodeId("forEach_apply");
        nodes.push({
            id: applyId,
            label: `Execute: ${actionText}`,
            shape: "rect",
            style: this.nodeStyles.process,
        });
        this.locationMap.push({ start: functionArg.startIndex, end: functionArg.endIndex, nodeId: applyId });
        edges.push({ from: forEachHeaderId, to: applyId, label: "Loop" });
        edges.push({ from: applyId, to: forEachHeaderId });

        return {
            nodes,
            edges,
            entryNodeId: forEachHeaderId,
            exitPoints: [{ id: forEachHeaderId, label: "End Loop" }],
            nodesConnectedToExit: new Set<string>(),
        };
    }
    
    private processReduce(callNode: SyntaxNode): ProcessResult {
        const args = callNode.childForFieldName("arguments")?.namedChildren || [];
        if (args.length < 1) return this.processDefaultStatement(callNode);

        const [functionArg, initialValueNode] = args;
        const memberExpr = callNode.childForFieldName("function");
        const iterableNode = memberExpr?.childForFieldName("object");

        const functionText = this.escapeString(functionArg.text);
        const reduceLogicText = functionArg.type === "arrow_function" && functionArg.childForFieldName("body")
            ? this.escapeString(functionArg.childForFieldName("body")!.text)
            : `${functionText}(acc, item)`;

        const nodes: FlowchartNode[] = [];
        const edges: FlowchartEdge[] = [];
        let lastNodeId: string | undefined;

        if (initialValueNode) {
            const initId = this.generateNodeId("reduce_init");
            nodes.push({
                id: initId,
                label: `acc = ${this.escapeString(initialValueNode.text)}`,
                shape: "rect",
                style: this.nodeStyles.process,
            });
            lastNodeId = initId;
        }

        const reduceHeaderId = this.generateNodeId("reduce_header");
        nodes.push({
            id: reduceHeaderId,
            label: `For each item in ${this.escapeString(iterableNode?.text ?? 'array')}`,
            shape: "diamond",
            style: this.nodeStyles.hof,
        });
        this.locationMap.push({ start: callNode.startIndex, end: callNode.endIndex, nodeId: reduceHeaderId });

        if(lastNodeId) {
            edges.push({ from: lastNodeId, to: reduceHeaderId });
        }

        const applyId = this.generateNodeId("reduce_apply");
        nodes.push({
            id: applyId,
            label: `acc = ${reduceLogicText}`,
            shape: "rect",
            style: this.nodeStyles.process,
        });
        this.locationMap.push({ start: functionArg.startIndex, end: functionArg.endIndex, nodeId: applyId });
        edges.push({ from: reduceHeaderId, to: applyId, label: "Loop" });
        edges.push({ from: applyId, to: reduceHeaderId });

        const entryNodeId = lastNodeId ? lastNodeId : reduceHeaderId;

        return {
            nodes,
            edges,
            entryNodeId: entryNodeId,
            exitPoints: [{ id: reduceHeaderId, label: "End Loop" }],
            nodesConnectedToExit: new Set<string>(),
        };
    }
}
