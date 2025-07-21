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
 * A class to manage the construction of Control Flow Graphs from Python code.
 * It handles standard functions, lambda functions, and basic control flow.
 */
export class PyAstParser {
  private nodeIdCounter = 0;
  private locationMap: LocationMapEntry[] = [];
  private currentFunctionIsLambda = false; // Tracks if the current scope is a lambda
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
   * Lists all function and lambda assignment names found in the source code.
   */
  public listFunctions(sourceCode: string): string[] {
    const parser = new Parser();
    parser.setLanguage(Python as PythonLanguage);
    const tree = parser.parse(sourceCode);

    const functions = tree.rootNode.descendantsOfType("function_definition");
    const funcNames = functions.map(
      (f: Parser.SyntaxNode) =>
        f.childForFieldName("name")?.text || "[anonymous]"
    );

    const assignments = tree.rootNode.descendantsOfType("assignment");
    const lambdaNames = assignments
      .filter((a) => a.childForFieldName("right")?.type === "lambda")
      .map((a) => a.childForFieldName("left")?.text || "[anonymous lambda]");

    return [...funcNames, ...lambdaNames];
  }

  /**
   * Finds the function or lambda assignment that contains the given position.
   */
  public findFunctionAtPosition(
    sourceCode: string,
    position: number
  ): string | undefined {
    const parser = new Parser();
    parser.setLanguage(Python as PythonLanguage);
    const tree = parser.parse(sourceCode);

    // Check for regular functions first
    const functions = tree.rootNode.descendantsOfType("function_definition");
    for (const func of functions) {
      if (position >= func.startIndex && position <= func.endIndex) {
        return func.childForFieldName("name")?.text || "[anonymous]";
      }
    }

    // Check for lambda assignments
    const assignments = tree.rootNode.descendantsOfType("assignment");
    for (const assign of assignments) {
      if (
        position >= assign.startIndex &&
        position <= assign.endIndex &&
        assign.childForFieldName("right")?.type === "lambda"
      ) {
        return assign.childForFieldName("left")?.text || "[anonymous lambda]";
      }
    }

    return undefined;
  }

