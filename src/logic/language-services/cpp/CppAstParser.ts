import Parser from "web-tree-sitter";
import { AbstractParser } from "../../common/AbstractParser";
import {
  FlowchartIR,
  FlowchartNode,
  FlowchartEdge,
  NodeType,
} from "../../../ir/ir";
import { ProcessResult, LoopContext } from "../../common/AstParserTypes";

export class CppAstParser extends AbstractParser {
  private currentFunctionIsLambda = false;

  private constructor(parser: Parser) {
    super(parser, "cpp");
  }

  /**
   * Asynchronously creates and initializes an instance of CppAstParser.
   * This is the required entry point for creating a parser instance.
   * @param wasmPath The file path to the tree-sitter-cpp.wasm file.
   * @returns A promise that resolves to a new CppAstParser instance.
   */
  public static async create(wasmPath: string): Promise<CppAstParser> {
    await Parser.init();
    const language = await Parser.Language.load(wasmPath);
    const parser = new Parser();
    parser.setLanguage(language);
    return new CppAstParser(parser);
  }

  public listFunctions(sourceCode: string): string[] {
    return this.measurePerformance("listFunctions", () => {
      const tree = this.parser.parse(sourceCode);

      // Get function definitions
      const funcNames = tree.rootNode
        .descendantsOfType("function_definition")
        .map((f: Parser.SyntaxNode) => {
          const declarator = f.childForFieldName("declarator");
          return this.extractFunctionName(declarator) || "[anonymous]";
        });

      // Get method definitions (inside classes)
      const methodNames = tree.rootNode
        .descendantsOfType("function_definition")
        .filter((f: Parser.SyntaxNode) => {
          // Check if this function is inside a class
          let parent = f.parent;
          while (parent) {
            if (
              parent.type === "class_specifier" ||
              parent.type === "struct_specifier"
            ) {
              return true;
            }
            parent = parent.parent;
          }
          return false;
        })
        .map((m: Parser.SyntaxNode) => {
          const declarator = m.childForFieldName("declarator");
          const funcName = this.extractFunctionName(declarator);
          return funcName ? `${funcName} (method)` : "[anonymous method]";
        });

      // Get lambda expressions assigned to variables
      const lambdaNames = tree.rootNode
        .descendantsOfType("init_declarator")
        .filter((v) => {
          const value = v.childForFieldName("value");
          return value?.type === "lambda_expression";
        })
        .map((v) => {
          const declarator = v.childForFieldName("declarator");
          return this.extractVariableName(declarator) || "[anonymous lambda]";
        });

      return [...funcNames, ...methodNames, ...lambdaNames];
    });
  }

  public findFunctionAtPosition(
    sourceCode: string,
    position: number
  ): string | undefined {
    const tree = this.parser.parse(sourceCode);

    // Check function definitions
    let func = tree.rootNode
      .descendantsOfType("function_definition")
      .find((f) => position >= f.startIndex && position <= f.endIndex);
    if (func) {
      const declarator = func.childForFieldName("declarator");
      return this.extractFunctionName(declarator) || "[anonymous]";
    }

    // Check lambda expressions
    const lambda = tree.rootNode
      .descendantsOfType("init_declarator")
      .find((v) => {
        const value = v.childForFieldName("value");
        return (
          position >= v.startIndex &&
          position <= v.endIndex &&
          value?.type === "lambda_expression"
        );
      });
    if (lambda) {
      const declarator = lambda.childForFieldName("declarator");
      return this.extractVariableName(declarator) || "[anonymous lambda]";
    }

    return undefined;
  }

