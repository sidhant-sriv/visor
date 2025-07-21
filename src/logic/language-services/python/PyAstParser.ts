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
 * It handles standard functions, lambda functions, and basic control flow,
 * including special visualization for higher-order functions like map, filter, and reduce.
 */
export class PyAstParser {
  private nodeIdCounter = 0;
  private locationMap: LocationMapEntry[] = [];
  private currentFunctionIsLambda = false; // Tracks if the current scope is a lambda
  private debug = true; // Set to true to enable console logging for diagnostics
  private readonly nodeStyles = {
    terminator: "fill:#f9f9f9,stroke:#333,stroke-width:2px,color:#333",
    decision: "fill:#fff,stroke:#333,stroke-width:1.5px,color:#333",
    process: "fill:#fff,stroke:#333,stroke-width:1.5px,color:#333",
    special: "fill:#e3f2fd,stroke:#0d47a1,stroke-width:1.5px,color:#000",
    break: "fill:#ffebee,stroke:#c62828,stroke-width:1.5px,color:#000",
    hof: "fill:#e8eaf6,stroke:#3f51b5,stroke-width:1.5px,color:#000",
  };

  private log(message: string, ...args: any[]) {
    if (this.debug) {
      console.log(`[PyAstParser] ${message}`, ...args);
    }
  }

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
   * Checks if a given AST node is a call to a handled higher-order function.
   */
  private isHofCall(node: Parser.SyntaxNode | null | undefined): boolean {
    if (!node || node.type !== "call") return false;
    const functionNode = node.childForFieldName("function");
    if (!functionNode) return false;
    const functionName = functionNode.text.split(".").pop();
    const isHof = ["map", "filter", "reduce"].includes(functionName!);
    this.log(`isHofCall check on "${functionNode.text}": ${isHof}`);
    return isHof;
  }