  /**
   * Main public method to generate a flowchart from Python source code.
   * It can now detect and process both standard functions and lambda functions.
   */
  public generateFlowchart(
    sourceCode: string,
    functionName?: string,
    position?: number
  ): FlowchartIR {
    this.nodeIdCounter = 0;
    this.locationMap = [];
    this.currentFunctionIsLambda = false; // Reset for each run

    const parser = new Parser();
    parser.setLanguage(Python as PythonLanguage);
    const tree = parser.parse(sourceCode);

    let targetNode: Parser.SyntaxNode | undefined;
    let isLambda = false;
    let discoveredFunctionName = "[anonymous]";

    if (position !== undefined) {
      // Priority 1: Find a regular function definition containing the cursor.
      targetNode = tree.rootNode
        .descendantsOfType("function_definition")
        .find((f) => position >= f.startIndex && position <= f.endIndex);

      // Priority 2: If not in a function, find a lambda assignment.
      if (!targetNode) {
        const assignmentNode = tree.rootNode
          .descendantsOfType("assignment")
          .find((a) => position >= a.startIndex && position <= a.endIndex);

        if (assignmentNode?.childForFieldName("right")?.type === "lambda") {
          targetNode = assignmentNode;
          isLambda = true;
          discoveredFunctionName = this.escapeString(
            assignmentNode.childForFieldName("left")?.text ||
              "[anonymous lambda]"
          );
        }
      }

      // Priority 3: Find the smallest raw lambda containing the cursor.
      if (!targetNode) {
        const lambdaNodes = tree.rootNode.descendantsOfType("lambda");
        let smallestLambda: Parser.SyntaxNode | undefined = undefined;
        for (const lambda of lambdaNodes) {
          if (position >= lambda.startIndex && position <= lambda.endIndex) {
            if (
              !smallestLambda ||
              lambda.endIndex - lambda.startIndex <
                smallestLambda.endIndex - smallestLambda.startIndex
            ) {
              smallestLambda = lambda;
            }
          }
        }
        if (smallestLambda) {
          targetNode = smallestLambda;
          isLambda = true;
          discoveredFunctionName = "[anonymous lambda]";
        }
      }
    } else if (functionName) {
      // Fallback to finding by name (less likely to work for lambdas)
      targetNode = tree.rootNode
        .descendantsOfType("function_definition")
        .find((f) => f.childForFieldName("name")?.text === functionName);
    } else {
      // Fallback to the first function if no position or name is given
      targetNode = tree.rootNode.descendantsOfType("function_definition")[0];
    }

    // Set the flag to indicate if we are processing a lambda function.
    this.currentFunctionIsLambda = isLambda;

    if (!targetNode) {
      const message =
        position !== undefined
          ? "Place cursor inside a function or lambda to generate a flowchart."
          : "No function or lambda found in code.";

      return {
        nodes: [{ id: "A", label: message, shape: "rect" }],
        edges: [],
        locationMap: [],
      };
    }

    const nodes: FlowchartNode[] = [];
    const edges: FlowchartEdge[] = [];

    const entryId = this.generateNodeId("start");
    const exitId = this.generateNodeId("end");

    let body: Parser.SyntaxNode | null = null;
    const functionRange = {
      start: targetNode.startIndex,
      end: targetNode.endIndex,
    };

    if (isLambda) {
      let lambdaNode: Parser.SyntaxNode | undefined;
      if (targetNode.type === "assignment") {
        lambdaNode = targetNode.childForFieldName("right")!;
      } else {
        // It's a raw lambda node
        lambdaNode = targetNode;
      }
      body = lambdaNode.childForFieldName("body");
    } else {
      // It's a function_definition
      const funcNameNode = targetNode.childForFieldName("name");
      discoveredFunctionName = funcNameNode?.text || "[anonymous]";
      body = targetNode.childForFieldName("body");
    }

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

    if (body) {
      console.log(
        `[PyAstParser DBG] Processing function '${discoveredFunctionName}'. Is lambda: ${isLambda}. Body node type: ${body.type}`
      );
      let bodyResult;
      // A lambda's body is a single expression, treated as one statement.
      // A function's body is a block of multiple statements.
      if (isLambda) {
        bodyResult = this.processStatement(body, exitId);
      } else {
        bodyResult = this.processBlock(body, exitId);
      }

      nodes.push(...bodyResult.nodes);
      edges.push(...bodyResult.edges);

      if (bodyResult.entryNodeId) {
        edges.push({ from: entryId, to: bodyResult.entryNodeId });
      } else {
        edges.push({ from: entryId, to: exitId });
      }

      // Connect any loose ends to the main exit node.
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
      functionRange,
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
        s.type !== "pass_statement" &&
        s.type !== "comment" &&
        s.type !== "elif_clause" &&
        s.type !== "else_clause"
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

  /**
   * Delegates a statement or expression to the appropriate processing function based on its type.
   */
  private processStatement(
    statement: Parser.SyntaxNode,
    exitId: string,
    loopContext?: LoopContext,
    finallyContext?: { finallyEntryId: string }
  ): ProcessResult {
    console.log(
      `[PyAstParser DBG] processStatement: type = '${
        statement.type
      }', isLambda = ${
        this.currentFunctionIsLambda
      }, text = "${statement.text.substring(0, 50)}"`
    );

    // This explicit check ensures conditional expressions are always handled correctly,
    // especially when they are the body of a lambda.
    if (statement.type === "conditional_expression") {
      console.log(
        "[PyAstParser DBG] Matched 'conditional_expression'. Routing to processConditionalExpression."
      );
      return this.processConditionalExpression(
        statement,
        exitId,
        loopContext,
        finallyContext
      );
    }

    switch (statement.type) {
      case "if_statement":
        return this.processIfStatement(
          statement,
          exitId,
          loopContext,
          finallyContext
        );
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
      case "raise_statement":
        return this.processRaiseStatement(statement, exitId, finallyContext);
      case "assert_statement":
        return this.processAssertStatement(
          statement,
          exitId,
          loopContext,
          finallyContext
        );
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
      case "match_statement":
        return this.processMatchStatement(
          statement,
          exitId,
          loopContext,
          finallyContext
        );
      case "pass_statement":
        return {
          nodes: [],
          edges: [],
          entryNodeId: undefined,
          exitPoints: [],
          nodesConnectedToExit: new Set<string>(),
        };
      default:
        console.log(
          `[PyAstParser DBG] Reached default case for type '${statement.type}'.`
        );
        // If we are in a lambda, and the expression type is not a control-flow statement
        // that has its own case, we treat it as an implicit return value.
        if (this.currentFunctionIsLambda) {
          console.log(
            `[PyAstParser DBG] In lambda, treating as implicit return.`
          );
          return this.processReturnStatementForExpression(
            statement,
            exitId,
            finallyContext
          );
        } else {
          console.log(
            `[PyAstParser DBG] Not in lambda, treating as default statement.`
          );
          return this.processDefaultStatement(statement);
        }
    }
  }

  /**
   * Processes a standard statement or expression, creating a single node.
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
   * Processes an expression node as an implicit return statement.
   * This is used for the body of lambda functions.
   */
  private processReturnStatementForExpression(
    exprNode: Parser.SyntaxNode,
    exitId: string,
    finallyContext?: { finallyEntryId: string }
  ): ProcessResult {
    const nodeId = this.generateNodeId("return");
    const labelText = `return ${this.escapeString(exprNode.text)}`;

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
      start: exprNode.startIndex,
      end: exprNode.endIndex,
      nodeId,
    });

    return {
      nodes,
      edges,
      entryNodeId: nodeId,
      exitPoints: [], // A return statement is a terminal point in its flow.
      nodesConnectedToExit: new Set<string>([nodeId]),
    };
  }

