import Parser from "tree-sitter";
import Python from "tree-sitter-python";
import {
  FlowchartIR,
  FlowchartNode,
  FlowchartEdge,
  LocationMapEntry,
} from "../../../ir/ir";

// Type guards for Python AST node types
type PythonLanguage = Parser.Language;

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
 * A simplified class to manage the construction of Control Flow Graphs from Python code.
 * Only handles basic control flow: if statements, for loops, while loops, and simple statements.
 */
export class PyAstParser {
  private nodeIdCounter = 0;
  private locationMap: LocationMapEntry[] = [];
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
    if (!str) {
      return "";
    }

    const sanitized = str
      .replace(/"/g, "#quot;")
      .replace(/\n/g, " ")
      .replace(/:$/, "")
      .trim();

    const MAX_LABEL_LENGTH = 80;
    return sanitized.length > MAX_LABEL_LENGTH
      ? sanitized.substring(0, MAX_LABEL_LENGTH - 3) + "..."
      : sanitized;
  }

  /**
   * Lists all function names found in the source code.
   */
  public listFunctions(sourceCode: string): string[] {
    const parser = new Parser();
    parser.setLanguage(Python as PythonLanguage);
    const tree = parser.parse(sourceCode);
    const functions = tree.rootNode.descendantsOfType("function_definition");
    return functions.map(
      (f: Parser.SyntaxNode) =>
        f.childForFieldName("name")?.text || "[anonymous]"
    );
  }

  /**
   * Finds the function that contains the given position.
   */
  public findFunctionAtPosition(
    sourceCode: string,
    position: number
  ): string | undefined {
    const parser = new Parser();
    parser.setLanguage(Python as PythonLanguage);
    const tree = parser.parse(sourceCode);
    const functions = tree.rootNode.descendantsOfType("function_definition");

    for (const func of functions) {
      if (position >= func.startIndex && position <= func.endIndex) {
        return func.childForFieldName("name")?.text || "[anonymous]";
      }
    }

    return undefined;
  }

  /**
   * Main public method to generate a flowchart from Python source code.
   */
  public generateFlowchart(
    sourceCode: string,
    functionName?: string,
    position?: number
  ): FlowchartIR {
    this.nodeIdCounter = 0;
    this.locationMap = [];

    const parser = new Parser();
    parser.setLanguage(Python as PythonLanguage);
    const tree = parser.parse(sourceCode);

    let functionNode: Parser.SyntaxNode | undefined;
    const functionNodes = tree.rootNode.descendantsOfType(
      "function_definition"
    );

    if (position !== undefined) {
      functionNode = functionNodes.find(
        (f) => position >= f.startIndex && position <= f.endIndex
      );
    } else if (functionName) {
      functionNode = functionNodes.find(
        (f) => f.childForFieldName("name")?.text === functionName
      );
    } else {
      functionNode = functionNodes[0];
    }

    if (!functionNode) {
      const message = functionName
        ? `Function '${functionName}' not found.`
        : position !== undefined
        ? "Place cursor inside a function to generate a flowchart."
        : "No function found in code.";

      return {
        nodes: [{ id: "A", label: message, shape: "rect" }],
        edges: [],
        locationMap: [],
      };
    }

    const funcNameNode = functionNode.childForFieldName("name");
    const discoveredFunctionName = funcNameNode?.text || "[anonymous]";

    const nodes: FlowchartNode[] = [];
    const edges: FlowchartEdge[] = [];

    const entryId = this.generateNodeId("start");
    const exitId = this.generateNodeId("end");

    nodes.push({
      id: entryId,
      label: `start: ${discoveredFunctionName}`,
      shape: "round",
      style: this.nodeStyles.terminator,
    });
    nodes.push({
      id: exitId,
      label: "end",
      shape: "round",
      style: this.nodeStyles.terminator,
    });

    const body = functionNode.childForFieldName("body");

    if (body) {
      const bodyResult = this.processBlock(body, exitId);
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
    } else {
      edges.push({ from: entryId, to: exitId });
    }

    const nodeIdSet = new Set(nodes.map((n) => n.id));
    const validEdges = edges.filter(
      (e) => nodeIdSet.has(e.from) && nodeIdSet.has(e.to)
    );

    return {
      nodes,
      edges: validEdges,
      locationMap: this.locationMap,
      functionRange: {
        start: functionNode.startIndex,
        end: functionNode.endIndex,
      },
      title: `Flowchart for ${discoveredFunctionName}`,
      entryNodeId: entryId,
      exitNodeId: exitId,
    };
  }