  public generateFlowchart(
    sourceCode: string,
    functionName?: string,
    position?: number
  ): FlowchartIR {
    const tree = this.parser.parse(sourceCode);
    this.resetState();

    let targetNode: Parser.SyntaxNode | undefined;
    let isLambda = false;

    if (position !== undefined) {
      // Try to find function definition at position
      targetNode = tree.rootNode
        .descendantsOfType("function_definition")
        .find((f) => position >= f.startIndex && position <= f.endIndex);

      if (!targetNode) {
        // Try to find lambda expression at position
        targetNode = tree.rootNode
          .descendantsOfType("init_declarator")
          .find((v) => {
            const value = v.childForFieldName("value");
            return (
              position >= v.startIndex &&
              position <= v.endIndex &&
              value?.type === "lambda_expression"
            );
          });
        isLambda = !!targetNode;
      }
    } else if (functionName) {
      // Find by function name
      targetNode = tree.rootNode
        .descendantsOfType("function_definition")
        .find((f) => {
          const declarator = f.childForFieldName("declarator");
          return this.extractFunctionName(declarator) === functionName;
        });

      if (!targetNode) {
        targetNode = tree.rootNode
          .descendantsOfType("init_declarator")
          .find((v) => {
            const declarator = v.childForFieldName("declarator");
            const value = v.childForFieldName("value");
            return (
              this.extractVariableName(declarator) === functionName &&
              value?.type === "lambda_expression"
            );
          });
        isLambda = !!targetNode;
      }
    } else {
      // Get first function
      targetNode =
        tree.rootNode.descendantsOfType("function_definition")[0] ||
        tree.rootNode
          .descendantsOfType("init_declarator")
          .find(
            (v) => v.childForFieldName("value")?.type === "lambda_expression"
          );

      if (targetNode?.type === "init_declarator") {
        isLambda = true;
      }
    }

    if (!targetNode) {
      return {
        nodes: [
          {
            id: "A",
            label: "Place cursor inside a function to generate a flowchart.",
            shape: "rect",
          },
        ],
        edges: [],
        locationMap: [],
      };
    }

    this.currentFunctionIsLambda = isLambda;

    // Get function body and name
    let bodyToProcess: Parser.SyntaxNode | null = null;
    let funcNameStr = "";

    if (isLambda) {
      const lambdaExpr = targetNode.childForFieldName("value");
      bodyToProcess = lambdaExpr?.childForFieldName("body") || null;
      const declarator = targetNode.childForFieldName("declarator");
      funcNameStr = this.escapeString(
        this.extractVariableName(declarator) || "[anonymous lambda]"
      );
    } else {
      bodyToProcess = targetNode.childForFieldName("body");
      const declarator = targetNode.childForFieldName("declarator");
      funcNameStr = this.escapeString(
        this.extractFunctionName(declarator) || "[anonymous function]"
      );
    }

    const title = `Flowchart for ${
      isLambda ? "lambda" : "function"
    }: ${funcNameStr}`;

    if (!bodyToProcess) {
      return {
        nodes: [
          this.createSemanticNode(
            "A",
            "Function has no body.",
            NodeType.PROCESS
          ),
        ],
        edges: [],
        locationMap: [],
      };
    }

    const nodes: FlowchartNode[] = [];
    const edges: FlowchartEdge[] = [];
    const entryId = this.generateNodeId("start");
    const exitId = this.generateNodeId("end");

    // Create semantic entry and exit nodes
    nodes.push(
      this.createSemanticNode(entryId, "Start", NodeType.ENTRY, targetNode)
    );
    nodes.push(
      this.createSemanticNode(exitId, "End", NodeType.EXIT, targetNode)
    );

    // For lambda expressions with expression bodies, handle them differently
    const bodyResult =
      isLambda && bodyToProcess.type !== "compound_statement"
        ? this.processStatement(bodyToProcess, exitId)
        : this.processBlock(bodyToProcess, exitId);

    nodes.push(...bodyResult.nodes);
    edges.push(...bodyResult.edges);

    edges.push(
      bodyResult.entryNodeId
        ? { from: entryId, to: bodyResult.entryNodeId }
        : { from: entryId, to: exitId }
    );

    bodyResult.exitPoints.forEach((ep) => {
      if (!bodyResult.nodesConnectedToExit.has(ep.id)) {
        edges.push({ from: ep.id, to: exitId, label: ep.label });
      }
    });

    const nodeIdSet = new Set(nodes.map((n) => n.id));
    const validEdges = edges.filter(
      (e) => nodeIdSet.has(e.from) && nodeIdSet.has(e.to)
    );

    const ir: FlowchartIR = {
      nodes,
      edges: validEdges,
      locationMap: this.locationMap,
      functionRange: { start: targetNode.startIndex, end: targetNode.endIndex },
      title,
      entryNodeId: entryId,
      exitNodeId: exitId,
    };

    // Add function complexity analysis
    this.addFunctionComplexity(ir, targetNode);

    return ir;
  }