  /**
   * Generates a detailed, self-contained flowchart for a higher-order function statement.
   * This orchestrates the generation by handling assignment and container (e.g., list()) wrappers.
   */
  private generateHofFlowchart(
    statementNode: Parser.SyntaxNode,
    hofCallNode: Parser.SyntaxNode,
    containerName?: string
  ): FlowchartIR {
    this.log("Generating HOF flowchart.", { statementNode: statementNode.text, hofCallNode: hofCallNode.text, containerName });
    this.nodeIdCounter = 0;
    this.locationMap = [];

    const nodes: FlowchartNode[] = [];
    const edges: FlowchartEdge[] = [];

    // 1. Process the core HOF logic (map, filter, etc.)
    const hofResult = this.processHigherOrderFunctionCall(hofCallNode);
    if (!hofResult) {
        this.log("HOF processing returned null, falling back to default.");
        return this.generateFlowchart(statementNode.text);
    }

    nodes.push(...hofResult.nodes);
    edges.push(...hofResult.edges);

    let entryPointId = hofResult.entryNodeId;
    let finalExitPoints = hofResult.exitPoints;

    // 2. Prepend an assignment node if the HOF is part of an assignment
    if (statementNode.type === 'assignment' || (statementNode.type === 'expression_statement' && statementNode.namedChild(0)?.type === 'assignment')) {
        const assignment = statementNode.type === 'assignment' ? statementNode : statementNode.namedChild(0)!;
        const assignId = this.generateNodeId("assign_hof");
        const leftText = this.escapeString(assignment.childForFieldName("left")!.text);
        const assignNode: FlowchartNode = {
            id: assignId,
            label: `${leftText} = ...`,
            shape: "rect",
            style: this.nodeStyles.process,
        };
        nodes.unshift(assignNode);
        if (entryPointId) {
            edges.unshift({ from: assignId, to: entryPointId });
        }
        entryPointId = assignId;
        this.locationMap.push({
            start: assignment.childForFieldName("left")!.startIndex,
            end: assignment.childForFieldName("left")!.endIndex,
            nodeId: assignId,
        });
    }

    // 3. Append a container conversion node if the HOF was wrapped (e.g., list(map(...)))
    if (containerName) {
        const convertId = this.generateNodeId("convert");
        const convertNode: FlowchartNode = {
            id: convertId,
            label: `Convert to ${containerName}`,
            shape: "rect",
            style: this.nodeStyles.process,
        };
        nodes.push(convertNode);
        finalExitPoints.forEach(ep => {
            edges.push({ from: ep.id, to: convertId, label: ep.label });
        });
        finalExitPoints = [{ id: convertId }];
    }

    // 4. Add the global start and end nodes for the complete flowchart
    const startId = this.generateNodeId("start");
    const endId = this.generateNodeId("end");
    nodes.unshift({ id: startId, label: "Start", shape: "round", style: this.nodeStyles.terminator });
    nodes.push({ id: endId, label: "End", shape: "round", style: this.nodeStyles.terminator });

    if (entryPointId) {
        edges.unshift({ from: startId, to: entryPointId });
    } else {
        edges.unshift({ from: startId, to: endId });
    }

    finalExitPoints.forEach(ep => {
        edges.push({ from: ep.id, to: endId, label: ep.label });
    });

    const statementText = this.escapeString(statementNode.text);
    const title = `Flowchart for: ${statementText}`;

    return {
        nodes,
        edges,
        locationMap: this.locationMap,
        functionRange: { start: statementNode.startIndex, end: statementNode.endIndex },
        title,
        entryNodeId: startId,
        exitNodeId: endId,
    };
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
    const parser = new Parser();
    parser.setLanguage(Python as PythonLanguage);
    const tree = parser.parse(sourceCode);
    this.log("Starting flowchart generation.", { functionName, position });

    // Priority 1: If a cursor position is provided, check if it's on a HOF statement.
    if (position !== undefined) {
      this.log(`Searching for statement at position: ${position}`);
      const statements = tree.rootNode.descendantsOfType([
        "assignment",
        "expression_statement",
        "return_statement",
      ]);

      let smallestStatement: Parser.SyntaxNode | undefined;
      for (const stmt of statements) {
        if (position >= stmt.startIndex && position <= stmt.endIndex) {
          if (
            !smallestStatement ||
            stmt.endIndex - stmt.startIndex <
              smallestStatement.endIndex - smallestStatement.startIndex
          ) {
            smallestStatement = stmt;
          }
        }
      }
      
      if (smallestStatement) {
        this.log(`Found smallest statement: [${smallestStatement.type}] ${smallestStatement.text}`);
        
        let potentialCallNode: Parser.SyntaxNode | null | undefined;
        let baseStatement = smallestStatement;

        if (smallestStatement.type === 'assignment') {
            potentialCallNode = smallestStatement.childForFieldName("right");
        } else if (smallestStatement.type === 'expression_statement') {
            const child = smallestStatement.namedChild(0);
            if (child?.type === 'assignment') {
                potentialCallNode = child.childForFieldName("right");
                baseStatement = child; // Treat the inner assignment as the base
            } else {
                potentialCallNode = child;
            }
        } else if (smallestStatement.type === 'return_statement') {
            potentialCallNode = smallestStatement.namedChild(0);
        }
        
        this.log(`Extracted potential call node: [${potentialCallNode?.type}] ${potentialCallNode?.text}`);

        if (potentialCallNode?.type === 'call') {
            const funcNode = potentialCallNode.childForFieldName('function');
            const funcName = funcNode?.text;
            const argsNode = potentialCallNode.childForFieldName("arguments");
            const args = argsNode?.namedChildren || [];
            this.log(`Expression is a call to "${funcName}" with ${args.length} arguments.`);

            let hofCallNode: Parser.SyntaxNode | undefined = undefined;
            let containerName: string | undefined = undefined;

            // Check if it's a container (list, tuple, set) wrapping a HOF call
            if ((funcName === 'list' || funcName === 'tuple' || funcName === 'set') && args.length === 1 && args[0].type === 'call' && this.isHofCall(args[0])) {
                this.log(`Detected HOF call wrapped in container "${funcName}".`);
                hofCallNode = args[0];
                containerName = funcName;
            }
            // Check if it's a direct HOF call
            else if (this.isHofCall(potentialCallNode)) {
                this.log(`Detected direct HOF call.`);
                hofCallNode = potentialCallNode;
            }

            if (hofCallNode) {
                return this.generateHofFlowchart(baseStatement, hofCallNode, containerName);
            } else {
                this.log(`Call to "${funcName}" is not a handled HOF. Proceeding to normal function search.`);
            }
        }
      } else {
          this.log("No statement found at the given position.");
      }
    }

    // Priority 2: Fallback to finding the containing function or lambda and graphing it.
    let targetNode: Parser.SyntaxNode | undefined;
    let isLambda = false;

    if (position !== undefined) {
      targetNode = tree.rootNode
        .descendantsOfType("function_definition")
        .find((f) => position >= f.startIndex && position <= f.endIndex);

      if (!targetNode) {
        const assignmentNode = tree.rootNode
          .descendantsOfType("assignment")
          .find(
            (a) =>
              position >= a.startIndex &&
              position <= a.endIndex &&
              a.childForFieldName("right")?.type === "lambda"
          );
        if (assignmentNode) {
          targetNode = assignmentNode;
          isLambda = true;
        }
      }
    } else if (functionName) {
      targetNode = tree.rootNode
        .descendantsOfType("function_definition")
        .find((f) => f.childForFieldName("name")?.text === functionName);
      if (!targetNode) {
        const assignmentNode = tree.rootNode
          .descendantsOfType("assignment")
          .find(
            (a) =>
              a.childForFieldName("left")?.text === functionName &&
              a.childForFieldName("right")?.type === "lambda"
          );
        if (assignmentNode) {
          targetNode = assignmentNode;
          isLambda = true;
        }
      }
    } else {
      targetNode = tree.rootNode.descendantsOfType("function_definition")[0];
    }

    if (!targetNode) {
      this.log("No target function or HOF statement found. Displaying default message.");
      return {
        nodes: [
          {
            id: "A",
            label:
              "Place cursor inside a function or statement to generate a flowchart.",
            shape: "rect",
          },
        ],
        edges: [],
        locationMap: [],
      };
    }

    // Reset state and process the entire function/lambda
    this.log(`Found target ${isLambda ? 'lambda' : 'function'}: ${targetNode.text}`);
    this.nodeIdCounter = 0;
    this.locationMap = [];
    this.currentFunctionIsLambda = isLambda;

    let bodyToProcess: Parser.SyntaxNode | null;
    let title: string;

    if (isLambda) {
      const lambdaNode = targetNode.childForFieldName("right")!;
      bodyToProcess = lambdaNode.childForFieldName("body");
      const funcName = this.escapeString(
        targetNode.childForFieldName("left")!.text
      );
      title = `Flowchart for lambda: ${funcName}`;
    } else {
      bodyToProcess = targetNode.childForFieldName("body");
      const funcName = this.escapeString(
        targetNode.childForFieldName("name")!.text
      );
      title = `Flowchart for function: ${funcName}`;
    }

    if (!bodyToProcess) {
      return {
        nodes: [{ id: "A", label: "Function has no body.", shape: "rect" }],
        edges: [],
        locationMap: [],
      };
    }

    const nodes: FlowchartNode[] = [];
    const edges: FlowchartEdge[] = [];
    const entryId = this.generateNodeId("start");
    const exitId = this.generateNodeId("end");

    nodes.push({
      id: entryId,
      label: `Start`,
      shape: "round",
      style: this.nodeStyles.terminator,
    });
    nodes.push({
      id: exitId,
      label: "End",
      shape: "round",
      style: this.nodeStyles.terminator,
    });

    let bodyResult;
    if (isLambda) {
      bodyResult = this.processStatement(bodyToProcess, exitId);
    } else {
      bodyResult = this.processBlock(bodyToProcess, exitId);
    }

    nodes.push(...bodyResult.nodes);
    edges.push(...bodyResult.edges);

    if (bodyResult.entryNodeId) {
      edges.push({ from: entryId, to: bodyResult.entryNodeId });
    } else {
      edges.push({ from: entryId, to: exitId });
    }

    bodyResult.exitPoints.forEach((ep) => {
      if (!bodyResult.nodesConnectedToExit.has(ep.id)) {
        edges.push({ from: ep.id, to: exitId, label: ep.label });
      }
    });

    const nodeIdSet = new Set(nodes.map((n) => n.id));
    const validEdges = edges.filter(
      (e) => nodeIdSet.has(e.from) && nodeIdSet.has(e.to)
    );

    return {
      nodes,
      edges: validEdges,
      locationMap: this.locationMap,
      functionRange: {
        start: targetNode.startIndex,
        end: targetNode.endIndex,
      },
      title,
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
    if (statement.type === "conditional_expression") {
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
      default: {
        // When processing a function block, HOFs are treated as simple statements.
        // The detailed breakdown only happens when a HOF line is clicked directly.
        if (this.currentFunctionIsLambda) {
          return this.processReturnStatementForExpression(
            statement,
            exitId,
            finallyContext
          );
        } else {
          return this.processDefaultStatement(statement);
        }
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

    if (
      alternativeNode.type === "parenthesized_expression" &&
      alternativeNode.namedChild(0)?.type === "conditional_expression"
    ) {
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
        allExitPoints.push({ id: caseConditionId, label: "True" });
      }
      allExitPoints.push(...bodyResult.exitPoints);

      lastConditionExit = { id: caseConditionId, label: "False" };
    }

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

    allExitPoints.push({ id: conditionId, label: "True" });

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
      });
    } else {
      edges.push({ from: raiseNodeId, to: exitId });
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

  /**
   * Dispatches a call expression to a specialized HOF processor if applicable.
   */
  private processHigherOrderFunctionCall(
    callNode: Parser.SyntaxNode
  ): ProcessResult | null {
    const functionNode = callNode.childForFieldName("function");
    if (!functionNode) return null;

    const functionName = functionNode.text.split(".").pop();
    this.log(`Processing HOF call: ${functionName}`);

    switch (functionName) {
      case "map":
        return this.processMap(callNode);
      case "filter":
        return this.processFilter(callNode);
      case "reduce":
        return this.processReduce(callNode);
      default:
        this.log(`Unknown HOF: ${functionName}`);
        return null;
    }
  }

  /**
   * Generates a detailed flowchart for a 'map(function, iterable)' call.
   */
  private processMap(callNode: Parser.SyntaxNode): ProcessResult {
    const nodes: FlowchartNode[] = [];
    const edges: FlowchartEdge[] = [];

    const args = callNode.childForFieldName("arguments")?.namedChildren || [];
    if (args.length < 2) return this.processDefaultStatement(callNode);

    const functionArg = args[0];
    const iterableArgNode = args[1];
    const iterableText = this.escapeString(iterableArgNode.text);
    const functionText = this.escapeString(functionArg.text);
    const lambdaBodyText =
      functionArg.type === "lambda"
        ? this.escapeString(functionArg.childForFieldName("body")!.text)
        : `${functionText}(item)`;

    // Node 1: Input Iterable
    const inputId = this.generateNodeId("map_input");
    nodes.push({
      id: inputId,
      label: `Input List: ${iterableText}`,
      shape: "rect",
      style: this.nodeStyles.special,
    });
    this.locationMap.push({
        start: iterableArgNode.startIndex,
        end: iterableArgNode.endIndex,
        nodeId: inputId,
    });

    // Node 2: Map call (Loop Controller)
    const mapId = this.generateNodeId("map_call");
    nodes.push({
      id: mapId,
      label: `map()`,
      shape: "rect",
      style: this.nodeStyles.hof,
    });
    edges.push({ from: inputId, to: mapId });

    // Node 3: Apply lambda
    const applyId = this.generateNodeId("map_apply");
    nodes.push({
      id: applyId,
      label: `Apply lambda to each element: new_item = ${lambdaBodyText}`,
      shape: "rect",
      style: this.nodeStyles.process,
    });
    this.locationMap.push({
        start: functionArg.startIndex,
        end: functionArg.endIndex,
        nodeId: applyId,
    });
    edges.push({ from: mapId, to: applyId, label: "Next item" });

    // Node 4: Collect result and loop back
    const collectId = this.generateNodeId("map_collect");
    nodes.push({
        id: collectId,
        label: "Collect transformed element",
        shape: "rect",
        style: this.nodeStyles.process,
    });
    edges.push({ from: applyId, to: collectId });
    edges.push({ from: collectId, to: mapId }); // Loop back to controller

    // Node 5: Final output
    const resultId = this.generateNodeId("map_result");
    nodes.push({
      id: resultId,
      label: "Collected results",
      shape: "rect",
      style: this.nodeStyles.special,
    });
    edges.push({ from: mapId, to: resultId, label: "End of list" });

    return {
      nodes,
      edges,
      entryNodeId: inputId,
      exitPoints: [{ id: resultId }],
      nodesConnectedToExit: new Set<string>(),
    };
  }

  /**
   * Generates a detailed flowchart for a 'filter(function, iterable)' call.
   */
  private processFilter(callNode: Parser.SyntaxNode): ProcessResult {
    const nodes: FlowchartNode[] = [];
    const edges: FlowchartEdge[] = [];

    const args = callNode.childForFieldName("arguments")?.namedChildren || [];
    if (args.length < 2) return this.processDefaultStatement(callNode);

    const functionArg = args[0];
    const iterableArgNode = args[1];
    const iterableText = this.escapeString(iterableArgNode.text);

    // Node 1: Input Iterable
    const inputId = this.generateNodeId("filter_input");
    nodes.push({
      id: inputId,
      label: `Input List: ${iterableText}`,
      shape: "rect",
      style: this.nodeStyles.special,
    });
    this.locationMap.push({
        start: iterableArgNode.startIndex,
        end: iterableArgNode.endIndex,
        nodeId: inputId,
    });

    // Node 2: Filter call (Loop Controller)
    const filterId = this.generateNodeId("filter_call");
    nodes.push({
      id: filterId,
      label: `filter()`,
      shape: "rect",
      style: this.nodeStyles.hof,
    });
    edges.push({ from: inputId, to: filterId });

    // Node 3: Apply lambda
    const applyId = this.generateNodeId("filter_apply");
    nodes.push({
      id: applyId,
      label: `Apply lambda to each element`,
      shape: "rect",
      style: this.nodeStyles.process,
    });
    this.locationMap.push({
        start: functionArg.startIndex,
        end: functionArg.endIndex,
        nodeId: applyId,
    });
    edges.push({ from: filterId, to: applyId, label: "Next item" });

    // Node 4: Decision
    const decisionId = this.generateNodeId("filter_decision");
    nodes.push({
      id: decisionId,
      label: `lambda returns True?`,
      shape: "diamond",
      style: this.nodeStyles.decision,
    });
    edges.push({ from: applyId, to: decisionId });

    // Node 5: Keep element
    const keepId = this.generateNodeId("filter_keep");
    nodes.push({
      id: keepId,
      label: "Keep element",
      shape: "rect",
      style: this.nodeStyles.process,
    });
    edges.push({ from: decisionId, to: keepId, label: "Yes" });
    edges.push({ from: keepId, to: filterId }); // Loop back to controller

    // Node 6: Discard element
    const discardId = this.generateNodeId("filter_discard");
    nodes.push({
        id: discardId,
        label: "Discard element",
        shape: "rect",
        style: this.nodeStyles.break,
    });
    edges.push({ from: decisionId, to: discardId, label: "No" });
    edges.push({ from: discardId, to: filterId }); // Loop back to controller

    // Node 7: Collected results
    const collectedId = this.generateNodeId("filter_collected");
    nodes.push({
      id: collectedId,
      label: "Collected results",
      shape: "rect",
      style: this.nodeStyles.special,
    });
    edges.push({ from: filterId, to: collectedId, label: "End of list" });


    return {
      nodes,
      edges,
      entryNodeId: inputId,
      exitPoints: [{ id: collectedId }],
      nodesConnectedToExit: new Set<string>(),
    };
  }

  /**
   * Generates a detailed flowchart for a 'reduce(function, iterable[, initializer])' call.
   */
  private processReduce(callNode: Parser.SyntaxNode): ProcessResult {
    const nodes: FlowchartNode[] = [];
    const edges: FlowchartEdge[] = [];

    const args = callNode.childForFieldName("arguments")?.namedChildren || [];
    if (args.length < 2) return this.processDefaultStatement(callNode);

    const functionArg = args[0];
    const iterableArgNode = args[1];
    const functionText = this.escapeString(functionArg.text);
    const iterableText = this.escapeString(iterableArgNode.text);
    const hasInitializer = args.length > 2;
    const initializerArgNode = hasInitializer ? args[2] : null;
    const initializerText = initializerArgNode
      ? this.escapeString(initializerArgNode.text)
      : `first item of ${iterableText}`;

    // Node 1: Input Iterable
    const inputId = this.generateNodeId("reduce_input");
    nodes.push({
      id: inputId,
      label: `Input: ${iterableText}`,
      shape: "rect",
      style: this.nodeStyles.special,
    });
    this.locationMap.push({
        start: iterableArgNode.startIndex,
        end: iterableArgNode.endIndex,
        nodeId: inputId,
    });

    // Node 2: Initialize Accumulator
    const initId = this.generateNodeId("reduce_init");
    nodes.push({
      id: initId,
      label: `accumulator = ${initializerText}`,
      shape: "rect",
      style: this.nodeStyles.process,
    });
    if (initializerArgNode) {
        this.locationMap.push({
            start: initializerArgNode.startIndex,
            end: initializerArgNode.endIndex,
            nodeId: initId,
        });
    }
    edges.push({ from: inputId, to: initId });


    // Node 3: Loop Header (Controller)
    const headerId = this.generateNodeId("reduce_header");
    const loopLabel = hasInitializer
      ? `For each item`
      : `For each remaining item`;
    nodes.push({
      id: headerId,
      label: loopLabel,
      shape: "rect",
      style: this.nodeStyles.hof,
    });
    edges.push({ from: initId, to: headerId });

    // Node 4: Apply function
    const applyId = this.generateNodeId("reduce_apply");
    nodes.push({
      id: applyId,
      label: `accumulator = ${functionText}(accumulator, item)`,
      shape: "rect",
      style: this.nodeStyles.process,
    });
    this.locationMap.push({
        start: functionArg.startIndex,
        end: functionArg.endIndex,
        nodeId: applyId,
    });
    edges.push({ from: headerId, to: applyId, label: "Next" });
    edges.push({ from: applyId, to: headerId }); // Loop back

    // Node 5: Return result
    const resultId = this.generateNodeId("reduce_result");
    nodes.push({
      id: resultId,
      label: "Return final accumulator value",
      shape: "rect",
      style: this.nodeStyles.special,
    });
    edges.push({ from: headerId, to: resultId, label: "End" });

    return {
      nodes,
      edges,
      entryNodeId: inputId,
      exitPoints: [{ id: resultId }],
      nodesConnectedToExit: new Set<string>(),
    };
  }
}