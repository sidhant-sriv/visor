import Parser from "web-tree-sitter";
import { AbstractParser } from "../../common/AbstractParser";
import { FlowchartIR, FlowchartNode, FlowchartEdge } from "../../../ir/ir";
import { ProcessResult, LoopContext } from "../../common/AstParserTypes";

export class JavaAstParser extends AbstractParser {
  private currentMethodIsLambda = false;

  /**
   * Get the language identifier for this parser
   */
  protected getLanguageIdentifier(): string {
    return "java";
  }

  /**
   * Asynchronously creates and initializes an instance of JavaAstParser.
   * This is the required entry point for creating a parser instance.
   * @param wasmPath The file path to the tree-sitter-java.wasm file.
   * @returns A promise that resolves to a new JavaAstParser instance.
   */
  public static async create(wasmPath: string): Promise<JavaAstParser> {
    await Parser.init();
    const language = await Parser.Language.load(wasmPath);
    const parser = new Parser();
    parser.setLanguage(language);
    return new JavaAstParser(parser);
  }

  public listFunctions(sourceCode: string): string[] {
    return this.measurePerformance("listFunctions", () => {
      const tree = this.parser.parse(sourceCode);

      // Get method declarations
      const methodNames = tree.rootNode
        .descendantsOfType("method_declaration")
        .map(
          (m: Parser.SyntaxNode) =>
            m.childForFieldName("name")?.text || "[anonymous method]"
        );

      // Get constructor declarations
      const constructorNames = tree.rootNode
        .descendantsOfType("constructor_declaration")
        .map(
          (c: Parser.SyntaxNode) =>
            c.childForFieldName("name")?.text || "[constructor]"
        );

      // Get lambda expressions assigned to variables
      const lambdaNames = tree.rootNode
        .descendantsOfType("variable_declarator")
        .filter((v) => {
          const value = v.childForFieldName("value");
          return value?.type === "lambda_expression";
        })
        .map((v) => v.childForFieldName("name")?.text || "[anonymous lambda]");

      return [...methodNames, ...constructorNames, ...lambdaNames];
    });
  }