  /**
   * Processes a conditional expression (ternary operator).
   * e.g., `a if condition else b`
   */
  private processConditionalExpression(
    condExprNode: Parser.SyntaxNode,
    exitId: string,
    loopContext?: LoopContext,
    finallyContext?: { finallyEntryId: string }
  ): ProcessResult {
    console.log("[PyAstParser DBG] Inside processConditionalExpression.");
    const nodes: FlowchartNode[] = [];
    const edges: FlowchartEdge[] = [];
    const nodesConnectedToExit = new Set<string>();
    const allExitPoints: { id: string; label?: string }[] = [];

    const namedChildren = condExprNode.namedChildren;
    if (namedChildren.length < 3) {
      return this.processDefaultStatement(condExprNode);
    }

    const consequenceNode = namedChildren[0];
    const conditionNode = namedChildren[1];
    let alternativeNode = namedChildren[2];

    // Handle `(nested_conditional)` by looking inside the parentheses
    if (
      alternativeNode.type === "parenthesized_expression" &&
      alternativeNode.namedChild(0)?.type === "conditional_expression"
    ) {
      console.log(
        "[PyAstParser DBG] Found parenthesized nested conditional. Unwrapping it."
      );
      alternativeNode = alternativeNode.namedChild(0)!;
    }

    const conditionId = this.generateNodeId("cond_expr");
    nodes.push({
      id: conditionId,
      label: this.escapeString(conditionNode.text),
      shape: "diamond",
      style: this.nodeStyles.decision,
    });
    this.locationMap.push({
      start: conditionNode.startIndex,
      end: conditionNode.endIndex,
      nodeId: conditionId,
    });

    const entryNodeId = conditionId;

    // Process consequence (True path) by dispatching back to the main statement processor.
    // This allows for correct recursive handling of nested structures.
    const consequenceResult = this.processStatement(
      consequenceNode,
      exitId,
      loopContext,
      finallyContext
    );
    nodes.push(...consequenceResult.nodes);
    edges.push(...consequenceResult.edges);
    consequenceResult.nodesConnectedToExit.forEach((n) =>
      nodesConnectedToExit.add(n)
    );
    allExitPoints.push(...consequenceResult.exitPoints);

    if (consequenceResult.entryNodeId) {
      edges.push({
        from: conditionId,
        to: consequenceResult.entryNodeId,
        label: "True",
      });
    } else {
      allExitPoints.push({ id: conditionId, label: "True" });
    }

    // Process alternative (False path)
    const alternativeResult = this.processStatement(
      alternativeNode,
      exitId,
      loopContext,
      finallyContext
    );
    nodes.push(...alternativeResult.nodes);
    edges.push(...alternativeResult.edges);
    alternativeResult.nodesConnectedToExit.forEach((n) =>
      nodesConnectedToExit.add(n)
    );
    allExitPoints.push(...alternativeResult.exitPoints);

    if (alternativeResult.entryNodeId) {
      edges.push({
        from: conditionId,
        to: alternativeResult.entryNodeId,
        label: "False",
      });
    } else {
      allExitPoints.push({ id: conditionId, label: "False" });
    }

    return {
      nodes,
      edges,
      entryNodeId,
      // If inside a lambda, the branches are terminal returns and have no exit points that flow onward.
      // Otherwise, the exits from the branches are the exits for the whole expression.
      exitPoints: this.currentFunctionIsLambda ? [] : allExitPoints,
      nodesConnectedToExit,
    };
  }

