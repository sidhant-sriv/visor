import {
  Node,
  IfStatement,
  ForStatement,
  WhileStatement,
  DoStatement,
  Statement,
  Block,
  FunctionDeclaration,
  MethodDeclaration,
  ArrowFunction,
  FunctionExpression,
  SourceFile,
  VariableDeclaration,
  TryStatement,
  ConditionalExpression,
  VariableStatement,
  ExpressionStatement,
  CallExpression,
  PropertyAccessExpression,
  ForOfStatement,
  ForInStatement,
  SwitchStatement,
  BreakStatement,
  ContinueStatement,
  AwaitExpression,
  Expression,
} from "ts-morph";

/**
 * Defines the structure for a location map entry, linking a node ID to a specific range in the source code.
 */
export interface LocationMapEntry {
  start: number;
  end: number;
  nodeId: string;
}

/**
 * Defines the structure for the result of processing any AST node (statement or block).
 * This allows for a robust recursive analysis of the code's control flow.
 */
export interface ProcessResult {
  graph: string;
  entryNodeId: string | null;
  exitPoints: { id: string; label?: string }[];
  nodesConnectedToExit: Set<string>;
}

interface LoopContext {
  breakTargetId: string;
  continueTargetId: string;
}

/**
 * The core class responsible for analyzing the AST and generating the flowchart.
 */
export class FlowchartGenerator {
  private nodeIdCounter = 0;
  private locationMap: LocationMapEntry[] = [];

  private generateNodeId(prefix: string): string {
    return `${prefix}_${this.nodeIdCounter++}`;
  }