  public findFunctionAtPosition(
    sourceCode: string,
    position: number
  ): string | undefined {
    const tree = this.parser.parse(sourceCode);

    // Check method declarations
    let method = tree.rootNode
      .descendantsOfType("method_declaration")
      .find((m) => position >= m.startIndex && position <= m.endIndex);
    if (method)
      return method.childForFieldName("name")?.text || "[anonymous method]";

    // Check constructor declarations
    method = tree.rootNode
      .descendantsOfType("constructor_declaration")
      .find((c) => position >= c.startIndex && position <= c.endIndex);
    if (method)
      return method.childForFieldName("name")?.text || "[constructor]";

    // Check lambda expressions
    const lambda = tree.rootNode
      .descendantsOfType("variable_declarator")
      .find((v) => {
        const value = v.childForFieldName("value");
        return (
          position >= v.startIndex &&
          position <= v.endIndex &&
          value?.type === "lambda_expression"
        );
      });
    return lambda?.childForFieldName("name")?.text || "[anonymous lambda]";
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
    let isConstructor = false;

    if (position !== undefined) {
      // Try to find method declaration at position
      targetNode = tree.rootNode
        .descendantsOfType("method_declaration")
        .find((m) => position >= m.startIndex && position <= m.endIndex);

      if (!targetNode) {
        // Try to find constructor declaration at position
        targetNode = tree.rootNode
          .descendantsOfType("constructor_declaration")
          .find((c) => position >= c.startIndex && position <= c.endIndex);
        isConstructor = !!targetNode;
      }

      if (!targetNode) {
        // Try to find lambda expression at position
        targetNode = tree.rootNode
          .descendantsOfType("variable_declarator")
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
        .descendantsOfType("method_declaration")
        .find((m) => m.childForFieldName("name")?.text === functionName);

      if (!targetNode) {
        targetNode = tree.rootNode
          .descendantsOfType("constructor_declaration")
          .find((c) => c.childForFieldName("name")?.text === functionName);
        isConstructor = !!targetNode;
      }

      if (!targetNode) {
        targetNode = tree.rootNode
          .descendantsOfType("variable_declarator")
          .find(
            (v) =>
              v.childForFieldName("name")?.text === functionName &&
              v.childForFieldName("value")?.type === "lambda_expression"
          );
        isLambda = !!targetNode;
      }
    } else {
      // Get first method/constructor/lambda
      targetNode =
        tree.rootNode.descendantsOfType("method_declaration")[0] ||
        tree.rootNode.descendantsOfType("constructor_declaration")[0] ||
        tree.rootNode
          .descendantsOfType("variable_declarator")
          .find(
            (v) => v.childForFieldName("value")?.type === "lambda_expression"
          );

      if (targetNode?.type === "constructor_declaration") {
        isConstructor = true;
      } else if (targetNode?.type === "variable_declarator") {
        isLambda = true;
      }
    }

    if (!targetNode) {
      return {
        nodes: [
          {
            id: "A",
            label: "Place cursor inside a method to generate a flowchart.",
            shape: "rect",
          },
        ],
        edges: [],
        locationMap: [],
      };
    }

    this.currentMethodIsLambda = isLambda;

    // Get method body and name
    let bodyToProcess: Parser.SyntaxNode | null = null;
    let funcNameStr = "";

    if (isLambda) {
      const lambdaExpr = targetNode.childForFieldName("value");
      bodyToProcess = lambdaExpr?.childForFieldName("body") || null;
      funcNameStr = this.escapeString(
        targetNode.childForFieldName("name")?.text || "[anonymous lambda]"
      );
    } else if (isConstructor) {
      bodyToProcess = targetNode.childForFieldName("body");
      funcNameStr = this.escapeString(
        targetNode.childForFieldName("name")?.text || "[constructor]"
      );
    } else {
      bodyToProcess = targetNode.childForFieldName("body");
      funcNameStr = this.escapeString(
        targetNode.childForFieldName("name")?.text || "[anonymous method]"
      );
    }

    const title = `Flowchart for ${
      isLambda ? "lambda" : isConstructor ? "constructor" : "method"
    }: ${funcNameStr}`;

    if (!bodyToProcess) {
      return {
        nodes: [{ id: "A", label: "Method has no body.", shape: "rect" }],
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
      label: "Start",
      shape: "round",
      style: this.nodeStyles.terminator,
    });
    nodes.push({
      id: exitId,
      label: "End",
      shape: "round",
      style: this.nodeStyles.terminator,
    });

    // For lambda expressions with expression bodies, handle them differently
    const bodyResult =
      isLambda && bodyToProcess.type !== "block"
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

    return {
      nodes,
      edges: validEdges,
      locationMap: this.locationMap,
      functionRange: { start: targetNode.startIndex, end: targetNode.endIndex },
      title,
      entryNodeId: entryId,
      exitNodeId: exitId,
    };
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

    // Handle ternary operator
    if (statement.type === "ternary_expression") {
      return this.processTernaryExpression(
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
      case "enhanced_for_statement":
        return this.processEnhancedForStatement(
          statement,
          exitId,
          finallyContext
        );
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
      case "switch_expression":
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
      case "assert_statement":
        return this.processAssertStatement(
          statement,
          exitId,
          loopContext,
          finallyContext
        );
      case "empty_statement":
        return this.createProcessResult();
      default: {
        // Handle variable declarations and assignments
        let expressionNode: Parser.SyntaxNode | undefined;
        let assignmentTargetNode: Parser.SyntaxNode | undefined;

        if (statement.type === "local_variable_declaration") {
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
          expressionNode?.type === "ternary_expression" &&
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
            {
              id: conditionId,
              label: this.escapeString(conditionNode.text),
              shape: "diamond",
              style: this.nodeStyles.decision,
            },
          ];
          const edges: FlowchartEdge[] = [];

          this.locationMap.push({
            start: conditionNode.startIndex,
            end: conditionNode.endIndex,
            nodeId: conditionId,
          });

          const consequenceId = this.generateNodeId("ternary_true");
          nodes.push({
            id: consequenceId,
            label: `${targetText} = ${this.escapeString(consequenceNode.text)}`,
            shape: "rect",
            style: this.nodeStyles.process,
          });
          this.locationMap.push({
            start: statement.startIndex,
            end: statement.endIndex,
            nodeId: consequenceId,
          });
          edges.push({ from: conditionId, to: consequenceId, label: "true" });

          const alternativeId = this.generateNodeId("ternary_false");
          nodes.push({
            id: alternativeId,
            label: `${targetText} = ${this.escapeString(alternativeNode.text)}`,
            shape: "rect",
            style: this.nodeStyles.process,
          });
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
        return this.currentMethodIsLambda
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

  private processTernaryExpression(
    ternaryNode: Parser.SyntaxNode,
    exitId: string,
    loopContext?: LoopContext,
    finallyContext?: { finallyEntryId: string }
  ): ProcessResult {
    const conditionNode = ternaryNode.childForFieldName("condition");
    const consequenceNode = ternaryNode.childForFieldName("consequence");
    const alternativeNode = ternaryNode.childForFieldName("alternative");

    if (!conditionNode || !consequenceNode || !alternativeNode) {
      return this.processDefaultStatement(ternaryNode);
    }

    const conditionId = this.generateNodeId("ternary_cond");
    const nodes: FlowchartNode[] = [
      {
        id: conditionId,
        label: this.escapeString(conditionNode.text),
        shape: "diamond",
        style: this.nodeStyles.decision,
      },
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
      this.currentMethodIsLambda
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
      {
        id: ifConditionId,
        label: this.escapeString(ifConditionNode.text),
        shape: "diamond",
        style: this.nodeStyles.decision,
      },
    ];
    this.locationMap.push({
      start: ifConditionNode.startIndex,
      end: ifConditionNode.endIndex,
      nodeId: ifConditionId,
    });

    const ifConsequenceResult = this.processBlock(
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
      const elseResult = this.processBlock(
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
    const init = forNode.childForFieldName("init");
    const condition = forNode.childForFieldName("condition");
    const update = forNode.childForFieldName("update");

    const headerText = `for (${init?.text || ""}; ${condition?.text || ""}; ${
      update?.text || ""
    })`;
    const headerId = this.generateNodeId("for_header");
    const loopExitId = this.generateNodeId("for_exit");

    const nodes: FlowchartNode[] = [
      {
        id: headerId,
        label: this.escapeString(headerText),
        shape: "diamond",
        style: this.nodeStyles.decision,
      },
      { id: loopExitId, label: "end loop", shape: "stadium" },
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
    const bodyResult = this.processBlock(
      forNode.childForFieldName("body")!,
      exitId,
      loopContext,
      finallyContext
    );
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

    bodyResult.exitPoints.forEach((ep) =>
      edges.push({ from: ep.id, to: headerId })
    );
    edges.push({ from: headerId, to: loopExitId, label: "exit" });

    return this.createProcessResult(
      nodes,
      edges,
      headerId,
      [{ id: loopExitId }],
      bodyResult.nodesConnectedToExit
    );
  }

  private processEnhancedForStatement(
    forNode: Parser.SyntaxNode,
    exitId: string,
    finallyContext?: { finallyEntryId: string }
  ): ProcessResult {
    const variable = forNode.childForFieldName("name");
    const iterable = forNode.childForFieldName("value");
    const headerText = `for (${variable?.text || ""} : ${
      iterable?.text || ""
    })`;
    const headerId = this.generateNodeId("enhanced_for_header");
    const loopExitId = this.generateNodeId("enhanced_for_exit");

    const nodes: FlowchartNode[] = [
      {
        id: headerId,
        label: this.escapeString(headerText),
        shape: "diamond",
        style: this.nodeStyles.decision,
      },
      { id: loopExitId, label: "end loop", shape: "stadium" },
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
    const bodyResult = this.processBlock(
      forNode.childForFieldName("body")!,
      exitId,
      loopContext,
      finallyContext
    );
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

    bodyResult.exitPoints.forEach((ep) =>
      edges.push({ from: ep.id, to: headerId })
    );
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
    const conditionText = this.escapeString(
      whileNode.childForFieldName("condition")!.text
    );
    const conditionId = this.generateNodeId("while_cond");
    const loopExitId = this.generateNodeId("while_exit");

    const nodes: FlowchartNode[] = [
      {
        id: conditionId,
        label: conditionText,
        shape: "diamond",
        style: this.nodeStyles.decision,
      },
      { id: loopExitId, label: "end loop", shape: "stadium" },
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
    const bodyResult = this.processBlock(
      whileNode.childForFieldName("body")!,
      exitId,
      loopContext,
      finallyContext
    );
    nodes.push(...bodyResult.nodes);
    const edges: FlowchartEdge[] = [...bodyResult.edges];

    if (bodyResult.entryNodeId) {
      edges.push({
        from: conditionId,
        to: bodyResult.entryNodeId,
        label: "true",
      });
    } else {
      edges.push({ from: conditionId, to: conditionId, label: "true" });
    }

    bodyResult.exitPoints.forEach((ep) =>
      edges.push({ from: ep.id, to: conditionId })
    );
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
      {
        id: conditionId,
        label: conditionText,
        shape: "diamond",
        style: this.nodeStyles.decision,
      },
      { id: loopExitId, label: "end loop", shape: "stadium" },
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
    const bodyResult = this.processBlock(
      doWhileNode.childForFieldName("body")!,
      exitId,
      loopContext,
      finallyContext
    );
    nodes.push(...bodyResult.nodes);
    const edges: FlowchartEdge[] = [...bodyResult.edges];

    // In do-while, body executes first, then condition
    bodyResult.exitPoints.forEach((ep) =>
      edges.push({ from: ep.id, to: conditionId })
    );
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
    const discriminantNode = switchNode.childForFieldName("condition");
    if (!discriminantNode) return this.processDefaultStatement(switchNode);

    const switchId = this.generateNodeId("switch");
    const nodes: FlowchartNode[] = [
      {
        id: switchId,
        label: `switch (${this.escapeString(discriminantNode.text)})`,
        shape: "rect",
        style: this.nodeStyles.process,
      },
    ];
    this.locationMap.push({
      start: discriminantNode.startIndex,
      end: discriminantNode.endIndex,
      nodeId: switchId,
    });

    const edges: FlowchartEdge[] = [];
    const nodesConnectedToExit = new Set<string>();
    const allExitPoints: { id: string; label?: string }[] = [];

    const body = switchNode.childForFieldName("body");
    const cases =
      body?.namedChildren.filter(
        (child) => child.type === "switch_block_statement_group"
      ) || [];

    let lastCaseExitPoints: { id: string; label?: string }[] = [
      { id: switchId },
    ];

    for (const caseGroup of cases) {
      const labels = caseGroup.namedChildren.filter(
        (child) => child.type === "switch_label"
      );

      // Process each label in the group
      for (let i = 0; i < labels.length; i++) {
        const label = labels[i];
        const isDefault = label.namedChildren.some(
          (child) => child.type === "default"
        );
        const valueNode = label.namedChildren.find(
          (child) => child.type !== "default"
        );
        const caseLabel = isDefault
          ? "default"
          : `case ${this.escapeString(valueNode?.text || "")}`;

        const caseId = this.generateNodeId("case");
        nodes.push({
          id: caseId,
          label: caseLabel,
          shape: "diamond",
          style: this.nodeStyles.decision,
        });
        this.locationMap.push({
          start: label.startIndex,
          end: label.endIndex,
          nodeId: caseId,
        });

        // Connect from previous case or switch
        lastCaseExitPoints.forEach((ep) => {
          edges.push({
            from: ep.id,
            to: caseId,
            label: ep.label || "no match",
          });
        });

        if (i === labels.length - 1) {
          // Process statements for the last label in the group
          const statements = caseGroup.namedChildren.filter(
            (child) => child.type !== "switch_label"
          );

          if (statements.length > 0) {
            let caseExitPoints: { id: string; label?: string }[] = [
              { id: caseId, label: "match" },
            ];

            for (const stmt of statements) {
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
        } else {
          // Fall through to next label
          allExitPoints.push({ id: caseId, label: "match" });
          lastCaseExitPoints = [{ id: caseId, label: "no match" }];
        }
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
      { id: entryId, label: "try", shape: "stadium" },
    ];
    this.locationMap.push({
      start: tryNode.startIndex,
      end: tryNode.endIndex,
      nodeId: entryId,
    });

    const edges: FlowchartEdge[] = [];
    const nodesConnectedToExit = new Set<string>();
    let allExitPoints: { id: string; label?: string }[] = [];

    // Process finally clause first to create context
    let newFinallyContext: { finallyEntryId: string } | undefined;
    let finallyResult: ProcessResult | null = null;
    const finallyClause = tryNode.namedChildren.find(
      (child) => child.type === "finally_clause"
    );

    if (finallyClause) {
      const finallyBody = finallyClause.childForFieldName("body");
      if (finallyBody) {
        finallyResult = this.processBlock(
          finallyBody,
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
    }

    // Process try body
    const tryBody = tryNode.childForFieldName("body");
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
    } else if (finallyResult?.entryNodeId) {
      edges.push({ from: entryId, to: finallyResult.entryNodeId });
    } else {
      allExitPoints.push({ id: entryId });
    }

    tryResult.exitPoints.forEach((ep) => {
      if (finallyResult?.entryNodeId) {
        edges.push({
          from: ep.id,
          to: finallyResult.entryNodeId,
          label: ep.label,
        });
      } else {
        allExitPoints.push(ep);
      }
    });

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
          newFinallyContext || finallyContext
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
          catchResult.exitPoints.forEach((ep) => {
            if (finallyResult?.entryNodeId) {
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
    }

    if (finallyResult) allExitPoints.push(...finallyResult.exitPoints);

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

  private processAssertStatement(
    assertNode: Parser.SyntaxNode,
    exitId: string,
    loopContext?: LoopContext,
    finallyContext?: { finallyEntryId: string }
  ): ProcessResult {
    const conditionNode = assertNode.namedChild(0);
    const messageNode = assertNode.namedChildren[1];

    const nodeId = this.generateNodeId("assert");
    let labelText = "assert";
    if (conditionNode) {
      labelText = `assert ${this.escapeString(conditionNode.text)}`;
      if (messageNode) {
        labelText += ` : ${this.escapeString(messageNode.text)}`;
      }
    }

    const node: FlowchartNode = {
      id: nodeId,
      label: labelText,
      shape: "rect",
      style: this.nodeStyles.process,
    };
    this.locationMap.push({
      start: assertNode.startIndex,
      end: assertNode.endIndex,
      nodeId,
    });
    return this.createProcessResult([node], [], nodeId, [{ id: nodeId }]);
  }

  private processBreakStatement(
    breakNode: Parser.SyntaxNode,
    loopContext: LoopContext
  ): ProcessResult {
    const nodeId = this.generateNodeId("break");
    const node: FlowchartNode = {
      id: nodeId,
      label: "break",
      shape: "stadium",
      style: this.nodeStyles.break,
    };
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
    const node: FlowchartNode = {
      id: nodeId,
      label: "continue",
      shape: "stadium",
      style: this.nodeStyles.break,
    };
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
      (child) => child.type === "variable_declarator"
    );

    if (declarators.length === 0) {
      return this.processDefaultStatement(declNode);
    }

    // For single declarator, process it directly
    if (declarators.length === 1) {
      const declarator = declarators[0];
      const name = declarator.childForFieldName("name");
      const value = declarator.childForFieldName("value");

      if (value?.type === "ternary_expression") {
        return this.processStatement(
          declNode,
          exitId,
          loopContext,
          finallyContext
        );
      }

      const nodeId = this.generateNodeId("var_decl");
      const type = declNode.childForFieldName("type")?.text || "var";
      const labelText = `${type} ${name?.text || "variable"}${
        value ? ` = ${this.escapeString(value.text)}` : ""
      }`;
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
      const name = declarator.childForFieldName("name");
      const value = declarator.childForFieldName("value");

      const nodeId = this.generateNodeId("var_decl");
      const type = declNode.childForFieldName("type")?.text || "var";
      const labelText = `${type} ${name?.text || "variable"}${
        value ? ` = ${this.escapeString(value.text)}` : ""
      }`;
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