  /**
   * Processes an if-elif-else statement chain.
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

    const ifConditionNode = ifNode.childForFieldName("condition");
    const ifConsequenceNode = ifNode.childForFieldName("consequence");

    if (!ifConditionNode || !ifConsequenceNode) {
      return {
        nodes: [],
        edges: [],
        entryNodeId: undefined,
        exitPoints: [],
        nodesConnectedToExit,
      };
    }

    const ifConditionId = this.generateNodeId("cond");
    nodes.push({
      id: ifConditionId,
      label: this.escapeString(ifConditionNode.text),
      shape: "diamond",
      style: this.nodeStyles.decision,
    });
    this.locationMap.push({
      start: ifConditionNode.startIndex,
      end: ifConditionNode.endIndex,
      nodeId: ifConditionId,
    });

    const entryNodeId = ifConditionId;
    let lastConditionId = ifConditionId;

    const ifConsequenceResult = this.processBlock(
      ifConsequenceNode,
      exitId,
      loopContext,
      finallyContext
    );
    nodes.push(...ifConsequenceResult.nodes);
    edges.push(...ifConsequenceResult.edges);
    ifConsequenceResult.nodesConnectedToExit.forEach((n) =>
      nodesConnectedToExit.add(n)
    );

    if (ifConsequenceResult.entryNodeId) {
      edges.push({
        from: ifConditionId,
        to: ifConsequenceResult.entryNodeId,
        label: "True",
      });
    } else {
      allExitPoints.push({ id: ifConditionId, label: "True" });
    }
    allExitPoints.push(...ifConsequenceResult.exitPoints);

    const alternatives = ifNode.childrenForFieldName("alternative");
    let elseClause: Parser.SyntaxNode | null = null;

    for (const clause of alternatives) {
      if (clause.type === "elif_clause") {
        const elifConditionNode = clause.childForFieldName("condition");
        const elifConsequenceNode = clause.childForFieldName("consequence");

        if (!elifConditionNode || !elifConsequenceNode) continue;

        const elifConditionId = this.generateNodeId("cond");
        nodes.push({
          id: elifConditionId,
          label: this.escapeString(elifConditionNode.text),
          shape: "diamond",
          style: this.nodeStyles.decision,
        });
        this.locationMap.push({
          start: elifConditionNode.startIndex,
          end: elifConditionNode.endIndex,
          nodeId: elifConditionId,
        });

        edges.push({
          from: lastConditionId,
          to: elifConditionId,
          label: "False",
        });
        lastConditionId = elifConditionId;

        const elifConsequenceResult = this.processBlock(
          elifConsequenceNode,
          exitId,
          loopContext,
          finallyContext
        );
        nodes.push(...elifConsequenceResult.nodes);
        edges.push(...elifConsequenceResult.edges);
        elifConsequenceResult.nodesConnectedToExit.forEach((n) =>
          nodesConnectedToExit.add(n)
        );

        if (elifConsequenceResult.entryNodeId) {
          edges.push({
            from: elifConditionId,
            to: elifConsequenceResult.entryNodeId,
            label: "True",
          });
        } else {
          allExitPoints.push({ id: elifConditionId, label: "True" });
        }
        allExitPoints.push(...elifConsequenceResult.exitPoints);
      } else if (clause.type === "else_clause") {
        elseClause = clause;
        break;
      }
    }

    if (elseClause) {
      const elseBody = elseClause.childForFieldName("body");
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
        allExitPoints.push({ id: lastConditionId, label: "False" });
      }
      allExitPoints.push(...elseResult.exitPoints);
    } else {
      allExitPoints.push({ id: lastConditionId, label: "False" });
    }

    return {
      nodes,
      edges,
      entryNodeId: entryNodeId,
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

    bodyResult.exitPoints.forEach((ep) => {
      edges.push({ from: ep.id, to: headerId });
    });

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

    bodyResult.exitPoints.forEach((ep) => {
      edges.push({ from: ep.id, to: conditionId });
    });

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
    const valueNodes = returnNode.namedChildren;
    let labelText: string;

    if (valueNodes.length > 0) {
      const returnValueText = valueNodes.map((n) => n.text).join(", ");
      labelText = `return ${this.escapeString(returnValueText)}`;
    } else {
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
      exitPoints: [],
      nodesConnectedToExit: new Set<string>().add(nodeId),
    };
  }

  /**
   * Processes a raise statement.
   */
  private processRaiseStatement(
    raiseNode: Parser.SyntaxNode,
    exitId: string,
    finallyContext?: { finallyEntryId: string }
  ): ProcessResult {
    const nodeId = this.generateNodeId("raise");
    const valueNodes = raiseNode.namedChildren;
    let labelText: string;

    if (valueNodes.length > 0) {
      const raiseValueText = valueNodes.map((n) => n.text).join(", ");
      labelText = `raise ${this.escapeString(raiseValueText)}`;
    } else {
      labelText = "raise";
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
      start: raiseNode.startIndex,
      end: raiseNode.endIndex,
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
   * Processes a match statement.
   */
  private processMatchStatement(
    matchNode: Parser.SyntaxNode,
    exitId: string,
    loopContext?: LoopContext,
    finallyContext?: { finallyEntryId: string }
  ): ProcessResult {
    const nodes: FlowchartNode[] = [];
    const edges: FlowchartEdge[] = [];
    const nodesConnectedToExit = new Set<string>();
    const allExitPoints: { id: string; label?: string }[] = [];

    const subjectNode = matchNode.childForFieldName("subject");
    if (!subjectNode) {
      return this.processDefaultStatement(matchNode);
    }

    const subjectId = this.generateNodeId("match_subject");
    nodes.push({
      id: subjectId,
      label: `match ${this.escapeString(subjectNode.text)}`,
      shape: "rect",
      style: this.nodeStyles.process,
    });
    this.locationMap.push({
      start: subjectNode.startIndex,
      end: subjectNode.endIndex,
      nodeId: subjectId,
    });

    const entryNodeId = subjectId;
    let lastConditionExit: { id: string; label?: string } = { id: subjectId };

    const caseClauses = matchNode.childrenForFieldName("case_clause");

    for (const clause of caseClauses) {
      const patternNode = clause.childForFieldName("pattern");
      const guardNode = clause.childForFieldName("guard");
      const bodyNode = clause.childForFieldName("body");

      if (!patternNode || !bodyNode) continue;

      let caseLabel = `case ${this.escapeString(patternNode.text)}`;
      if (guardNode) {
        caseLabel += ` if ${this.escapeString(guardNode.text)}`;
      }

      const caseConditionId = this.generateNodeId("case");
      nodes.push({
        id: caseConditionId,
        label: caseLabel,
        shape: "diamond",
        style: this.nodeStyles.decision,
      });
      this.locationMap.push({
        start: clause.startIndex,
        end: clause.endIndex,
        nodeId: caseConditionId,
      });

      edges.push({
        from: lastConditionExit.id,
        to: caseConditionId,
        label: lastConditionExit.label,
      });

      const bodyResult = this.processBlock(
        bodyNode,
        exitId,
        loopContext,
        finallyContext
      );
      nodes.push(...bodyResult.nodes);
      edges.push(...bodyResult.edges);
      bodyResult.nodesConnectedToExit.forEach((n) =>
        nodesConnectedToExit.add(n)
      );

      if (bodyResult.entryNodeId) {
        edges.push({
          from: caseConditionId,
          to: bodyResult.entryNodeId,
          label: "True",
        });
      } else {
        // If a case has no body, its "True" path is an exit point.
        allExitPoints.push({ id: caseConditionId, label: "True" });
      }
      allExitPoints.push(...bodyResult.exitPoints);

      lastConditionExit = { id: caseConditionId, label: "False" };
    }

    // The final "False" from the last case is an exit from the whole match statement.
    allExitPoints.push(lastConditionExit);

    return {
      nodes,
      edges,
      entryNodeId,
      exitPoints: allExitPoints,
      nodesConnectedToExit,
    };
  }

  /**
   * Processes a try-except-finally statement.
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
      if (finallyResult && finallyResult.entryNodeId) {
        edges.push({ from: entryId, to: finallyResult.entryNodeId });
      } else {
        allExitPoints.push({ id: entryId });
      }
    }

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
        edges.push({
          from: entryId,
          to: exceptResult.entryNodeId,
          label: `on ${exceptType}`,
        });

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

    if (finallyResult) {
      allExitPoints.push(...finallyResult.exitPoints);
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

  /**
   * Processes an assert statement.
   */
  private processAssertStatement(
    assertNode: Parser.SyntaxNode,
    exitId: string,
    loopContext?: LoopContext,
    finallyContext?: { finallyEntryId: string }
  ): ProcessResult {
    const nodes: FlowchartNode[] = [];
    const edges: FlowchartEdge[] = [];
    const nodesConnectedToExit = new Set<string>();
    const allExitPoints: { id: string; label?: string }[] = [];

    const conditionNode = assertNode.namedChildren[0];
    if (!conditionNode) {
      return this.processDefaultStatement(assertNode);
    }

    const conditionId = this.generateNodeId("assert_cond");
    nodes.push({
      id: conditionId,
      label: `assert ${this.escapeString(conditionNode.text)}`,
      shape: "diamond",
      style: this.nodeStyles.decision,
    });
    this.locationMap.push({
      start: assertNode.startIndex,
      end: assertNode.endIndex,
      nodeId: conditionId,
    });

    const entryNodeId = conditionId;

    // True path: continue execution
    allExitPoints.push({ id: conditionId, label: "True" });

    // False path: raise AssertionError
    const raiseNodeId = this.generateNodeId("raise_assert");
    let label = "raise AssertionError";
    if (assertNode.namedChildren.length > 1) {
      label += `: ${this.escapeString(assertNode.namedChildren[1].text)}`;
    }
    nodes.push({
      id: raiseNodeId,
      label: label,
      shape: "stadium",
      style: this.nodeStyles.special,
    });

    if (finallyContext) {
      edges.push({
        from: raiseNodeId,
        to: finallyContext.finallyEntryId,
        label: "False",
      });
    } else {
      edges.push({ from: raiseNodeId, to: exitId, label: "False" });
    }
    nodesConnectedToExit.add(raiseNodeId);
    edges.push({ from: conditionId, to: raiseNodeId, label: "False" });

    return {
      nodes,
      edges,
      entryNodeId,
      exitPoints: allExitPoints,
      nodesConnectedToExit,
    };
  }
}
