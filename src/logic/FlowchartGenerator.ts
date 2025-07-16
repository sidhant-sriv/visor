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
} from "ts-morph";

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
  public generateFlowchart(sourceFile: SourceFile, position: number): string {
    this.nodeIdCounter = 0;

    const descendant = sourceFile.getDescendantAtPos(position);
    if (!descendant) {
      return 'graph TD\n    A["No code found at cursor position."];';
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
      return 'graph TD\n    A["Place cursor inside a function or method to generate a flowchart."];';
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

    return flowchart;
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
    const nodeId = this.generateNodeId("await");
    const text = this.escapeString(statement.getText());
    // Using parallelogram shape for async operation
    const graph = `    ${nodeId}[/"${text}"/]\n    style ${nodeId} stroke:#004085,stroke-width:2px\n`;

    return {
      graph,
      entryNodeId: nodeId,
      exitPoints: [{ id: nodeId }],
      nodesConnectedToExit: new Set(),
    };
  }

  private processReturnStatement(
    returnStmt: import("ts-morph").ReturnStatement,
    exitId: string
  ): ProcessResult {
    const nodeId = this.generateNodeId("ret");
    const text = this.escapeString(returnStmt.getText());
    let graph = `    ${nodeId}[/"${text}"/]\n`;
    graph += `    style ${nodeId} fill:#fff3cd,stroke:#856404,stroke-width:2px\n`;
    graph += `    ${nodeId} --> ${exitId}\n`; // Return statements go directly to the end.
    return {
      graph,
      entryNodeId: nodeId,
      exitPoints: [],
      nodesConnectedToExit: new Set([nodeId]),
    };
  }

  private processBreakStatement(
    breakStmt: BreakStatement,
    loopContext: LoopContext
  ): ProcessResult {
    const nodeId = this.generateNodeId("break");
    const graph = `    ${nodeId}[/break/]\n    ${nodeId} --> ${loopContext.breakTargetId}\n`;
    return {
      graph,
      entryNodeId: nodeId,
      exitPoints: [],
      nodesConnectedToExit: new Set([nodeId]),
    };
  }

  private processContinueStatement(
    continueStmt: ContinueStatement,
    loopContext: LoopContext
  ): ProcessResult {
    const nodeId = this.generateNodeId("continue");
    const graph = `    ${nodeId}[/continue/]\n    ${nodeId} --> ${loopContext.continueTargetId}\n`;
    return {
      graph,
      entryNodeId: nodeId,
      exitPoints: [],
      nodesConnectedToExit: new Set([nodeId]),
    };
  }

  private processDefaultStatement(statement: Statement): ProcessResult {
    // Default case for simple statements (expressions, declarations, etc.).
    const nodeId = this.generateNodeId("stmt");
    const text = this.escapeString(statement.getText());
    const graph = `    ${nodeId}["${text}"]\n`; // Rectangle shape for standard process.
    return {
      graph,
      entryNodeId: nodeId,
      exitPoints: [{ id: nodeId }],
      nodesConnectedToExit: new Set(),
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

          const body = callback.getBody();
          let bodyResult: ProcessResult;

          if (Node.isBlock(body)) {
            bodyResult = this.processBlock(body, exitId);
          } else {
            // Concise arrow function with an expression body
            const nodeId = this.generateNodeId("expr_stmt");
            const text = this.escapeString(body.getText());
            const bodyGraph = `    ${nodeId}["${text}"]\n`;
            bodyResult = {
              graph: bodyGraph,
              entryNodeId: nodeId,
              exitPoints: [{ id: nodeId }],
              nodesConnectedToExit: new Set(),
            };
          }

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

  private createTernaryGraph(
    condExpr: ConditionalExpression,
    thenText: string,
    elseText: string
  ): ProcessResult {
    let graph = "";
    const conditionId = this.generateNodeId("ternary_cond");
    const conditionText = this.escapeString(condExpr.getCondition().getText());
    graph += `    ${conditionId}{"${conditionText}"}\n`;

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
    let graph = "";
    const conditionId = this.generateNodeId("if");
    const conditionText = this.escapeString(ifStmt.getExpression().getText());
    graph += `    ${conditionId}{"${conditionText}"}\n`; // Diamond shape for decision.

    let exitPoints: { id: string; label?: string }[] = [];
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
    let graph = "";
    const nodesConnectedToExit = new Set<string>();
    let exitPoints: { id: string; label?: string }[] = [];

    const tryBlock = tryStmt.getTryBlock();
    const catchClause = tryStmt.getCatchClause();
    const finallyBlock = tryStmt.getFinallyBlock();

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
    let graph = "";
    const nodesConnectedToExit = new Set<string>();

    const initText = this.escapeString(
      forStmt.getInitializer()?.getText() || ""
    );
    const initId = this.generateNodeId("for_init");
    graph += `    ${initId}["${initText || "init"}"]\n`;

    const condText = this.escapeString(forStmt.getCondition()?.getText() || "");
    const condId = this.generateNodeId("for_cond");
    graph += `    ${condId}{"${condText || "true"}"}\n`;
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
    let graph = "";
    const nodesConnectedToExit = new Set<string>();

    const decl = forOfStmt.getInitializer().getText();
    const expr = forOfStmt.getExpression().getText();
    const condText = this.escapeString(`For each ${decl} of ${expr}`);
    const condId = this.generateNodeId("for_of_cond");
    graph += `    ${condId}{"${condText}"}\n`;

    const loopExitId = this.generateNodeId("for_of_exit");
    graph += `    ${loopExitId}(( ))\n`;
    const loopContext: LoopContext = {
      breakTargetId: loopExitId,
      continueTargetId: condId,
    };

    const bodyResult = this.processStatement(
      forOfStmt.getStatement(),
      exitId,
      loopContext
    );
    graph += bodyResult.graph;
    if (bodyResult.entryNodeId) {
      graph += `    ${condId} -- "Loop" --> ${bodyResult.entryNodeId}\n`;
    }
    bodyResult.nodesConnectedToExit.forEach((n) => nodesConnectedToExit.add(n));

    bodyResult.exitPoints.forEach((exitPoint) => {
      const label = exitPoint.label ? ` -- "${exitPoint.label}" --> ` : ` --> `;
      graph += `    ${exitPoint.id}${label}${condId}\n`;
    });

    const exitPoints = [{ id: condId, label: "End" }];
    graph += `    ${condId} -- "End For Each" --> ${loopExitId}\n`;

    return {
      graph,
      entryNodeId: condId,
      exitPoints: [{ id: loopExitId }],
      nodesConnectedToExit,
    };
  }

  private processForInStatement(
    forInStmt: ForInStatement,
    exitId: string
  ): ProcessResult {
    let graph = "";
    const nodesConnectedToExit = new Set<string>();

    const decl = forInStmt.getInitializer().getText();
    const expr = forInStmt.getExpression().getText();
    const condText = this.escapeString(`For each ${decl} in ${expr}`);
    const condId = this.generateNodeId("for_in_cond");
    graph += `    ${condId}{"${condText}"}\n`;

    const loopExitId = this.generateNodeId("for_in_exit");
    graph += `    ${loopExitId}(( ))\n`;
    const loopContext: LoopContext = {
      breakTargetId: loopExitId,
      continueTargetId: condId,
    };

    const bodyResult = this.processStatement(
      forInStmt.getStatement(),
      exitId,
      loopContext
    );
    graph += bodyResult.graph;
    if (bodyResult.entryNodeId) {
      graph += `    ${condId} -- "Loop" --> ${bodyResult.entryNodeId}\n`;
    }
    bodyResult.nodesConnectedToExit.forEach((n) => nodesConnectedToExit.add(n));

    bodyResult.exitPoints.forEach((exitPoint) => {
      const label = exitPoint.label ? ` -- "${exitPoint.label}" --> ` : ` --> `;
      graph += `    ${exitPoint.id}${label}${condId}\n`;
    });

    const exitPoints = [{ id: condId, label: "End" }];
    graph += `    ${condId} -- "End For In" --> ${loopExitId}\n`;

    return {
      graph,
      entryNodeId: condId,
      exitPoints: [{ id: loopExitId }],
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
    let graph = "";
    const nodesConnectedToExit = new Set<string>();

    const condText = this.escapeString(whileStmt.getExpression().getText());
    const condId = this.generateNodeId("while_cond");
    graph += `    ${condId}{"${condText}"}\n`;

    const loopExitId = this.generateNodeId("while_exit");
    graph += `    ${loopExitId}(( ))\n`;
    const loopContext: LoopContext = {
      breakTargetId: loopExitId,
      continueTargetId: condId,
    };

    const bodyResult = this.processStatement(
      whileStmt.getStatement(),
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
      graph += `    ${exitPoint.id}${label}${condId}\n`;
    });

    const exitPoints = [{ id: condId, label: "No" }];
    graph += `    ${condId} -- "No" --> ${loopExitId}\n`;

    return {
      graph,
      entryNodeId: condId,
      exitPoints: [{ id: loopExitId }],
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
    let graph = "";
    const nodesConnectedToExit = new Set<string>();

    const condText = this.escapeString(doStmt.getExpression().getText());
    const condId = this.generateNodeId("do_cond");
    graph += `    ${condId}{"${condText}"}\n`;

    const loopExitId = this.generateNodeId("do_exit");
    graph += `    ${loopExitId}(( ))\n`;
    const bodyResult = this.processStatement(doStmt.getStatement(), exitId, {
      breakTargetId: loopExitId,
      continueTargetId: condId,
    });
    graph += bodyResult.graph;
    bodyResult.nodesConnectedToExit.forEach((n) => nodesConnectedToExit.add(n));

    if (bodyResult.entryNodeId) {
      bodyResult.exitPoints.forEach((exitPoint) => {
        const label = exitPoint.label
          ? ` -- "${exitPoint.label}" --> `
          : ` --> `;
        graph += `    ${exitPoint.id}${label}${condId}\n`;
      });
      graph += `    ${condId} -- "Yes" --> ${bodyResult.entryNodeId}\n`; // Loop back.
    }

    const exitPoints = [{ id: condId, label: "No" }];
    graph += `    ${condId} -- "No" --> ${loopExitId}\n`;

    return {
      graph,
      entryNodeId: bodyResult.entryNodeId,
      exitPoints: [{ id: loopExitId }],
      nodesConnectedToExit,
    };
  }
}