  /**
   * Processes a block of statements, connecting them sequentially.
   */
  private processBlock(
    blockNode: Parser.SyntaxNode | null,
    exitId: string,
    loopContext?: LoopContext,
    finallyContext?: { finallyEntryId: string }
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

    const nodes: FlowchartNode[] = [];
    const edges: FlowchartEdge[] = [];
    let entryNodeId: string | undefined = undefined;
    const nodesConnectedToExit = new Set<string>();
    let lastExitPoints: { id: string; label?: string }[] = [];

    const statements = blockNode.namedChildren.filter(
      (s: Parser.SyntaxNode) =>
        s.type !== "pass_statement" && s.type !== "comment"
    );

    if (statements.length === 0) {
      return {
        nodes: [],
        edges: [],
        entryNodeId: undefined,
        exitPoints: [],
        nodesConnectedToExit,
      };
    }

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

      if (!entryNodeId) {
        entryNodeId = result.entryNodeId;
      }

      // Connect previous exit points to current statement entry
      if (lastExitPoints.length > 0 && result.entryNodeId) {
        lastExitPoints.forEach((exitPoint) => {
          edges.push({
            from: exitPoint.id,
            to: result.entryNodeId!,
            label: exitPoint.label,
          });
        });
      }

      // The exit points of the current statement become the entry points for the next.
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
  /**
   * Delegates a statement to the appropriate processing function based on its type.
   */
  private processStatement(
    statement: Parser.SyntaxNode,
    exitId: string,
    loopContext?: LoopContext,
    finallyContext?: { finallyEntryId: string }
  ): ProcessResult {
    switch (statement.type) {
      case "if_statement":
        return this.processIfStatement(
          statement,
          exitId,
          loopContext,
          finallyContext
        );
      // Note: elif_clause and else_clause are handled recursively within processIfStatement
      case "for_statement":
        return this.processForStatement(statement, exitId, finallyContext);
      case "while_statement":
        return this.processWhileStatement(statement, exitId, finallyContext);
      case "try_statement":
        return this.processTryStatement(
          statement,
          exitId,
          loopContext,
          finallyContext
        );
      case "with_statement":
        return this.processWithStatement(
          statement,
          exitId,
          loopContext,
          finallyContext
        );
      case "return_statement":
        return this.processReturnStatement(statement, exitId, finallyContext);
      case "break_statement":
        if (loopContext) {
          return this.processBreakStatement(statement, loopContext);
        }
        return this.processDefaultStatement(statement);
      case "continue_statement":
        if (loopContext) {
          return this.processContinueStatement(statement, loopContext);
        }
        return this.processDefaultStatement(statement);
      case "pass_statement":
        return {
          nodes: [],
          edges: [],
          entryNodeId: undefined,
          exitPoints: [],
          nodesConnectedToExit: new Set<string>(),
        };
      default:
        return this.processDefaultStatement(statement);
    }
  }

  /**
   * Processes a standard statement, creating a single node.
   */
  private processDefaultStatement(statement: Parser.SyntaxNode): ProcessResult {
    const nodeId = this.generateNodeId("stmt");
    const nodeText = this.escapeString(statement.text);

    const nodes: FlowchartNode[] = [
      {
        id: nodeId,
        label: nodeText,
        shape: "rect",
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

  /**
   * Processes an if statement.
   */
  private processIfStatement(
    ifNode: Parser.SyntaxNode,
    exitId: string,
    loopContext?: LoopContext,
    finallyContext?: { finallyEntryId: string }
  ): ProcessResult {
    const nodes: FlowchartNode[] = [];
    const edges: FlowchartEdge[] = [];
    const nodesConnectedToExit = new Set<string>();
    const allExitPoints: { id: string; label?: string }[] = [];

    let currentIfNode: Parser.SyntaxNode | null = ifNode;
    let lastConditionId: string | null = null;

    while (currentIfNode && currentIfNode.type === "if_statement") {
      const condition = this.escapeString(
        currentIfNode.childForFieldName("condition")!.text
      );
      const conditionId = this.generateNodeId("if_cond");
      nodes.push({
        id: conditionId,
        label: condition,
        shape: "diamond",
        style: this.nodeStyles.decision,
      });
      this.locationMap.push({
        start: currentIfNode.startIndex,
        end: currentIfNode.endIndex,
        nodeId: conditionId,
      });

      if (lastConditionId) {
        edges.push({ from: lastConditionId, to: conditionId, label: "False" });
      }

      const consequence = currentIfNode.childForFieldName("consequence");
      const thenResult = this.processBlock(
        consequence,
        exitId,
        loopContext,
        finallyContext
      );
      nodes.push(...thenResult.nodes);
      edges.push(...thenResult.edges);
      thenResult.nodesConnectedToExit.forEach((n) =>
        nodesConnectedToExit.add(n)
      );

      if (thenResult.entryNodeId) {
        edges.push({
          from: conditionId,
          to: thenResult.entryNodeId,
          label: "True",
        });
      } else {
        // Empty then block, the condition itself is an exit point for the true path
        allExitPoints.push({ id: conditionId, label: "True" });
      }
      allExitPoints.push(...thenResult.exitPoints);

      lastConditionId = conditionId;
      const alternative = currentIfNode.childForFieldName("alternative");

      if (alternative) {
        if (alternative.type === "if_statement") {
          currentIfNode = alternative;
        } else if (alternative.type === "else_clause") {
          const elseBody = alternative.childForFieldName("body");
          const elseResult = this.processBlock(
            elseBody,
            exitId,
            loopContext,
            finallyContext
          );
          nodes.push(...elseResult.nodes);
          edges.push(...elseResult.edges);
          elseResult.nodesConnectedToExit.forEach((n) =>
            nodesConnectedToExit.add(n)
          );

          if (elseResult.entryNodeId) {
            edges.push({
              from: lastConditionId,
              to: elseResult.entryNodeId,
              label: "False",
            });
          } else {
            // Empty else block
            allExitPoints.push({ id: lastConditionId, label: "False" });
          }
          allExitPoints.push(...elseResult.exitPoints);
          currentIfNode = null; // End of the chain
        } else {
          // Should be elif, but tree-sitter python grammar seems to flatten elifs into nested if_statements
          currentIfNode = null;
        }
      } else {
        // No alternative, the false path from the last condition is an exit point
        allExitPoints.push({ id: lastConditionId, label: "False" });
        currentIfNode = null;
      }
    }

    return {
      nodes,
      edges,
      entryNodeId: nodes[0]?.id,
      exitPoints: allExitPoints,
      nodesConnectedToExit,
    };
  }

  /**
   * Processes a for loop.
   */
  private processForStatement(
    forNode: Parser.SyntaxNode,
    exitId: string,
    finallyContext?: { finallyEntryId: string }
  ): ProcessResult {
    const nodes: FlowchartNode[] = [];
    const edges: FlowchartEdge[] = [];
    const nodesConnectedToExit = new Set<string>();

    const left = forNode.childForFieldName("left")!.text;
    const right = forNode.childForFieldName("right")!.text;
    const headerText = this.escapeString(`for ${left} in ${right}`);
    const headerId = this.generateNodeId("for_header");

    nodes.push({
      id: headerId,
      label: headerText,
      shape: "diamond",
      style: this.nodeStyles.decision,
    });

    this.locationMap.push({
      start: forNode.startIndex,
      end: forNode.endIndex,
      nodeId: headerId,
    });

    const loopExitId = this.generateNodeId("for_exit");
    nodes.push({ id: loopExitId, label: "end loop", shape: "stadium" });

    const loopContext: LoopContext = {
      breakTargetId: loopExitId,
      continueTargetId: headerId,
    };

    const body = forNode.childForFieldName("body")!;
    const bodyResult = this.processBlock(
      body,
      exitId,
      loopContext,
      finallyContext
    );
    nodes.push(...bodyResult.nodes);
    edges.push(...bodyResult.edges);
    bodyResult.nodesConnectedToExit.forEach((n) => nodesConnectedToExit.add(n));

    if (bodyResult.entryNodeId) {
      edges.push({ from: headerId, to: bodyResult.entryNodeId, label: "Loop" });
    } else {
      edges.push({ from: headerId, to: headerId, label: "Loop" });
    }

    // Loop back to header
    bodyResult.exitPoints.forEach((ep) => {
      edges.push({ from: ep.id, to: headerId });
    });

    // Exit the loop
    edges.push({ from: headerId, to: loopExitId, label: "End Loop" });

    return {
      nodes,
      edges,
      entryNodeId: headerId,
      exitPoints: [{ id: loopExitId }],
      nodesConnectedToExit,
    };
  }

  /**
   * Processes a while loop.
   */
  private processWhileStatement(
    whileNode: Parser.SyntaxNode,
    exitId: string,
    finallyContext?: { finallyEntryId: string }
  ): ProcessResult {
    const nodes: FlowchartNode[] = [];
    const edges: FlowchartEdge[] = [];
    const nodesConnectedToExit = new Set<string>();

    const conditionText = this.escapeString(
      whileNode.childForFieldName("condition")!.text
    );
    const conditionId = this.generateNodeId("while_cond");
    nodes.push({
      id: conditionId,
      label: conditionText,
      shape: "diamond",
      style: this.nodeStyles.decision,
    });

    this.locationMap.push({
      start: whileNode.startIndex,
      end: whileNode.endIndex,
      nodeId: conditionId,
    });

    const loopExitId = this.generateNodeId("while_exit");
    nodes.push({ id: loopExitId, label: "end loop", shape: "stadium" });

    const loopContext: LoopContext = {
      breakTargetId: loopExitId,
      continueTargetId: conditionId,
    };

    const body = whileNode.childForFieldName("body")!;
    const bodyResult = this.processBlock(
      body,
      exitId,
      loopContext,
      finallyContext
    );
    nodes.push(...bodyResult.nodes);
    edges.push(...bodyResult.edges);
    bodyResult.nodesConnectedToExit.forEach((n) => nodesConnectedToExit.add(n));

    if (bodyResult.entryNodeId) {
      edges.push({
        from: conditionId,
        to: bodyResult.entryNodeId,
        label: "True",
      });
    } else {
      edges.push({ from: conditionId, to: conditionId, label: "True" });
    }

    // Loop back to condition
    bodyResult.exitPoints.forEach((ep) => {
      edges.push({ from: ep.id, to: conditionId });
    });

    // Exit the loop
    edges.push({ from: conditionId, to: loopExitId, label: "False" });

    return {
      nodes,
      edges,
      entryNodeId: conditionId,
      exitPoints: [{ id: loopExitId }],
      nodesConnectedToExit,
    };
  }

  /**
   * Processes a return statement.
   */
  private processReturnStatement(
    returnNode: Parser.SyntaxNode,
    exitId: string,
    finallyContext?: { finallyEntryId: string }
  ): ProcessResult {
    const nodeId = this.generateNodeId("return");

    // A 'return_statement' in the tree-sitter-python grammar has its value(s) as named children.
    // Anonymous children include the 'return' keyword itself.
    const valueNodes = returnNode.namedChildren;

    let labelText: string;

    if (valueNodes.length > 0) {
      // If value nodes exist, construct the return value string from them.
      // This correctly handles single values, tuples, etc.
      const returnValueText = valueNodes.map((n) => n.text).join(", ");
      labelText = `return ${this.escapeString(returnValueText)}`;
    } else {
      // If there are no named children, it's a bare `return`.
      labelText = "return";
    }

    const nodes: FlowchartNode[] = [
      {
        id: nodeId,
        label: labelText,
        shape: "stadium",
        style: this.nodeStyles.special,
      },
    ];

    const edges: FlowchartEdge[] = [];
    if (finallyContext) {
      edges.push({ from: nodeId, to: finallyContext.finallyEntryId });
    } else {
      edges.push({ from: nodeId, to: exitId });
    }

    this.locationMap.push({
      start: returnNode.startIndex,
      end: returnNode.endIndex,
      nodeId,
    });

    return {
      nodes,
      edges,
      entryNodeId: nodeId,
      // A return statement is a terminal point in a flow, so it has no onward exit points
      // from its block. The flow terminates here and goes to the main function exit.
      exitPoints: [],
      nodesConnectedToExit: new Set<string>().add(nodeId),
    };
  }

  /**
   * Processes a break statement.
   */
  private processBreakStatement(
    breakNode: Parser.SyntaxNode,
    loopContext: LoopContext
  ): ProcessResult {
    const nodeId = this.generateNodeId("break");
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
      start: breakNode.startIndex,
      end: breakNode.endIndex,
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

  /**
   * Processes a continue statement.
   */
  private processContinueStatement(
    continueNode: Parser.SyntaxNode,
    loopContext: LoopContext
  ): ProcessResult {
    const nodeId = this.generateNodeId("continue");
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
      start: continueNode.startIndex,
      end: continueNode.endIndex,
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

  /**
   * Processes a try statement.
   */
  private processTryStatement(
    tryNode: Parser.SyntaxNode,
    exitId: string,
    loopContext?: LoopContext,
    finallyContext?: { finallyEntryId: string }
  ): ProcessResult {
    const nodes: FlowchartNode[] = [];
    const edges: FlowchartEdge[] = [];
    const nodesConnectedToExit = new Set<string>();
    let allExitPoints: { id: string; label?: string }[] = [];

    const entryId = this.generateNodeId("try_entry");
    nodes.push({ id: entryId, label: "try", shape: "stadium" });
    this.locationMap.push({
      start: tryNode.startIndex,
      end: tryNode.endIndex,
      nodeId: entryId,
    });

    let newFinallyContext: { finallyEntryId: string } | undefined = undefined;
    let finallyResult: ProcessResult | null = null;
    const finallyClause = tryNode.children.find(
      (c) => c.type === "finally_clause"
    );

    if (finallyClause) {
      const finallyBody = finallyClause.namedChildren.find(
        (c) => c.type === "block"
      );
      // Process the finally block first to get its entry point.
      // It should be processed with the outer finallyContext, not the one it creates.
      finallyResult = this.processBlock(
        finallyBody!,
        exitId,
        loopContext,
        finallyContext
      );
      if (finallyResult.entryNodeId) {
        nodes.push(...finallyResult.nodes);
        edges.push(...finallyResult.edges);
        finallyResult.nodesConnectedToExit.forEach((n) =>
          nodesConnectedToExit.add(n)
        );
        newFinallyContext = { finallyEntryId: finallyResult.entryNodeId };
      }
    }

    // Now process the try block, passing the new context if a finally block exists.
    const tryBody = tryNode.namedChildren.find((c) => c.type === "block");
    const tryResult = this.processBlock(
      tryBody!,
      exitId,
      loopContext,
      newFinallyContext || finallyContext
    );
    nodes.push(...tryResult.nodes);
    edges.push(...tryResult.edges);
    tryResult.nodesConnectedToExit.forEach((n) => nodesConnectedToExit.add(n));

    if (tryResult.entryNodeId) {
      edges.push({ from: entryId, to: tryResult.entryNodeId });
    } else {
      // If try block is empty, it goes to finally or exits.
      if (finallyResult && finallyResult.entryNodeId) {
        edges.push({ from: entryId, to: finallyResult.entryNodeId });
      } else {
        allExitPoints.push({ id: entryId });
      }
    }

    // Connect exit points of the try block to the finally block.
    tryResult.exitPoints.forEach((ep) => {
      if (finallyResult && finallyResult.entryNodeId) {
        edges.push({
          from: ep.id,
          to: finallyResult.entryNodeId,
          label: ep.label,
        });
      } else {
        allExitPoints.push(ep);
      }
    });

    const exceptClauses = tryNode.children.filter(
      (c) => c.type === "except_clause"
    );
    for (const clause of exceptClauses) {
      const exceptBody = clause.namedChildren.find((c) => c.type === "block");
      const exceptTypeNode = clause.namedChildren.find(
        (c) => c.type !== "block"
      );
      const exceptType = exceptTypeNode
        ? this.escapeString(exceptTypeNode.text)
        : "exception";

      // Process except blocks, also passing the new finally context.
      const exceptResult = this.processBlock(
        exceptBody!,
        exitId,
        loopContext,
        newFinallyContext || finallyContext
      );
      nodes.push(...exceptResult.nodes);
      edges.push(...exceptResult.edges);
      exceptResult.nodesConnectedToExit.forEach((n) =>
        nodesConnectedToExit.add(n)
      );

      if (exceptResult.entryNodeId) {
        // The entry point for exceptions is the main 'try' node.
        edges.push({
          from: entryId,
          to: exceptResult.entryNodeId,
          label: `on ${exceptType}`,
        });

        // Connect exit points of the except block to the finally block.
        exceptResult.exitPoints.forEach((ep) => {
          if (finallyResult && finallyResult.entryNodeId) {
            edges.push({
              from: ep.id,
              to: finallyResult.entryNodeId,
              label: ep.label,
            });
          } else {
            allExitPoints.push(ep);
          }
        });
      }
    }

    // If there's a finally block, its exit points are the exit points of the whole statement.
    if (finallyResult) {
      allExitPoints = finallyResult.exitPoints;
    } else {
      // If no finally, and no except clauses, the "normal" path from try is an exit.
      if (exceptClauses.length === 0) {
        // allExitPoints already contains tryResult.exitPoints
      } else {
        // If there are except clauses but no finally, the normal path from a non-empty try block
        // is also an exit path.
        if (tryResult.exitPoints.length > 0) {
          // Already added
        } else if (tryResult.nodes.length === 0) {
          // Empty try block with except clauses, the main entry can be an exit point.
          allExitPoints.push({ id: entryId });
        }
      }
    }

    return {
      nodes,
      edges,
      entryNodeId: entryId,
      exitPoints: allExitPoints,
      nodesConnectedToExit,
    };
  }

  /**
   * Processes a with statement.
   */
  private processWithStatement(
    withNode: Parser.SyntaxNode,
    exitId: string,
    loopContext?: LoopContext,
    finallyContext?: { finallyEntryId: string }
  ): ProcessResult {
    const nodes: FlowchartNode[] = [];
    const edges: FlowchartEdge[] = [];

    const withClauseNode = withNode.children.find(
      (c: Parser.SyntaxNode) => c.type === "with_clause"
    );
    const withClauseText = this.escapeString(
      withClauseNode?.text || "with ..."
    );

    const withEntryId = this.generateNodeId("with");
    nodes.push({
      id: withEntryId,
      label: withClauseText,
      shape: "rect",
      style: this.nodeStyles.special,
    });

    this.locationMap.push({
      start: withNode.startIndex,
      end: withNode.endIndex,
      nodeId: withEntryId,
    });

    const body = withNode.childForFieldName("body");
    if (body) {
      const bodyResult = this.processBlock(
        body,
        exitId,
        loopContext,
        finallyContext
      );
      nodes.push(...bodyResult.nodes);
      edges.push(...bodyResult.edges);

      if (bodyResult.entryNodeId) {
        edges.push({ from: withEntryId, to: bodyResult.entryNodeId });
      }

      const exitPoints =
        bodyResult.exitPoints.length > 0
          ? bodyResult.exitPoints
          : [{ id: withEntryId }];

      return {
        nodes,
        edges,
        entryNodeId: withEntryId,
        exitPoints: exitPoints,
        nodesConnectedToExit: bodyResult.nodesConnectedToExit,
      };
    }

    return {
      nodes,
      edges,
      entryNodeId: withEntryId,
      exitPoints: [{ id: withEntryId }],
      nodesConnectedToExit: new Set<string>(),
    };
  }
}