  protected processStatement(
    statement: Parser.SyntaxNode,
    exitId: string,
    loopContext?: LoopContext,
    finallyContext?: { finallyEntryId: string }
  ): ProcessResult {
    // Handle parenthesized expressions
    if (
      statement.type === "parenthesized_expression" &&
      statement.namedChild(0)
    ) {
      return this.processStatement(
        statement.namedChild(0)!,
        exitId,
        loopContext,
        finallyContext
      );
    }

    // Handle conditional expressions (ternary operator)
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
      case "for_range_loop":
        return this.processForRangeLoop(statement, exitId, finallyContext);
      case "while_statement":
        return this.processWhileStatement(statement, exitId, finallyContext);
      case "do_statement":
        return this.processDoWhileStatement(statement, exitId, finallyContext);
      case "try_statement":
        return this.processTryStatement(
          statement,
          exitId,
          loopContext,
          finallyContext
        );
      case "switch_statement":
        return this.processSwitchStatement(
          statement,
          exitId,
          loopContext,
          finallyContext
        );
      case "return_statement":
        return this.processReturnStatement(statement, exitId, finallyContext);
      case "throw_statement":
        return this.processThrowStatement(statement, exitId, finallyContext);
      case "break_statement":
        return loopContext
          ? this.processBreakStatement(statement, loopContext)
          : this.processDefaultStatement(statement);
      case "continue_statement":
        return loopContext
          ? this.processContinueStatement(statement, loopContext)
          : this.processDefaultStatement(statement);
      case "goto_statement":
        return this.processGotoStatement(statement, exitId);
      case "labeled_statement":
        return this.processLabeledStatement(
          statement,
          exitId,
          loopContext,
          finallyContext
        );
      case ";":
        return this.createProcessResult(); // Empty statement
      default: {
        // Handle variable declarations and assignments
        let expressionNode: Parser.SyntaxNode | undefined;
        let assignmentTargetNode: Parser.SyntaxNode | undefined;

        if (statement.type === "declaration") {
          return this.processVariableDeclaration(
            statement,
            exitId,
            loopContext,
            finallyContext
          );
        } else if (statement.type === "assignment_expression") {
          expressionNode = statement.childForFieldName("right") ?? undefined;
          assignmentTargetNode =
            statement.childForFieldName("left") ?? undefined;
        } else if (statement.type === "expression_statement") {
          const child = statement.firstNamedChild;
          if (child?.type === "assignment_expression") {
            return this.processStatement(
              child,
              exitId,
              loopContext,
              finallyContext
            );
          }
          expressionNode = child ?? undefined;
        }

        // Handle ternary expressions in assignments
        if (
          expressionNode?.type === "conditional_expression" &&
          assignmentTargetNode
        ) {
          const conditionNode = expressionNode.childForFieldName("condition");
          const consequenceNode =
            expressionNode.childForFieldName("consequence");
          const alternativeNode =
            expressionNode.childForFieldName("alternative");

          if (!conditionNode || !consequenceNode || !alternativeNode) {
            return this.processDefaultStatement(statement);
          }

          const targetText = this.escapeString(assignmentTargetNode.text);
          const conditionId = this.generateNodeId("ternary_cond");

          const nodes: FlowchartNode[] = [
            this.createSemanticNode(
              conditionId,
              conditionNode.text,
              NodeType.DECISION,
              conditionNode
            ),
          ];
          const edges: FlowchartEdge[] = [];

          this.locationMap.push({
            start: conditionNode.startIndex,
            end: conditionNode.endIndex,
            nodeId: conditionId,
          });

          const consequenceId = this.generateNodeId("ternary_true");
          nodes.push(
            this.createSemanticNode(
              consequenceId,
              `${targetText} = ${this.escapeString(consequenceNode.text)}`,
              NodeType.ASSIGNMENT,
              statement
            )
          );
          this.locationMap.push({
            start: statement.startIndex,
            end: statement.endIndex,
            nodeId: consequenceId,
          });
          edges.push({ from: conditionId, to: consequenceId, label: "true" });

          const alternativeId = this.generateNodeId("ternary_false");
          nodes.push(
            this.createSemanticNode(
              alternativeId,
              `${targetText} = ${this.escapeString(alternativeNode.text)}`,
              NodeType.ASSIGNMENT,
              statement
            )
          );
          this.locationMap.push({
            start: statement.startIndex,
            end: statement.endIndex,
            nodeId: alternativeId,
          });
          edges.push({ from: conditionId, to: alternativeId, label: "false" });

          return this.createProcessResult(nodes, edges, conditionId, [
            { id: consequenceId },
            { id: alternativeId },
          ]);
        }

        // For lambda expressions, treat expressions as return statements
        return this.currentFunctionIsLambda
          ? this.processReturnStatementForExpression(
              statement,
              exitId,
              finallyContext
            )
          : this.processDefaultStatement(statement);
      }
    }
  }

  // --- PRIVATE HELPER AND PROCESSING METHODS --- //

  private extractFunctionName(
    declarator: Parser.SyntaxNode | null
  ): string | null {
    if (!declarator) return null;

    // Handle different declarator types
    if (declarator.type === "function_declarator") {
      const identifier = declarator.childForFieldName("declarator");
      return this.extractFunctionName(identifier);
    } else if (declarator.type === "pointer_declarator") {
      const pointee = declarator.childForFieldName("declarator");
      return this.extractFunctionName(pointee);
    } else if (declarator.type === "identifier") {
      return declarator.text;
    } else if (declarator.type === "qualified_identifier") {
      // For qualified names like ClassName::methodName, get the last part
      const parts = declarator.namedChildren;
      return parts.length > 0 ? parts[parts.length - 1].text : null;
    }

    return null;
  }

  private extractVariableName(
    declarator: Parser.SyntaxNode | null
  ): string | null {
    if (!declarator) return null;

    if (declarator.type === "identifier") {
      return declarator.text;
    } else if (declarator.type === "pointer_declarator") {
      const pointee = declarator.childForFieldName("declarator");
      return this.extractVariableName(pointee);
    } else if (declarator.type === "reference_declarator") {
      const referee = declarator.childForFieldName("declarator");
      return this.extractVariableName(referee);
    }

    return null;
  }

  private processConditionalExpression(
    condExprNode: Parser.SyntaxNode,
    exitId: string,
    loopContext?: LoopContext,
    finallyContext?: { finallyEntryId: string }
  ): ProcessResult {
    const conditionNode = condExprNode.childForFieldName("condition");
    const consequenceNode = condExprNode.childForFieldName("consequence");
    const alternativeNode = condExprNode.childForFieldName("alternative");

    if (!conditionNode || !consequenceNode || !alternativeNode) {
      return this.processDefaultStatement(condExprNode);
    }

    const conditionId = this.generateNodeId("cond_expr");
    const nodes: FlowchartNode[] = [
      this.createSemanticNode(
        conditionId,
        conditionNode.text,
        NodeType.DECISION,
        conditionNode
      ),
    ];
    this.locationMap.push({
      start: conditionNode.startIndex,
      end: conditionNode.endIndex,
      nodeId: conditionId,
    });

    const consequenceResult = this.processStatement(
      consequenceNode,
      exitId,
      loopContext,
      finallyContext
    );
    const alternativeResult = this.processStatement(
      alternativeNode,
      exitId,
      loopContext,
      finallyContext
    );

    nodes.push(...consequenceResult.nodes, ...alternativeResult.nodes);
    const edges: FlowchartEdge[] = [
      ...consequenceResult.edges,
      ...alternativeResult.edges,
    ];
    const nodesConnectedToExit = new Set<string>([
      ...consequenceResult.nodesConnectedToExit,
      ...alternativeResult.nodesConnectedToExit,
    ]);

    if (consequenceResult.entryNodeId) {
      edges.push({
        from: conditionId,
        to: consequenceResult.entryNodeId,
        label: "true",
      });
    }
    if (alternativeResult.entryNodeId) {
      edges.push({
        from: conditionId,
        to: alternativeResult.entryNodeId,
        label: "false",
      });
    }

    return this.createProcessResult(
      nodes,
      edges,
      conditionId,
      this.currentFunctionIsLambda
        ? []
        : [...consequenceResult.exitPoints, ...alternativeResult.exitPoints],
      nodesConnectedToExit
    );
  }

  private processIfStatement(
    ifNode: Parser.SyntaxNode,
    exitId: string,
    loopContext?: LoopContext,
    finallyContext?: { finallyEntryId: string }
  ): ProcessResult {
    const ifConditionNode = ifNode.childForFieldName("condition");
    const ifConsequenceNode = ifNode.childForFieldName("consequence");
    if (!ifConditionNode || !ifConsequenceNode)
      return this.createProcessResult();

    const ifConditionId = this.generateNodeId("if_cond");
    const nodes: FlowchartNode[] = [
      this.createSemanticNode(
        ifConditionId,
        ifConditionNode.text,
        NodeType.DECISION,
        ifConditionNode
      ),
    ];
    this.locationMap.push({
      start: ifConditionNode.startIndex,
      end: ifConditionNode.endIndex,
      nodeId: ifConditionId,
    });

    // Handle consequence - could be single statement or compound statement
    const ifConsequenceResult =
      ifConsequenceNode.type === "compound_statement"
        ? this.processBlock(
            ifConsequenceNode,
            exitId,
            loopContext,
            finallyContext
          )
        : this.processStatement(
            ifConsequenceNode,
            exitId,
            loopContext,
            finallyContext
          );

    nodes.push(...ifConsequenceResult.nodes);
    const edges: FlowchartEdge[] = [...ifConsequenceResult.edges];
    const nodesConnectedToExit = new Set<string>(
      ifConsequenceResult.nodesConnectedToExit
    );
    const allExitPoints: { id: string; label?: string }[] = [
      ...ifConsequenceResult.exitPoints,
    ];

    if (ifConsequenceResult.entryNodeId) {
      edges.push({
        from: ifConditionId,
        to: ifConsequenceResult.entryNodeId,
        label: "true",
      });
    } else {
      allExitPoints.push({ id: ifConditionId, label: "true" });
    }

    // Handle else clause
    const elseClause = ifNode.childForFieldName("alternative");
    if (elseClause) {
      // Handle alternative - could be single statement, compound statement, or another if statement
      const elseResult =
        elseClause.type === "compound_statement"
          ? this.processBlock(elseClause, exitId, loopContext, finallyContext)
          : this.processStatement(
              elseClause,
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
          from: ifConditionId,
          to: elseResult.entryNodeId,
          label: "false",
        });
      } else {
        allExitPoints.push({ id: ifConditionId, label: "false" });
      }
      allExitPoints.push(...elseResult.exitPoints);
    } else {
      allExitPoints.push({ id: ifConditionId, label: "false" });
    }

    return this.createProcessResult(
      nodes,
      edges,
      ifConditionId,
      allExitPoints,
      nodesConnectedToExit
    );
  }

  private processForStatement(
    forNode: Parser.SyntaxNode,
    exitId: string,
    finallyContext?: { finallyEntryId: string }
  ): ProcessResult {
    const init = forNode.childForFieldName("initializer");
    const condition = forNode.childForFieldName("condition");
    const update = forNode.childForFieldName("update");

    const headerText = `for (${init?.text || ""}; ${condition?.text || ""}; ${
      update?.text || ""
    })`;
    const headerId = this.generateNodeId("for_header");
    const loopExitId = this.generateNodeId("for_exit");

    const nodes: FlowchartNode[] = [
      this.createSemanticNode(
        headerId,
        headerText,
        NodeType.LOOP_START,
        forNode
      ),
      this.createSemanticNode(
        loopExitId,
        "end loop",
        NodeType.LOOP_END,
        forNode
      ),
    ];
    this.locationMap.push({
      start: forNode.startIndex,
      end: forNode.endIndex,
      nodeId: headerId,
    });

    const loopContext: LoopContext = {
      breakTargetId: loopExitId,
      continueTargetId: headerId,
    };

    // Handle body - could be single statement or compound statement
    const bodyNode = forNode.childForFieldName("body");
    if (!bodyNode) {
      return this.createProcessResult();
    }

    const bodyResult =
      bodyNode.type === "compound_statement"
        ? this.processBlock(bodyNode, exitId, loopContext, finallyContext)
        : this.processStatement(bodyNode, exitId, loopContext, finallyContext);

    nodes.push(...bodyResult.nodes);
    const edges: FlowchartEdge[] = [...bodyResult.edges];

    if (bodyResult.entryNodeId) {
      edges.push({
        from: headerId,
        to: bodyResult.entryNodeId,
        label: "continue",
      });
    } else {
      edges.push({ from: headerId, to: headerId, label: "continue" });
    }

    // Connect all body exit points back to header for loop continuation
    bodyResult.exitPoints.forEach((ep) => {
      if (!bodyResult.nodesConnectedToExit.has(ep.id)) {
        edges.push({ from: ep.id, to: headerId, label: ep.label });
      }
    });
    edges.push({ from: headerId, to: loopExitId, label: "exit" });

    return this.createProcessResult(
      nodes,
      edges,
      headerId,
      [{ id: loopExitId }],
      bodyResult.nodesConnectedToExit
    );
  }

  private processForRangeLoop(
    forNode: Parser.SyntaxNode,
    exitId: string,
    finallyContext?: { finallyEntryId: string }
  ): ProcessResult {
    const declarator = forNode.childForFieldName("declarator");
    const range = forNode.childForFieldName("right");
    const headerText = `for (${declarator?.text || "auto"} : ${
      range?.text || "range"
    })`;
    const headerId = this.generateNodeId("for_range_header");
    const loopExitId = this.generateNodeId("for_range_exit");

    const nodes: FlowchartNode[] = [
      this.createSemanticNode(
        headerId,
        headerText,
        NodeType.LOOP_START,
        forNode
      ),
      this.createSemanticNode(
        loopExitId,
        "end loop",
        NodeType.LOOP_END,
        forNode
      ),
    ];
    this.locationMap.push({
      start: forNode.startIndex,
      end: forNode.endIndex,
      nodeId: headerId,
    });

    const loopContext: LoopContext = {
      breakTargetId: loopExitId,
      continueTargetId: headerId,
    };

    // Handle body - could be single statement or compound statement
    const bodyNode = forNode.childForFieldName("body");
    if (!bodyNode) {
      return this.createProcessResult();
    }

    const bodyResult =
      bodyNode.type === "compound_statement"
        ? this.processBlock(bodyNode, exitId, loopContext, finallyContext)
        : this.processStatement(bodyNode, exitId, loopContext, finallyContext);

    nodes.push(...bodyResult.nodes);
    const edges: FlowchartEdge[] = [...bodyResult.edges];

    if (bodyResult.entryNodeId) {
      edges.push({
        from: headerId,
        to: bodyResult.entryNodeId,
        label: "next item",
      });
    } else {
      edges.push({ from: headerId, to: headerId, label: "next item" });
    }

    // Connect all body exit points back to header for loop continuation
    bodyResult.exitPoints.forEach((ep) => {
      if (!bodyResult.nodesConnectedToExit.has(ep.id)) {
        edges.push({ from: ep.id, to: headerId, label: ep.label });
      }
    });
    edges.push({ from: headerId, to: loopExitId, label: "no more items" });

    return this.createProcessResult(
      nodes,
      edges,
      headerId,
      [{ id: loopExitId }],
      bodyResult.nodesConnectedToExit
    );
  }

  private processWhileStatement(
    whileNode: Parser.SyntaxNode,
    exitId: string,
    finallyContext?: { finallyEntryId: string }
  ): ProcessResult {
    const conditionNode = whileNode.childForFieldName("condition");
    const bodyNode = whileNode.childForFieldName("body");

    if (!conditionNode || !bodyNode) {
      return this.createProcessResult();
    }

    const conditionText = this.escapeString(conditionNode.text);
    const conditionId = this.generateNodeId("while_cond");
    const loopExitId = this.generateNodeId("while_exit");

    const nodes: FlowchartNode[] = [
      this.createSemanticNode(
        conditionId,
        conditionText,
        NodeType.DECISION,
        conditionNode
      ),
      this.createSemanticNode(
        loopExitId,
        "end loop",
        NodeType.LOOP_END,
        whileNode
      ),
    ];
    this.locationMap.push({
      start: whileNode.startIndex,
      end: whileNode.endIndex,
      nodeId: conditionId,
    });

    const loopContext: LoopContext = {
      breakTargetId: loopExitId,
      continueTargetId: conditionId,
    };

    // Handle body - could be single statement or compound statement
    const bodyResult =
      bodyNode.type === "compound_statement"
        ? this.processBlock(bodyNode, exitId, loopContext, finallyContext)
        : this.processStatement(bodyNode, exitId, loopContext, finallyContext);

    nodes.push(...bodyResult.nodes);
    const edges: FlowchartEdge[] = [...bodyResult.edges];

    if (bodyResult.entryNodeId) {
      edges.push({
        from: conditionId,
        to: bodyResult.entryNodeId,
        label: "true",
      });
    } else {
      // If body has no entry (e.g., empty or just comments), loop back to condition
      edges.push({ from: conditionId, to: conditionId, label: "true" });
    }

    // Connect all body exit points back to condition for loop continuation
    bodyResult.exitPoints.forEach((ep) => {
      if (!bodyResult.nodesConnectedToExit.has(ep.id)) {
        edges.push({ from: ep.id, to: conditionId, label: ep.label });
      }
    });

    // Condition false exits the loop
    edges.push({ from: conditionId, to: loopExitId, label: "false" });

    return this.createProcessResult(
      nodes,
      edges,
      conditionId,
      [{ id: loopExitId }],
      bodyResult.nodesConnectedToExit
    );
  }

  private processDoWhileStatement(
    doWhileNode: Parser.SyntaxNode,
    exitId: string,
    finallyContext?: { finallyEntryId: string }
  ): ProcessResult {
    const conditionNode = doWhileNode.childForFieldName("condition");
    const conditionText = this.escapeString(conditionNode?.text || "condition");
    const conditionId = this.generateNodeId("do_while_cond");
    const loopExitId = this.generateNodeId("do_while_exit");

    const nodes: FlowchartNode[] = [
      this.createSemanticNode(
        conditionId,
        conditionText,
        NodeType.DECISION,
        conditionNode || doWhileNode
      ),
      this.createSemanticNode(
        loopExitId,
        "end loop",
        NodeType.LOOP_END,
        doWhileNode
      ),
    ];
    this.locationMap.push({
      start: doWhileNode.startIndex,
      end: doWhileNode.endIndex,
      nodeId: conditionId,
    });

    const loopContext: LoopContext = {
      breakTargetId: loopExitId,
      continueTargetId: conditionId,
    };

    // Handle body - could be single statement or compound statement
    const bodyNode = doWhileNode.childForFieldName("body");
    if (!bodyNode) {
      return this.createProcessResult();
    }

    const bodyResult =
      bodyNode.type === "compound_statement"
        ? this.processBlock(bodyNode, exitId, loopContext, finallyContext)
        : this.processStatement(bodyNode, exitId, loopContext, finallyContext);

    nodes.push(...bodyResult.nodes);
    const edges: FlowchartEdge[] = [...bodyResult.edges];

    // In do-while, body executes first, then condition
    bodyResult.exitPoints.forEach((ep) => {
      if (!bodyResult.nodesConnectedToExit.has(ep.id)) {
        edges.push({ from: ep.id, to: conditionId, label: ep.label });
      }
    });
    edges.push({
      from: conditionId,
      to: bodyResult.entryNodeId || conditionId,
      label: "true",
    });
    edges.push({ from: conditionId, to: loopExitId, label: "false" });

    return this.createProcessResult(
      nodes,
      edges,
      bodyResult.entryNodeId,
      [{ id: loopExitId }],
      bodyResult.nodesConnectedToExit
    );
  }

  private processSwitchStatement(
    switchNode: Parser.SyntaxNode,
    exitId: string,
    loopContext?: LoopContext,
    finallyContext?: { finallyEntryId: string }
  ): ProcessResult {
    const conditionNode = switchNode.childForFieldName("condition");
    if (!conditionNode) return this.processDefaultStatement(switchNode);

    const switchId = this.generateNodeId("switch");
    const nodes: FlowchartNode[] = [
      this.createSemanticNode(
        switchId,
        `switch (${this.escapeString(conditionNode.text)})`,
        NodeType.DECISION,
        switchNode
      ),
    ];
    this.locationMap.push({
      start: conditionNode.startIndex,
      end: conditionNode.endIndex,
      nodeId: switchId,
    });

    const edges: FlowchartEdge[] = [];
    const nodesConnectedToExit = new Set<string>();
    const allExitPoints: { id: string; label?: string }[] = [];

    const body = switchNode.childForFieldName("body");
    const cases =
      body?.namedChildren.filter(
        (child) =>
          child.type === "case_statement" || child.type === "default_statement"
      ) || [];

    let lastCaseExitPoints: { id: string; label?: string }[] = [
      { id: switchId },
    ];

    for (const caseNode of cases) {
      const isDefault = caseNode.type === "default_statement";
      const valueNode = caseNode.childForFieldName("value");
      const caseLabel = isDefault
        ? "default"
        : `case ${this.escapeString(valueNode?.text || "")}`;

      const caseId = this.generateNodeId("case");
      nodes.push(
        this.createSemanticNode(caseId, caseLabel, NodeType.DECISION, caseNode)
      );
      this.locationMap.push({
        start: caseNode.startIndex,
        end: caseNode.endIndex,
        nodeId: caseId,
      });

      // Connect from previous case or switch
      lastCaseExitPoints.forEach((ep) => {
        edges.push({ from: ep.id, to: caseId, label: ep.label || "no match" });
      });

      // Process case body
      const caseBody = caseNode.namedChildren.filter(
        (child) =>
          child.type !== "case_statement" && child.type !== "default_statement"
      );

      if (caseBody.length > 0) {
        let caseExitPoints: { id: string; label?: string }[] = [
          { id: caseId, label: "match" },
        ];

        for (const stmt of caseBody) {
          const stmtResult = this.processStatement(
            stmt,
            exitId,
            loopContext,
            finallyContext
          );
          nodes.push(...stmtResult.nodes);
          edges.push(...stmtResult.edges);
          stmtResult.nodesConnectedToExit.forEach((n) =>
            nodesConnectedToExit.add(n)
          );

          if (stmtResult.entryNodeId) {
            caseExitPoints.forEach((ep) => {
              edges.push({
                from: ep.id,
                to: stmtResult.entryNodeId!,
                label: ep.label,
              });
            });
            caseExitPoints = stmtResult.exitPoints;
          }
        }

        allExitPoints.push(...caseExitPoints);
        lastCaseExitPoints = [{ id: caseId, label: "no match" }];
      } else {
        lastCaseExitPoints = [{ id: caseId, label: "no match" }];
        allExitPoints.push({ id: caseId, label: "match" });
      }
    }

    // Handle cases with no match
    allExitPoints.push(...lastCaseExitPoints);

    return this.createProcessResult(
      nodes,
      edges,
      switchId,
      allExitPoints,
      nodesConnectedToExit
    );
  }

  private processTryStatement(
    tryNode: Parser.SyntaxNode,
    exitId: string,
    loopContext?: LoopContext,
    finallyContext?: { finallyEntryId: string }
  ): ProcessResult {
    const entryId = this.generateNodeId("try_entry");
    const nodes: FlowchartNode[] = [
      this.createSemanticNode(entryId, "try", NodeType.EXCEPTION, tryNode),
    ];
    this.locationMap.push({
      start: tryNode.startIndex,
      end: tryNode.endIndex,
      nodeId: entryId,
    });

    const edges: FlowchartEdge[] = [];
    const nodesConnectedToExit = new Set<string>();
    let allExitPoints: { id: string; label?: string }[] = [];

    // Process try body
    const tryBody = tryNode.childForFieldName("body");
    const tryResult = this.processBlock(
      tryBody!,
      exitId,
      loopContext,
      finallyContext
    );
    nodes.push(...tryResult.nodes);
    edges.push(...tryResult.edges);
    tryResult.nodesConnectedToExit.forEach((n) => nodesConnectedToExit.add(n));

    if (tryResult.entryNodeId) {
      edges.push({ from: entryId, to: tryResult.entryNodeId });
    } else {
      allExitPoints.push({ id: entryId });
    }

    allExitPoints.push(...tryResult.exitPoints);

    // Process catch clauses
    const catchClauses = tryNode.namedChildren.filter(
      (child) => child.type === "catch_clause"
    );
    for (const catchClause of catchClauses) {
      const parameter = catchClause.childForFieldName("parameter");
      const catchType = parameter
        ? this.escapeString(parameter.text)
        : "Exception";

      const catchBody = catchClause.childForFieldName("body");
      if (catchBody) {
        const catchResult = this.processBlock(
          catchBody,
          exitId,
          loopContext,
          finallyContext
        );
        nodes.push(...catchResult.nodes);
        edges.push(...catchResult.edges);
        catchResult.nodesConnectedToExit.forEach((n) =>
          nodesConnectedToExit.add(n)
        );

        if (catchResult.entryNodeId) {
          edges.push({
            from: entryId,
            to: catchResult.entryNodeId,
            label: `catch ${catchType}`,
          });
          allExitPoints.push(...catchResult.exitPoints);
        }
      }
    }

    return this.createProcessResult(
      nodes,
      edges,
      entryId,
      allExitPoints,
      nodesConnectedToExit
    );
  }

  private processReturnStatement(
    returnNode: Parser.SyntaxNode,
    exitId: string,
    finallyContext?: { finallyEntryId: string }
  ): ProcessResult {
    const valueNode = returnNode.namedChild(0);
    const nodeId = this.generateNodeId("return");
    const labelText = valueNode
      ? `return ${this.escapeString(valueNode.text)}`
      : "return";
    const node: FlowchartNode = this.createSemanticNode(
      nodeId,
      labelText,
      NodeType.RETURN,
      returnNode
    );
    const edges: FlowchartEdge[] = [
      {
        from: nodeId,
        to: finallyContext ? finallyContext.finallyEntryId : exitId,
      },
    ];
    this.locationMap.push({
      start: returnNode.startIndex,
      end: returnNode.endIndex,
      nodeId,
    });
    return this.createProcessResult(
      [node],
      edges,
      nodeId,
      [],
      new Set([nodeId])
    );
  }

  private processThrowStatement(
    throwNode: Parser.SyntaxNode,
    exitId: string,
    finallyContext?: { finallyEntryId: string }
  ): ProcessResult {
    const valueNode = throwNode.namedChild(0);
    const nodeId = this.generateNodeId("throw");
    const labelText = valueNode
      ? `throw ${this.escapeString(valueNode.text)}`
      : "throw";
    const node: FlowchartNode = this.createSemanticNode(
      nodeId,
      labelText,
      NodeType.EXCEPTION,
      throwNode
    );
    const edges: FlowchartEdge[] = [
      {
        from: nodeId,
        to: finallyContext ? finallyContext.finallyEntryId : exitId,
      },
    ];
    this.locationMap.push({
      start: throwNode.startIndex,
      end: throwNode.endIndex,
      nodeId,
    });
    return this.createProcessResult(
      [node],
      edges,
      nodeId,
      [],
      new Set([nodeId])
    );
  }

  private processGotoStatement(
    gotoNode: Parser.SyntaxNode,
    exitId: string
  ): ProcessResult {
    const labelNode = gotoNode.namedChild(0);
    const nodeId = this.generateNodeId("goto");
    const labelText = labelNode
      ? `goto ${this.escapeString(labelNode.text)}`
      : "goto";
    const node: FlowchartNode = this.createSemanticNode(
      nodeId,
      labelText,
      NodeType.BREAK_CONTINUE,
      gotoNode
    );
    this.locationMap.push({
      start: gotoNode.startIndex,
      end: gotoNode.endIndex,
      nodeId,
    });
    // Note: Proper goto handling would require label tracking, simplified here
    return this.createProcessResult([node], [], nodeId, [{ id: nodeId }]);
  }

  private processLabeledStatement(
    labeledNode: Parser.SyntaxNode,
    exitId: string,
    loopContext?: LoopContext,
    finallyContext?: { finallyEntryId: string }
  ): ProcessResult {
    const labelNode = labeledNode.childForFieldName("label");
    const statementNode = labeledNode.childForFieldName("statement");

    if (!labelNode || !statementNode) {
      return this.processDefaultStatement(labeledNode);
    }

    const labelId = this.generateNodeId("label");
    const labelText = `${this.escapeString(labelNode.text)}:`;
    const labelFlowNode: FlowchartNode = {
      id: labelId,
      label: labelText,
      shape: "rect",
      style: this.nodeStyles.special,
    };
    this.locationMap.push({
      start: labelNode.startIndex,
      end: labelNode.endIndex,
      nodeId: labelId,
    });

    const statementResult = this.processStatement(
      statementNode,
      exitId,
      loopContext,
      finallyContext
    );
    const nodes = [labelFlowNode, ...statementResult.nodes];
    const edges = [...statementResult.edges];

    if (statementResult.entryNodeId) {
      edges.push({ from: labelId, to: statementResult.entryNodeId });
    }

    return this.createProcessResult(
      nodes,
      edges,
      labelId,
      statementResult.exitPoints,
      statementResult.nodesConnectedToExit
    );
  }

  private processBreakStatement(
    breakNode: Parser.SyntaxNode,
    loopContext: LoopContext
  ): ProcessResult {
    const nodeId = this.generateNodeId("break");
    const node: FlowchartNode = this.createSemanticNode(
      nodeId,
      "break",
      NodeType.BREAK_CONTINUE,
      breakNode
    );
    const edges: FlowchartEdge[] = [
      { from: nodeId, to: loopContext.breakTargetId },
    ];
    this.locationMap.push({
      start: breakNode.startIndex,
      end: breakNode.endIndex,
      nodeId,
    });
    return this.createProcessResult(
      [node],
      edges,
      nodeId,
      [],
      new Set([nodeId])
    );
  }

  private processContinueStatement(
    continueNode: Parser.SyntaxNode,
    loopContext: LoopContext
  ): ProcessResult {
    const nodeId = this.generateNodeId("continue");
    const node: FlowchartNode = this.createSemanticNode(
      nodeId,
      "continue",
      NodeType.BREAK_CONTINUE,
      continueNode
    );
    const edges: FlowchartEdge[] = [
      { from: nodeId, to: loopContext.continueTargetId },
    ];
    this.locationMap.push({
      start: continueNode.startIndex,
      end: continueNode.endIndex,
      nodeId,
    });
    return this.createProcessResult(
      [node],
      edges,
      nodeId,
      [],
      new Set([nodeId])
    );
  }

  private processVariableDeclaration(
    declNode: Parser.SyntaxNode,
    exitId: string,
    loopContext?: LoopContext,
    finallyContext?: { finallyEntryId: string }
  ): ProcessResult {
    const declarators = declNode.namedChildren.filter(
      (child) => child.type === "init_declarator" || child.type === "identifier"
    );

    if (declarators.length === 0) {
      return this.processDefaultStatement(declNode);
    }

    // For single declarator, process it directly
    if (declarators.length === 1) {
      const declarator = declarators[0];
      let name: string = "";
      let value: string = "";

      if (declarator.type === "init_declarator") {
        const nameNode = declarator.childForFieldName("declarator");
        const valueNode = declarator.childForFieldName("value");
        name = this.extractVariableName(nameNode) || "variable";
        value = valueNode ? ` = ${this.escapeString(valueNode.text)}` : "";
      } else {
        name = declarator.text;
      }

      const nodeId = this.generateNodeId("var_decl");
      const typeSpecifier = declNode.childForFieldName("type");
      const type = typeSpecifier?.text || "auto";
      const labelText = `${type} ${name}${value}`;
      const node: FlowchartNode = {
        id: nodeId,
        label: labelText,
        shape: "rect",
        style: this.nodeStyles.process,
      };
      this.locationMap.push({
        start: declNode.startIndex,
        end: declNode.endIndex,
        nodeId,
      });
      return this.createProcessResult([node], [], nodeId, [{ id: nodeId }]);
    }

    // For multiple declarators, create separate nodes
    const nodes: FlowchartNode[] = [];
    const edges: FlowchartEdge[] = [];
    let entryNodeId: string | undefined;
    let lastNodeId: string | undefined;

    for (const declarator of declarators) {
      let name: string = "";
      let value: string = "";

      if (declarator.type === "init_declarator") {
        const nameNode = declarator.childForFieldName("declarator");
        const valueNode = declarator.childForFieldName("value");
        name = this.extractVariableName(nameNode) || "variable";
        value = valueNode ? ` = ${this.escapeString(valueNode.text)}` : "";
      } else {
        name = declarator.text;
      }

      const nodeId = this.generateNodeId("var_decl");
      const typeSpecifier = declNode.childForFieldName("type");
      const type = typeSpecifier?.text || "auto";
      const labelText = `${type} ${name}${value}`;
      const node: FlowchartNode = {
        id: nodeId,
        label: labelText,
        shape: "rect",
        style: this.nodeStyles.process,
      };
      nodes.push(node);
      this.locationMap.push({
        start: declarator.startIndex,
        end: declarator.endIndex,
        nodeId,
      });

      if (!entryNodeId) entryNodeId = nodeId;
      if (lastNodeId) {
        edges.push({ from: lastNodeId, to: nodeId });
      }
      lastNodeId = nodeId;
    }

    return this.createProcessResult(
      nodes,
      edges,
      entryNodeId,
      lastNodeId ? [{ id: lastNodeId }] : []
    );
  }

  private processReturnStatementForExpression(
    exprNode: Parser.SyntaxNode,
    exitId: string,
    finallyContext?: { finallyEntryId: string }
  ): ProcessResult {
    const nodeId = this.generateNodeId("return");
    const labelText = `return ${this.escapeString(exprNode.text)}`;
    const node: FlowchartNode = {
      id: nodeId,
      label: labelText,
      shape: "stadium",
      style: this.nodeStyles.special,
    };
    const edges: FlowchartEdge[] = [
      {
        from: nodeId,
        to: finallyContext ? finallyContext.finallyEntryId : exitId,
      },
    ];
    this.locationMap.push({
      start: exprNode.startIndex,
      end: exprNode.endIndex,
      nodeId,
    });
    return this.createProcessResult(
      [node],
      edges,
      nodeId,
      [],
      new Set([nodeId])
    );
  }
}
