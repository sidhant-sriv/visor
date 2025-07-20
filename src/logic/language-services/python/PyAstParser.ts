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
      const result = this.processStatement(statement, exitId, loopContext);
      nodes.push(...result.nodes);
      edges.push(...result.edges);

      // Track terminal statements (those that connect directly to function exit)
      const isTerminalStatement = result.nodesConnectedToExit.size > 0;

      if (!entryNodeId) {
        entryNodeId = result.entryNodeId;
      }

      // Connect previous exit points to current statement entry (if not terminal)
      if (lastExitPoints.length > 0 && result.entryNodeId) {
        lastExitPoints.forEach((exitPoint) => {
          edges.push({
            from: exitPoint.id,
            to: result.entryNodeId!,
            label: exitPoint.label,
          });
        });
      }

      // Update flow tracking:
      // - If current statement terminates, don't continue sequential flow
      // - Otherwise, use its exit points for next iteration
      if (isTerminalStatement) {
        // Terminal statements don't provide exit points for sequential flow
        // but we still track that they connect to the function exit
        result.nodesConnectedToExit.forEach((n) => nodesConnectedToExit.add(n));
        lastExitPoints = []; // No further sequential flow after terminal statements
      } else {
        // Non-terminal statements provide exit points for sequential flow
        lastExitPoints = result.exitPoints;
      }
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
    loopContext?: LoopContext
  ): ProcessResult {
    switch (statement.type) {
      case "if_statement":
        return this.processIfStatement(statement, exitId, loopContext);
      case "elif_clause":
        return this.processElifClause(statement, exitId, loopContext);
      case "else_clause":
        return this.processElseClause(statement, exitId, loopContext);
      case "for_statement":
        return this.processForStatement(statement, exitId);
      case "while_statement":
        return this.processWhileStatement(statement, exitId);
      case "try_statement":
        return this.processTryStatement(statement, exitId, loopContext);
      case "with_statement":
        return this.processWithStatement(statement, exitId, loopContext);
      case "return_statement":
        return this.processReturnStatement(statement, exitId);
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
    loopContext?: LoopContext
  ): ProcessResult {
    const nodes: FlowchartNode[] = [];
    const edges: FlowchartEdge[] = [];
    const nodesConnectedToExit = new Set<string>();

    const condition = this.escapeString(
      ifNode.childForFieldName("condition")!.text
    );
    const conditionId = this.generateNodeId("if_cond");
    nodes.push({
      id: conditionId,
      label: condition,
      shape: "diamond",
      style: this.nodeStyles.decision,
    });

    this.locationMap.push({
      start: ifNode.startIndex,
      end: ifNode.endIndex,
      nodeId: conditionId,
    });

    let exitPoints: { id: string; label?: string }[] = [];

    // Process "then" block (consequence)
    const consequence = ifNode.childForFieldName("consequence");
    const thenResult = this.processBlock(consequence, exitId, loopContext);
    nodes.push(...thenResult.nodes);
    edges.push(...thenResult.edges);
    if (thenResult.entryNodeId) {
      edges.push({
        from: conditionId,
        to: thenResult.entryNodeId,
        label: "True",
      });
    }
    exitPoints.push(...thenResult.exitPoints);
    thenResult.nodesConnectedToExit.forEach((n) => nodesConnectedToExit.add(n));
    if (thenResult.nodes.length === 0) {
      exitPoints.push({ id: conditionId, label: "True" });
    }

    // Process 'alternative' (elif/else clause)
    const alternative = ifNode.childForFieldName("alternative");
    if (alternative) {
      const elseResult = this.processStatement(
        alternative,
        exitId,
        loopContext
      );
      nodes.push(...elseResult.nodes);
      edges.push(...elseResult.edges);

      if (elseResult.entryNodeId) {
        edges.push({
          from: conditionId,
          to: elseResult.entryNodeId,
          label: "False",
        });
      }
      exitPoints.push(...elseResult.exitPoints);
      elseResult.nodesConnectedToExit.forEach((n) =>
        nodesConnectedToExit.add(n)
      );
    } else {
      exitPoints.push({ id: conditionId, label: "False" });
    }

    return {
      nodes,
      edges,
      entryNodeId: conditionId,
      exitPoints,
      nodesConnectedToExit,
    };
  }

  /**
   * Processes a for loop.
   */
  private processForStatement(
    forNode: Parser.SyntaxNode,
    exitId: string
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
    const bodyResult = this.processBlock(body, exitId, loopContext);
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
    exitId: string
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
    const bodyResult = this.processBlock(body, exitId, loopContext);
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
    exitId: string
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

    // All return statements connect directly to the function's exit node.
    const edges: FlowchartEdge[] = [{ from: nodeId, to: exitId }];

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
   * Processes an elif clause.
   */
  private processElifClause(
    elifNode: Parser.SyntaxNode,
    exitId: string,
    loopContext?: LoopContext
  ): ProcessResult {
    const nodes: FlowchartNode[] = [];
    const edges: FlowchartEdge[] = [];
    const nodesConnectedToExit = new Set<string>();

    const condition = this.escapeString(
      elifNode.childForFieldName("condition")!.text
    );
    const conditionId = this.generateNodeId("elif_cond");
    nodes.push({
      id: conditionId,
      label: condition,
      shape: "diamond",
      style: this.nodeStyles.decision,
    });

    this.locationMap.push({
      start: elifNode.startIndex,
      end: elifNode.endIndex,
      nodeId: conditionId,
    });

    let exitPoints: { id: string; label?: string }[] = [];

    const consequence = elifNode.childForFieldName("consequence");
    const thenResult = this.processBlock(consequence, exitId, loopContext);
    nodes.push(...thenResult.nodes);
    edges.push(...thenResult.edges);
    if (thenResult.entryNodeId) {
      edges.push({
        from: conditionId,
        to: thenResult.entryNodeId,
        label: "True",
      });
    }
    exitPoints.push(...thenResult.exitPoints);
    thenResult.nodesConnectedToExit.forEach((n) => nodesConnectedToExit.add(n));
    if (thenResult.nodes.length === 0) {
      exitPoints.push({ id: conditionId, label: "True" });
    }

    const alternative = elifNode.childForFieldName("alternative");
    if (alternative) {
      const elseResult = this.processStatement(
        alternative,
        exitId,
        loopContext
      );
      nodes.push(...elseResult.nodes);
      edges.push(...elseResult.edges);

      if (elseResult.entryNodeId) {
        edges.push({
          from: conditionId,
          to: elseResult.entryNodeId,
          label: "False",
        });
      }
      exitPoints.push(...elseResult.exitPoints);
      elseResult.nodesConnectedToExit.forEach((n) =>
        nodesConnectedToExit.add(n)
      );
    } else {
      exitPoints.push({ id: conditionId, label: "False" });
    }

    return {
      nodes,
      edges,
      entryNodeId: conditionId,
      exitPoints,
      nodesConnectedToExit,
    };
  }

  /**
   * Processes an else clause.
   */
  private processElseClause(
    elseNode: Parser.SyntaxNode,
    exitId: string,
    loopContext?: LoopContext
  ): ProcessResult {
    const blockNode = elseNode.childForFieldName("body") || null;
    return this.processBlock(blockNode, exitId, loopContext);
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
    loopContext?: LoopContext
  ): ProcessResult {
    const nodes: FlowchartNode[] = [];
    const edges: FlowchartEdge[] = [];
    const nodesConnectedToExit = new Set<string>();

    const entryNodeId = this.generateNodeId("try");
    nodes.push({
      id: entryNodeId,
      label: "try",
      shape: "stadium",
      style: this.nodeStyles.special,
    });

    this.locationMap.push({
      start: tryNode.startIndex,
      end: tryNode.endIndex,
      nodeId: entryNodeId,
    });

    let lastExitPoints: { id: string; label?: string }[] = [];

    const tryBody = tryNode.childForFieldName("body");
    if (tryBody) {
      const tryResult = this.processBlock(tryBody, exitId, loopContext);
      nodes.push(...tryResult.nodes);
      edges.push(...tryResult.edges);
      tryResult.nodesConnectedToExit.forEach((n) =>
        nodesConnectedToExit.add(n)
      );

      if (tryResult.entryNodeId) {
        edges.push({ from: entryNodeId, to: tryResult.entryNodeId });
      }
      lastExitPoints.push(...tryResult.exitPoints);
    }

    // Process except clauses
    const exceptClauses = tryNode.children.filter(
      (c: Parser.SyntaxNode) => c.type === "except_clause"
    );
    for (const clause of exceptClauses) {
      const exceptBody = clause.childForFieldName("body");
      if (exceptBody) {
        const exceptResult = this.processBlock(exceptBody, exitId, loopContext);
        nodes.push(...exceptResult.nodes);
        edges.push(...exceptResult.edges);
        exceptResult.nodesConnectedToExit.forEach((n) =>
          nodesConnectedToExit.add(n)
        );

        if (exceptResult.entryNodeId) {
          edges.push({
            from: entryNodeId,
            to: exceptResult.entryNodeId,
            label: "except",
          });
        }
        lastExitPoints.push(...exceptResult.exitPoints);
      }
    }

    // Process finally clause
    const finallyClause = tryNode.childForFieldName("finally_clause");
    if (finallyClause) {
      const finallyBody = finallyClause.childForFieldName("body");
      if (finallyBody) {
        const finallyResult = this.processBlock(
          finallyBody,
          exitId,
          loopContext
        );
        nodes.push(...finallyResult.nodes);
        edges.push(...finallyResult.edges);
        finallyResult.nodesConnectedToExit.forEach((n) =>
          nodesConnectedToExit.add(n)
        );

        if (finallyResult.entryNodeId) {
          lastExitPoints.forEach((ep) => {
            if (!nodesConnectedToExit.has(ep.id)) {
              edges.push({ from: ep.id, to: finallyResult.entryNodeId! });
            }
          });
          lastExitPoints = finallyResult.exitPoints;
        }
      }
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
   * Processes a with statement.
   */
  private processWithStatement(
    withNode: Parser.SyntaxNode,
    exitId: string,
    loopContext?: LoopContext
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
      const bodyResult = this.processBlock(body, exitId, loopContext);
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