  private escapeString(str: string): string {
    if (!str) return "";
    const sanitized = str.replace(/"/g, "#quot;").replace(/\n/g, " ").trim();
    return sanitized.length > 60
      ? sanitized.substring(0, 57) + "..."
      : sanitized;
  }

  /**
   * Main public method to generate a flowchart from a ts-morph SourceFile object.
   * It finds the first function/method in the file and analyzes its body.
   */
  public generateFlowchart(
    sourceFile: SourceFile,
    position: number
  ): {
    flowchart: string;
    locationMap: LocationMapEntry[];
    functionRange?: { start: number; end: number };
  } {
    this.nodeIdCounter = 0;
    this.locationMap = [];

    const descendant = sourceFile.getDescendantAtPos(position);
    if (!descendant) {
      return {
        flowchart: 'graph TD\n    A["No code found at cursor position."];',
        locationMap: [],
      };
    }

    const isFunctionLike = (
      node: Node
    ): node is
      | FunctionDeclaration
      | MethodDeclaration
      | ArrowFunction
      | FunctionExpression =>
      Node.isFunctionDeclaration(node) ||
      Node.isMethodDeclaration(node) ||
      Node.isArrowFunction(node) ||
      Node.isFunctionExpression(node);

    let functionToAnalyze = isFunctionLike(descendant)
      ? descendant
      : descendant.getAncestors().find(isFunctionLike);

    if (!functionToAnalyze) {
      return {
        flowchart:
          'graph TD\n    A["Place cursor inside a function or method to generate a flowchart."];',
        locationMap: [],
      };
    }

    let functionName: string | undefined;
    if (
      Node.isFunctionDeclaration(functionToAnalyze) ||
      Node.isMethodDeclaration(functionToAnalyze) ||
      Node.isFunctionExpression(functionToAnalyze)
    ) {
      functionName = functionToAnalyze.getName();
    } else if (Node.isArrowFunction(functionToAnalyze)) {
      const parent = functionToAnalyze.getParent();
      if (Node.isVariableDeclaration(parent)) {
        functionName = (parent as VariableDeclaration).getName();
      }
    }
    const finalFunctionName = functionName || "[anonymous]";

    let flowchart = "graph TD\n";
    const entryId = this.generateNodeId("start");
    const exitId = this.generateNodeId("end");

    flowchart += `    ${entryId}(("start: ${finalFunctionName}"))\n`;
    flowchart += `    ${exitId}(("end"))\n`;
    flowchart += `    style ${entryId} fill:#d4edda,stroke:#155724,stroke-width:2px,color:#155724\n`;
    flowchart += `    style ${exitId} fill:#f8d7da,stroke:#721c24,stroke-width:2px,color:#721c24\n`;

    const body = functionToAnalyze.getBody();

    if (body && Node.isBlock(body)) {
      const bodyResult = this.processBlock(body, exitId);
      flowchart += bodyResult.graph;

      if (bodyResult.entryNodeId) {
        flowchart += `    ${entryId} --> ${bodyResult.entryNodeId}\n`;
      } else {
        flowchart += `    ${entryId} --> ${exitId}\n`;
      }

      bodyResult.exitPoints.forEach((exitPoint) => {
        if (!bodyResult.nodesConnectedToExit.has(exitPoint.id)) {
          const label = exitPoint.label
            ? ` -- "${exitPoint.label}" --> `
            : ` --> `;
          flowchart += `    ${exitPoint.id}${label}${exitId}\n`;
        }
      });
    } else {
      flowchart += `    ${entryId} --> ${exitId}\n`;
    }

    return {
      flowchart,
      locationMap: this.locationMap,
      functionRange: {
        start: functionToAnalyze.getStart(),
        end: functionToAnalyze.getEnd(),
      },
    };
  }

  /**
   * Processes a block of statements (e.g., the body of a function or a loop),
   * chaining the control flow from one statement to the next.
   */
  private processBlock(
    blockNode: Block,
    exitId: string,
    loopContext?: LoopContext
  ): ProcessResult {
    let graph = "";
    let entryNodeId: string | null = null;
    const nodesConnectedToExit = new Set<string>();
    let lastExitPoints: { id: string; label?: string }[] = [];

    const statements = blockNode.getStatements();

    if (statements.length === 0) {
      return {
        graph: "",
        entryNodeId: null,
        exitPoints: [],
        nodesConnectedToExit,
      };
    }

    for (const statement of statements) {
      const result = this.processStatement(statement, exitId, loopContext);
      graph += result.graph;

      if (lastExitPoints.length > 0) {
        // Connect the exits of the previous statement to the entry of the current one.
        lastExitPoints.forEach((exitPoint) => {
          if (result.entryNodeId) {
            const label = exitPoint.label
              ? ` -- "${exitPoint.label}" --> `
              : ` --> `;
            graph += `    ${exitPoint.id}${label}${result.entryNodeId}\n`;
          }
        });
      } else {
        // This is the first statement in the block, so it's the entry point.
        entryNodeId = result.entryNodeId;
      }

      lastExitPoints = result.exitPoints;
      result.nodesConnectedToExit.forEach((n) => nodesConnectedToExit.add(n));
    }

    return {
      graph,
      entryNodeId,
      exitPoints: lastExitPoints,
      nodesConnectedToExit,
    };
  }

  /**
   * Delegates a statement to the appropriate processing function based on its AST node type.
   */
  private processStatement(
    statement: Statement,
    exitId: string,
    loopContext?: LoopContext
  ): ProcessResult {
    if (Node.isIfStatement(statement)) {
      return this.processIfStatement(statement, exitId, loopContext);
    }
    if (Node.isForOfStatement(statement)) {
      return this.processForOfStatement(statement, exitId);
    }
    if (Node.isForInStatement(statement)) {
      return this.processForInStatement(statement, exitId);
    }
    if (Node.isForStatement(statement)) {
      return this.processForStatement(statement, exitId);
    }
    if (Node.isWhileStatement(statement)) {
      return this.processWhileStatement(statement, exitId);
    }
    if (Node.isDoStatement(statement)) {
      return this.processDoWhileStatement(statement, exitId);
    }
    if (Node.isTryStatement(statement)) {
      return this.processTryStatement(statement, exitId, loopContext);
    }
    if (Node.isSwitchStatement(statement)) {
      return this.processSwitchStatement(statement, exitId, loopContext);
    }

    // Handle ternary operators in variable declarations or as expression statements.
    if (Node.isVariableStatement(statement)) {
      const declarations = statement.getDeclarationList().getDeclarations();
      for (const declaration of declarations) {
        const initializer = declaration.getInitializer();
        if (initializer && Node.isAwaitExpression(initializer)) {
          return this.processAwaitExpression(statement);
        }
      }

      if (declarations.length === 1) {
        const declaration = declarations[0];
        const initializer = declaration.getInitializer();
        if (initializer && Node.isConditionalExpression(initializer)) {
          const condExpr = initializer;
          const name = declaration.getName();
          const thenText = `${name} = ${condExpr.getWhenTrue().getText()}`;
          const elseText = `${name} = ${condExpr.getWhenFalse().getText()}`;
          return this.createTernaryGraph(condExpr, thenText, elseText);
        }
      }
    }

    if (Node.isExpressionStatement(statement)) {
      const expr = statement.getExpression();
      if (Node.isAwaitExpression(expr)) {
        return this.processAwaitExpression(statement);
      }
      if (Node.isConditionalExpression(expr)) {
        const thenText = expr.getWhenTrue().getText();
        const elseText = expr.getWhenFalse().getText();
        return this.createTernaryGraph(expr, thenText, elseText);
      }
      if (Node.isCallExpression(expr)) {
        return this.processCallExpression(expr, exitId);
      }
    }

    if (Node.isReturnStatement(statement)) {
      return this.processReturnStatement(statement, exitId);
    }
    if (Node.isBreakStatement(statement) && loopContext) {
      return this.processBreakStatement(statement, loopContext);
    }
    if (Node.isContinueStatement(statement) && loopContext) {
      return this.processContinueStatement(statement, loopContext);
    }
    if (Node.isBlock(statement)) {
      return this.processBlock(statement, exitId, loopContext);
    }

    return this.processDefaultStatement(statement);
  }

  private processAwaitExpression(statement: Statement): ProcessResult {
    const nodeId = this.generateNodeId("await_stmt");
    const nodeText = this.escapeString(statement.getText());
    let graph = `    ${nodeId}[/"${nodeText}"/]\n`;
    graph += `    style ${nodeId} stroke:#004085,stroke-width:2px\n`;

    const start = statement.getStart();
    const end = statement.getEnd();
    this.locationMap.push({ start, end, nodeId });
    graph += `    click ${nodeId} call onNodeClick(${start}, ${end})\n`;

    return {
      graph,
      entryNodeId: nodeId,
      exitPoints: [{ id: nodeId }],
      nodesConnectedToExit: new Set<string>(),
    };
  }

  private processReturnStatement(
    returnStmt: import("ts-morph").ReturnStatement,
    exitId: string
  ): ProcessResult {
    const nodeId = this.generateNodeId("return_stmt");
    const nodeText = this.escapeString(returnStmt.getText());
    let graph = `    ${nodeId}{{"${nodeText}"}}\n`;
    graph += `    style ${nodeId} fill:#fff3cd,stroke:#856404,stroke-width:2px\n`;

    const start = returnStmt.getStart();
    const end = returnStmt.getEnd();
    this.locationMap.push({ start, end, nodeId });
    graph += `    click ${nodeId} call onNodeClick(${start}, ${end})\n`;

    graph += `    ${nodeId} --> ${exitId}\n`;

    return {
      graph,
      entryNodeId: nodeId,
      exitPoints: [],
      nodesConnectedToExit: new Set<string>().add(nodeId),
    };
  }

  private processBreakStatement(
    breakStmt: BreakStatement,
    loopContext: LoopContext
  ): ProcessResult {
    const nodeId = this.generateNodeId("break_stmt");
    let graph = `    ${nodeId}[("break")]\n`;

    const start = breakStmt.getStart();
    const end = breakStmt.getEnd();
    this.locationMap.push({ start, end, nodeId });
    graph += `    click ${nodeId} call onNodeClick(${start}, ${end})\n`;

    graph += `    ${nodeId} --> ${loopContext.breakTargetId}\n`;

    return {
      graph,
      entryNodeId: nodeId,
      exitPoints: [],
      nodesConnectedToExit: new Set<string>().add(nodeId),
    };
  }

  private processContinueStatement(
    continueStmt: ContinueStatement,
    loopContext: LoopContext
  ): ProcessResult {
    const nodeId = this.generateNodeId("continue_stmt");
    let graph = `    ${nodeId}[("continue")]\n`;

    const start = continueStmt.getStart();
    const end = continueStmt.getEnd();
    this.locationMap.push({ start, end, nodeId });
    graph += `    click ${nodeId} call onNodeClick(${start}, ${end})\n`;

    graph += `    ${nodeId} --> ${loopContext.continueTargetId}\n`;

    return {
      graph,
      entryNodeId: nodeId,
      exitPoints: [],
      nodesConnectedToExit: new Set<string>().add(nodeId),
    };
  }

  private processDefaultStatement(statement: Statement): ProcessResult {
    const nodeId = this.generateNodeId("stmt");
    const nodeText = this.escapeString(statement.getText());
    let graph = `    ${nodeId}["${nodeText}"]\n`;

    const start = statement.getStart();
    const end = statement.getEnd();
    this.locationMap.push({ start, end, nodeId });
    graph += `    click ${nodeId} call onNodeClick(${start}, ${end})\n`;

    return {
      graph,
      entryNodeId: nodeId,
      exitPoints: [{ id: nodeId }],
      nodesConnectedToExit: new Set<string>(),
    };
  }

  private processSwitchStatement(
    switchStmt: SwitchStatement,
    exitId: string,
    loopContext?: LoopContext
  ): ProcessResult {
    let graph = "";
    const nodesConnectedToExit = new Set<string>();
    const switchExitPoints: { id: string; label?: string }[] = [];

    const exprText = this.escapeString(switchStmt.getExpression().getText());
    const switchEntryId = this.generateNodeId("switch");
    graph += `    ${switchEntryId}{"switch (${exprText})"}\n`;

    let lastCaseExitPoints: { id: string; label?: string }[] | null = null;
    let lastCaseEntryId: string | null = null;
    let defaultClause: import("ts-morph").DefaultClause | undefined;

    const caseClauses = switchStmt.getCaseBlock().getClauses();

    for (const clause of caseClauses) {
      if (Node.isDefaultClause(clause)) {
        defaultClause = clause;
        continue; // Handle default case at the end.
      }

      if (Node.isCaseClause(clause)) {
        const caseExprText = this.escapeString(
          clause.getExpression().getText()
        );
        const caseEntryId = this.generateNodeId("case");
        graph += `    ${caseEntryId}["case ${caseExprText}"]\n`;

        if (lastCaseExitPoints) {
          // Handle fall-through from previous case
          lastCaseExitPoints.forEach((ep) => {
            graph += `    ${ep.id} --> ${caseEntryId}\n`;
          });
        } else {
          // First case, connect from switch entry
          graph += `    ${switchEntryId} --> ${caseEntryId}\n`;
        }

        const statements = clause.getStatements();
        const statementsWithoutBreak = statements.filter(
          (s) => !Node.isBreakStatement(s)
        );
        const hasBreak = statements.length !== statementsWithoutBreak.length;

        if (statementsWithoutBreak.length > 0) {
          const block = clause.getChildSyntaxListOrThrow();
          const blockResult = this.processBlock(
            block as unknown as Block,
            exitId,
            loopContext
          );
          graph += blockResult.graph;
          blockResult.nodesConnectedToExit.forEach((n) =>
            nodesConnectedToExit.add(n)
          );

          if (blockResult.entryNodeId) {
            graph += `    ${caseEntryId} --> ${blockResult.entryNodeId}\n`;
          }
          lastCaseExitPoints = blockResult.exitPoints;
        } else {
          lastCaseExitPoints = [{ id: caseEntryId }];
        }

        if (hasBreak) {
          lastCaseExitPoints.forEach((ep) => switchExitPoints.push(ep));
          lastCaseExitPoints = null; // Reset for next case, no fall-through
        }
      }
    }

    // Handle default case
    if (defaultClause) {
      const defaultEntryId = this.generateNodeId("default");
      graph += `    ${defaultEntryId}["default"]\n`;

      if (lastCaseExitPoints) {
        // Fall-through from last case
        lastCaseExitPoints.forEach((ep) => {
          graph += `    ${ep.id} --> ${defaultEntryId}\n`;
        });
      }
      // Connect from switch entry if no cases fell through
      graph += `    ${switchEntryId} -- "default" --> ${defaultEntryId}\n`;

      const statements = defaultClause.getStatements();
      if (statements.length > 0) {
        const block = defaultClause.getChildSyntaxListOrThrow();
        const blockResult = this.processBlock(
          block as unknown as Block,
          exitId,
          loopContext
        );
        graph += blockResult.graph;
        blockResult.nodesConnectedToExit.forEach((n) =>
          nodesConnectedToExit.add(n)
        );
        if (blockResult.entryNodeId) {
          graph += `    ${defaultEntryId} --> ${blockResult.entryNodeId}\n`;
        }
        switchExitPoints.push(...blockResult.exitPoints);
      } else {
        switchExitPoints.push({ id: defaultEntryId });
      }
    } else if (lastCaseExitPoints) {
      // Last case does not have a break and there is no default
      switchExitPoints.push(...lastCaseExitPoints);
    }

    // If no cases matched and no default, flow continues from switch
    switchExitPoints.push({ id: switchEntryId, label: " " });

    return {
      graph,
      entryNodeId: switchEntryId,
      exitPoints: switchExitPoints,
      nodesConnectedToExit,
    };
  }

  private processCallExpression(
    callExpr: CallExpression,
    exitId: string
  ): ProcessResult {
    const expression = callExpr.getExpression();

    if (Node.isPropertyAccessExpression(expression)) {
      const methodName = expression.getName();
      const promiseMethods = ["then", "catch", "finally"];
      if (promiseMethods.includes(methodName)) {
        return this.processPromiseCallExpression(callExpr, exitId);
      }

      const commonHOFs = [
        "map",
        "filter",
        "forEach",
        "reduce",
        "find",
        "some",
        "every",
        "sort",
        "flatMap",
      ];

      if (commonHOFs.includes(methodName)) {
        const callback = callExpr.getArguments()[0];

        if (
          callback &&
          (Node.isArrowFunction(callback) ||
            Node.isFunctionExpression(callback))
        ) {
          let graph = "";
          const loopId = this.generateNodeId(`hof_${methodName}`);
          const collectionName = this.escapeString(
            expression.getExpression().getText()
          );
          const conditionText = `For each item in ${collectionName}`;
          graph += `    ${loopId}{"${conditionText}"}\n`;

          const bodyResult = this.processCallback(callback, exitId);

          graph += bodyResult.graph;

          if (bodyResult.entryNodeId) {
            graph += `    ${loopId} -- "Loop Body" --> ${bodyResult.entryNodeId}\n`;
            bodyResult.exitPoints.forEach((ep) => {
              if (!bodyResult.nodesConnectedToExit.has(ep.id)) {
                graph += `    ${ep.id} --> ${loopId}\n`;
              }
            });
          } else {
            graph += `    ${loopId} -- "Loop Body" --> ${loopId}\n`;
          }

          const nodesConnectedToExit = new Set<string>();
          bodyResult.nodesConnectedToExit.forEach((n) =>
            nodesConnectedToExit.add(n)
          );

          return {
            graph,
            entryNodeId: loopId,
            exitPoints: [{ id: loopId, label: "End Loop" }],
            nodesConnectedToExit,
          };
        }
      }
    }

    // Default behavior for all other calls
    const nodeId = this.generateNodeId("stmt");
    const text = this.escapeString(callExpr.getText());
    const graph = `    ${nodeId}["${text}"]\n`;
    return {
      graph,
      entryNodeId: nodeId,
      exitPoints: [{ id: nodeId }],
      nodesConnectedToExit: new Set(),
    };
  }

  private processPromiseCallExpression(
    callExpr: CallExpression,
    exitId: string
  ): ProcessResult {
    const expression = callExpr.getExpression() as PropertyAccessExpression;
    const methodName = expression.getName();
    const promiseSourceExpr = expression.getExpression();

    // Recursively process the promise chain
    let sourceResult: ProcessResult;
    if (Node.isCallExpression(promiseSourceExpr)) {
      sourceResult = this.processCallExpression(promiseSourceExpr, exitId);
    } else {
      const nodeId = this.generateNodeId("expr");
      const nodeText = this.escapeString(promiseSourceExpr.getText());
      let graph = `    ${nodeId}["${nodeText}"]\n`;
      const start = promiseSourceExpr.getStart();
      const end = promiseSourceExpr.getEnd();
      this.locationMap.push({ start, end, nodeId });
      graph += `    click ${nodeId} call onNodeClick(${start}, ${end})\n`;
      sourceResult = {
        graph,
        entryNodeId: nodeId,
        exitPoints: [{ id: nodeId }],
        nodesConnectedToExit: new Set(),
      };
    }

    let graph = sourceResult.graph;
    const nodesConnectedToExit = new Set(sourceResult.nodesConnectedToExit);
    const newExitPoints = [];

    const callback = callExpr.getArguments()[0];
    if (
      callback &&
      (Node.isArrowFunction(callback) || Node.isFunctionExpression(callback))
    ) {
      const callbackResult = this.processCallback(callback, exitId);
      graph += callbackResult.graph;
      callbackResult.nodesConnectedToExit.forEach((n) =>
        nodesConnectedToExit.add(n)
      );

      if (callbackResult.entryNodeId) {
        const edgeLabel = methodName === "catch" ? "rejected" : methodName;
        sourceResult.exitPoints.forEach((ep) => {
          if (!sourceResult.nodesConnectedToExit.has(ep.id)) {
            graph += `    ${ep.id} -- "${edgeLabel}" --> ${callbackResult.entryNodeId}\n`;
          }
        });
      }
      newExitPoints.push(...callbackResult.exitPoints);
    } else {
      // No callback, so just pass through
      newExitPoints.push(...sourceResult.exitPoints);
    }

    // For `then` and `finally`, the original fulfilled/rejected path might continue
    // if the handler is not there or completes successfully.
    // This is a simplification that assumes the happy path if a handler exists.
    if (methodName === "then") {
      // Unhandled rejections from `sourceResult` pass through.
      // We assume `sourceResult.exitPoints` represents the fulfilled path if we connect it.
      // And we lose the rejection path. This is a simplification.
    }

    // if there's a second argument to .then (onRejected)
    const onRejected = methodName === "then" && callExpr.getArguments()[1];
    if (
      onRejected &&
      (Node.isArrowFunction(onRejected) || Node.isFunctionExpression(onRejected))
    ) {
      const onRejectedResult = this.processCallback(onRejected, exitId);
      graph += onRejectedResult.graph;
      onRejectedResult.nodesConnectedToExit.forEach((n) =>
        nodesConnectedToExit.add(n)
      );

      if (onRejectedResult.entryNodeId) {
        sourceResult.exitPoints.forEach((ep) => {
          if (!sourceResult.nodesConnectedToExit.has(ep.id)) {
            graph += `    ${ep.id} -- "rejected" --> ${onRejectedResult.entryNodeId}\n`;
          }
        });
      }
      newExitPoints.push(...onRejectedResult.exitPoints);
    }

    return {
      graph,
      entryNodeId: sourceResult.entryNodeId,
      exitPoints: newExitPoints,
      nodesConnectedToExit,
    };
  }

  private processCallback(
    callback: ArrowFunction | FunctionExpression,
    exitId: string,
    loopContext?: LoopContext
  ): ProcessResult {
    const body = callback.getBody();
    if (Node.isBlock(body)) {
      return this.processBlock(body, exitId, loopContext);
    } else {
      // Concise arrow function with an expression body.
      // We process it as a single statement.
      const expr = body as Expression;
      const nodeId = this.generateNodeId("expr_stmt");
      const text = this.escapeString(expr.getText());
      let graph = `    ${nodeId}["${text}"]\n`;

      const start = expr.getStart();
      const end = expr.getEnd();
      this.locationMap.push({ start, end, nodeId });
      graph += `    click ${nodeId} call onNodeClick(${start}, ${end})\n`;

      return {
        graph,
        entryNodeId: nodeId,
        exitPoints: [{ id: nodeId }],
        nodesConnectedToExit: new Set(),
      };
    }
  }

  private createTernaryGraph(
    condExpr: ConditionalExpression,
    thenText: string,
    elseText: string
  ): ProcessResult {
    const conditionId = this.generateNodeId("ternary_cond");
    const conditionText = this.escapeString(condExpr.getCondition().getText());
    let graph = `    ${conditionId}{"${conditionText}"}\n`;

    const start = condExpr.getStart();
    const end = condExpr.getEnd();
    this.locationMap.push({ start, end, nodeId: conditionId });
    graph += `    click ${conditionId} call onNodeClick(${start}, ${end})\n`;

    const thenNodeId = this.generateNodeId("ternary_then");
    graph += `    ${thenNodeId}["${this.escapeString(thenText)}"]\n`;
    graph += `    ${conditionId} -- "Yes" --> ${thenNodeId}\n`;

    const elseNodeId = this.generateNodeId("ternary_else");
    graph += `    ${elseNodeId}["${this.escapeString(elseText)}"]\n`;
    graph += `    ${conditionId} -- "No" --> ${elseNodeId}\n`;

    const exitPoints = [{ id: thenNodeId }, { id: elseNodeId }];
    return {
      graph,
      entryNodeId: conditionId,
      exitPoints,
      nodesConnectedToExit: new Set(),
    };
  }

  /**
   * Processes an if-else statement, handling both `then` and `else` branches and their merge points.
   */
  private processIfStatement(
    ifStmt: IfStatement,
    exitId: string,
    loopContext?: LoopContext
  ): ProcessResult {
    const condition = this.escapeString(ifStmt.getExpression().getText());
    const conditionId = this.generateNodeId("if_cond");
    let graph = `    ${conditionId}{"${condition}"}\n`;

    const start = ifStmt.getStart();
    const end = ifStmt.getEnd();
    this.locationMap.push({ start, end, nodeId: conditionId });
    graph += `    click ${conditionId} call onNodeClick(${start}, ${end})\n`;

    let current = ifStmt;
    const exitPoints: { id: string; label?: string }[] = [];
    const nodesConnectedToExit = new Set<string>();

    // Process "then" branch.
    const thenResult = this.processStatement(
      ifStmt.getThenStatement(),
      exitId,
      loopContext
    );
    graph += thenResult.graph;
    if (thenResult.entryNodeId) {
      graph += `    ${conditionId} -- "Yes" --> ${thenResult.entryNodeId}\n`;
    }
    exitPoints.push(...thenResult.exitPoints);
    thenResult.nodesConnectedToExit.forEach((n) => nodesConnectedToExit.add(n));

    // Process "else" branch if it exists.
    const elseStatement = ifStmt.getElseStatement();
    if (elseStatement) {
      const elseResult = this.processStatement(
        elseStatement,
        exitId,
        loopContext
      );
      graph += elseResult.graph;
      if (elseResult.entryNodeId) {
        graph += `    ${conditionId} -- "No" --> ${elseResult.entryNodeId}\n`;
      }
      exitPoints.push(...elseResult.exitPoints);
      elseResult.nodesConnectedToExit.forEach((n) =>
        nodesConnectedToExit.add(n)
      );
    } else {
      // If no 'else', the "No" path from the condition is a valid exit from this structure.
      exitPoints.push({ id: conditionId, label: "No" });
    }

    return {
      graph,
      entryNodeId: conditionId,
      exitPoints,
      nodesConnectedToExit,
    };
  }

  /**
   * Processes a 'try-catch-finally' statement.
   */
  private processTryStatement(
    tryStmt: TryStatement,
    exitId: string,
    loopContext?: LoopContext
  ): ProcessResult {
    const tryBlock = tryStmt.getTryBlock();
    const catchClause = tryStmt.getCatchClause();
    const finallyBlock = tryStmt.getFinallyBlock();

    const entryNodeId = this.generateNodeId("try_entry");
    let graph = `    ${entryNodeId}[("Try")]\n`;

    const start = tryStmt.getStart();
    const end = tryStmt.getEnd();
    this.locationMap.push({ start, end, nodeId: entryNodeId });
    graph += `    click ${entryNodeId} call onNodeClick(${start}, ${end})\n`;

    const exitPoints: { id: string; label?: string }[] = [];
    const nodesConnectedToExit = new Set<string>();

    const tryResult = this.processBlock(tryBlock, exitId, loopContext);
    graph += tryResult.graph;
    tryResult.nodesConnectedToExit.forEach((n) => nodesConnectedToExit.add(n));

    if (catchClause) {
      const catchBlock = catchClause.getBlock();
      const catchResult = this.processBlock(catchBlock, exitId, loopContext);
      graph += catchResult.graph;
      catchResult.nodesConnectedToExit.forEach((n) =>
        nodesConnectedToExit.add(n)
      );

      if (tryResult.entryNodeId && catchResult.entryNodeId) {
        // This is a simplification. Realistically, any node in `try` can throw.
        // For the flowchart, we'll draw a single "error" path from the start of the try block.
        graph += `    ${tryResult.entryNodeId} -- "error" --> ${catchResult.entryNodeId}\n`;
      }

      if (finallyBlock) {
        const finallyResult = this.processBlock(
          finallyBlock,
          exitId,
          loopContext
        );
        graph += finallyResult.graph;
        finallyResult.nodesConnectedToExit.forEach((n) =>
          nodesConnectedToExit.add(n)
        );

        tryResult.exitPoints.forEach((ep) => {
          if (finallyResult.entryNodeId) {
            graph += `    ${ep.id} --> ${finallyResult.entryNodeId}\n`;
          }
        });
        catchResult.exitPoints.forEach((ep) => {
          if (finallyResult.entryNodeId) {
            graph += `    ${ep.id} --> ${finallyResult.entryNodeId}\n`;
          }
        });
        exitPoints.push(...finallyResult.exitPoints);
      } else {
        exitPoints.push(...tryResult.exitPoints, ...catchResult.exitPoints);
      }
    } else if (finallyBlock) {
      const finallyResult = this.processBlock(
        finallyBlock,
        exitId,
        loopContext
      );
      graph += finallyResult.graph;
      finallyResult.nodesConnectedToExit.forEach((n) =>
        nodesConnectedToExit.add(n)
      );

      tryResult.exitPoints.forEach((ep) => {
        if (finallyResult.entryNodeId) {
          graph += `    ${ep.id} --> ${finallyResult.entryNodeId}\n`;
        }
      });
      exitPoints.push(...finallyResult.exitPoints);
    } else {
      // A `try` block without a `catch` or `finally` is not valid, but we handle it.
      exitPoints.push(...tryResult.exitPoints);
    }

    return {
      graph,
      entryNodeId: tryResult.entryNodeId,
      exitPoints,
      nodesConnectedToExit,
    };
  }

  /**
   * Processes a 'for' loop, modeling the initializer, condition, body, and incrementor.
   */
  private processForStatement(
    forStmt: ForStatement,
    exitId: string
  ): ProcessResult {
    const initializer = forStmt.getInitializer();
    const condition = forStmt.getCondition();
    const incrementor = forStmt.getIncrementor();
    const body = forStmt.getStatement();

    const initText = initializer
      ? this.escapeString(initializer.getText())
      : "";
    const initId = this.generateNodeId("for_init");
    let graph = `    ${initId}["${initText}"]\n`;

    const start = forStmt.getStart();
    const end = forStmt.getEnd();
    this.locationMap.push({ start, end, nodeId: initId });
    graph += `    click ${initId} call onNodeClick(${start}, ${end})\n`;

    const condText = condition
      ? this.escapeString(condition.getText())
      : "true";
    const condId = this.generateNodeId("for_cond");
    graph += `    ${condId}{"${condText}"}\n`;
    graph += `    ${initId} --> ${condId}\n`;

    const incText = this.escapeString(
      forStmt.getIncrementor()?.getText() || ""
    );
    const incId = this.generateNodeId("for_inc");
    graph += `    ${incId}["${incText || "increment"}"]\n`;

    const loopExitId = this.generateNodeId("for_exit");
    graph += `    ${loopExitId}(( ))\n`; // Dummy node for break
    const loopContext: LoopContext = {
      breakTargetId: loopExitId,
      continueTargetId: incId,
    };

    const nodesConnectedToExit = new Set<string>();

    const bodyResult = this.processStatement(
      forStmt.getStatement(),
      exitId,
      loopContext
    );
    graph += bodyResult.graph;
    if (bodyResult.entryNodeId) {
      graph += `    ${condId} -- "Yes" --> ${bodyResult.entryNodeId}\n`;
    }
    bodyResult.nodesConnectedToExit.forEach((n) => nodesConnectedToExit.add(n));

    bodyResult.exitPoints.forEach((exitPoint) => {
      const label = exitPoint.label ? ` -- "${exitPoint.label}" --> ` : ` --> `;
      graph += `    ${exitPoint.id}${label}${incId}\n`;
    });

    graph += `    ${incId} --> ${condId}\n`; // Loop back to condition.

    const exitPoints = [{ id: condId, label: "No" }];
    graph += `    ${condId} -- "No" --> ${loopExitId}\n`;

    return {
      graph,
      entryNodeId: initId,
      exitPoints: [{ id: loopExitId }],
      nodesConnectedToExit,
    };
  }

  private processForOfStatement(
    forOfStmt: ForOfStatement,
    exitId: string
  ): ProcessResult {
    const initializer = forOfStmt.getInitializer().getText();
    const expression = forOfStmt.getExpression().getText();
    const body = forOfStmt.getStatement();

    const loopHeaderId = this.generateNodeId("for_of_header");
    const loopHeaderText = this.escapeString(
      `for (${initializer} of ${expression})`
    );
    let graph = `    ${loopHeaderId}{"${loopHeaderText}"}\n`;

    const start = forOfStmt.getStart();
    const end = forOfStmt.getEnd();
    this.locationMap.push({ start, end, nodeId: loopHeaderId });
    graph += `    click ${loopHeaderId} call onNodeClick(${start}, ${end})\n`;

    const exitLoopId = this.generateNodeId("for_of_exit");
    graph += `    ${exitLoopId}[("end loop")]\n`;
    const loopContext: LoopContext = {
      breakTargetId: exitLoopId,
      continueTargetId: loopHeaderId,
    };

    const nodesConnectedToExit = new Set<string>();

    const bodyResult = this.processBlock(body as Block, exitId, loopContext);
    graph += bodyResult.graph;
    if (bodyResult.entryNodeId) {
      graph += `    ${loopHeaderId} -- "Loop" --> ${bodyResult.entryNodeId}\n`;
    }
    bodyResult.nodesConnectedToExit.forEach((n) => nodesConnectedToExit.add(n));

    bodyResult.exitPoints.forEach((exitPoint) => {
      const label = exitPoint.label ? ` -- "${exitPoint.label}" --> ` : ` --> `;
      graph += `    ${exitPoint.id}${label}${loopHeaderId}\n`;
    });

    const exitPoints = [{ id: loopHeaderId, label: "End" }];
    graph += `    ${loopHeaderId} -- "End For Each" --> ${exitLoopId}\n`;

    return {
      graph,
      entryNodeId: loopHeaderId,
      exitPoints: [{ id: exitLoopId }],
      nodesConnectedToExit,
    };
  }

  private processForInStatement(
    forInStmt: ForInStatement,
    exitId: string
  ): ProcessResult {
    const initializer = forInStmt.getInitializer().getText();
    const expression = forInStmt.getExpression().getText();
    const body = forInStmt.getStatement();

    const loopHeaderId = this.generateNodeId("for_in_header");
    const loopHeaderText = this.escapeString(
      `for (${initializer} in ${expression})`
    );
    let graph = `    ${loopHeaderId}{"${loopHeaderText}"}\n`;

    const start = forInStmt.getStart();
    const end = forInStmt.getEnd();
    this.locationMap.push({ start, end, nodeId: loopHeaderId });
    graph += `    click ${loopHeaderId} call onNodeClick(${start}, ${end})\n`;

    const exitLoopId = this.generateNodeId("for_in_exit");
    graph += `    ${exitLoopId}[("end loop")]\n`;
    const loopContext: LoopContext = {
      breakTargetId: exitLoopId,
      continueTargetId: loopHeaderId,
    };

    const nodesConnectedToExit = new Set<string>();

    const bodyResult = this.processBlock(body as Block, exitId, loopContext);
    graph += bodyResult.graph;
    if (bodyResult.entryNodeId) {
      graph += `    ${loopHeaderId} -- "Loop" --> ${bodyResult.entryNodeId}\n`;
    }
    bodyResult.nodesConnectedToExit.forEach((n) => nodesConnectedToExit.add(n));

    bodyResult.exitPoints.forEach((exitPoint) => {
      const label = exitPoint.label ? ` -- "${exitPoint.label}" --> ` : ` --> `;
      graph += `    ${exitPoint.id}${label}${loopHeaderId}\n`;
    });

    const exitPoints = [{ id: loopHeaderId, label: "End" }];
    graph += `    ${loopHeaderId} -- "End For In" --> ${exitLoopId}\n`;

    return {
      graph,
      entryNodeId: loopHeaderId,
      exitPoints: [{ id: exitLoopId }],
      nodesConnectedToExit,
    };
  }

  /**
   * Processes a 'while' loop.
   */
  private processWhileStatement(
    whileStmt: WhileStatement,
    exitId: string
  ): ProcessResult {
    const condition = this.escapeString(whileStmt.getExpression().getText());
    const body = whileStmt.getStatement();

    const conditionId = this.generateNodeId("while_cond");
    let graph = `    ${conditionId}{"${condition}"}\n`;

    const start = whileStmt.getStart();
    const end = whileStmt.getEnd();
    this.locationMap.push({ start, end, nodeId: conditionId });
    graph += `    click ${conditionId} call onNodeClick(${start}, ${end})\n`;

    const exitLoopId = this.generateNodeId("while_exit");
    graph += `    ${exitLoopId}[("end loop")]\n`;
    const loopContext: LoopContext = {
      breakTargetId: exitLoopId,
      continueTargetId: conditionId,
    };

    const nodesConnectedToExit = new Set<string>();

    const bodyResult = this.processBlock(body as Block, exitId, loopContext);
    graph += bodyResult.graph;
    if (bodyResult.entryNodeId) {
      graph += `    ${conditionId} -- "Yes" --> ${bodyResult.entryNodeId}\n`;
    }
    bodyResult.nodesConnectedToExit.forEach((n) => nodesConnectedToExit.add(n));

    bodyResult.exitPoints.forEach((exitPoint) => {
      const label = exitPoint.label ? ` -- "${exitPoint.label}" --> ` : ` --> `;
      graph += `    ${exitPoint.id}${label}${conditionId}\n`;
    });

    const exitPoints = [{ id: conditionId, label: "No" }];
    graph += `    ${conditionId} -- "No" --> ${exitLoopId}\n`;

    return {
      graph,
      entryNodeId: conditionId,
      exitPoints: [{ id: exitLoopId }],
      nodesConnectedToExit,
    };
  }

  /**
   * Processes a 'do-while' loop.
   */
  private processDoWhileStatement(
    doStmt: DoStatement,
    exitId: string
  ): ProcessResult {
    const condition = this.escapeString(doStmt.getExpression().getText());
    const body = doStmt.getStatement();

    const bodyEntryId = this.generateNodeId("do_while_body");
    let graph = `    ${bodyEntryId}[("do")]\n`;

    const start = doStmt.getStart();
    const end = doStmt.getEnd();
    this.locationMap.push({ start, end, nodeId: bodyEntryId });
    graph += `    click ${bodyEntryId} call onNodeClick(${start}, ${end})\n`;

    const conditionId = this.generateNodeId("do_while_cond");
    graph += `    ${conditionId}{"${condition}"}\n`;

    const exitLoopId = this.generateNodeId("do_while_exit");
    graph += `    ${exitLoopId}[("end loop")]\n`;
    const loopContext: LoopContext = {
      breakTargetId: exitLoopId,
      continueTargetId: conditionId,
    };

    const nodesConnectedToExit = new Set<string>();

    const bodyResult = this.processStatement(
      doStmt.getStatement(),
      exitId,
      loopContext
    );
    graph += bodyResult.graph;
    bodyResult.nodesConnectedToExit.forEach((n) => nodesConnectedToExit.add(n));

    if (bodyResult.entryNodeId) {
      graph += `    ${bodyEntryId} --> ${bodyResult.entryNodeId}\n`;
      bodyResult.exitPoints.forEach((exitPoint) => {
        const label = exitPoint.label
          ? ` -- "${exitPoint.label}" --> `
          : ` --> `;
        graph += `    ${exitPoint.id}${label}${conditionId}\n`;
      });
      graph += `    ${conditionId} -- "Yes" --> ${bodyResult.entryNodeId}\n`; // Loop back.
    }

    const exitPoints = [{ id: conditionId, label: "No" }];
    graph += `    ${conditionId} -- "No" --> ${exitLoopId}\n`;

    return {
      graph,
      entryNodeId: bodyResult.entryNodeId,
      exitPoints: [{ id: exitLoopId }],
      nodesConnectedToExit,
    };
  }
}
