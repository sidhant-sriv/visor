import Parser from "tree-sitter";
import Python from "tree-sitter-python";
import { FlowchartIR, FlowchartNode, FlowchartEdge, LocationMapEntry } from "../../../ir/ir";


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
 * A class to manage the state and construction of the Control Flow Graph from Python code.
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
    await: "fill:#f0e68c,stroke:#000,stroke-width:1px,color:#000", // Khaki for await
  };

  private generateNodeId(prefix: string): string {
    return `${prefix}_${this.nodeIdCounter++}`;
  }

  private escapeString(str: string): string {
    if (!str) {
      return "";
    }

    // Replace quotes to avoid Mermaid parsing issues and flatten multi-line text.
    const sanitized = str
      .replace(/"/g, "#quot;")
      .replace(/\n/g, " ")
      .replace(/:$/, "")
      .trim();

    // Allow longer labels before truncation so returned values and long expressions are visible.
    const MAX_LABEL_LENGTH = 120;
    return sanitized.length > MAX_LABEL_LENGTH
      ? sanitized.substring(0, MAX_LABEL_LENGTH - 3) + "..."
      : sanitized;
  }

  /**
   * Lists all function names found in the source code.
   */
  public listFunctions(sourceCode: string): string[] {
      const parser = new Parser();
      parser.setLanguage(Python as any);
      const tree = parser.parse(sourceCode);
      const functions = tree.rootNode.descendantsOfType("function_definition");
      return functions.map((f: any) => f.childForFieldName("name")?.text || "[anonymous]");
  }

  /**
   * Finds the function that contains the given position.
   * @param sourceCode The Python code to parse.
   * @param position The byte position in the source code.
   * @returns The function name or undefined if no function contains the position.
   */
  public findFunctionAtPosition(sourceCode: string, position: number): string | undefined {
      const parser = new Parser();
      parser.setLanguage(Python as any);
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
   * @param sourceCode The Python code to parse.
   * @param functionName Optional name of the function to generate a flowchart for. Defaults to the first function.
   * @param position Optional position to find the function containing this position.
   */
  public generateFlowchart(sourceCode: string, functionName?: string, position?: number): FlowchartIR {
    this.nodeIdCounter = 0;
    this.locationMap = [];

    const parser = new Parser();
    parser.setLanguage(Python as any);
    const tree = parser.parse(sourceCode);

    let functionNode: any;
    const functionNodes = tree.rootNode.descendantsOfType("function_definition");

    if (position !== undefined) {
        // Find function containing the position
        functionNode = functionNodes.find(f => position >= f.startIndex && position <= f.endIndex);
    } else if (functionName) {
        // Find function by name
        functionNode = functionNodes.find(f => f.childForFieldName("name")?.text === functionName);
    } else {
        // Default to first function
        functionNode = functionNodes[0];
    }

    if (!functionNode) {
      const message = functionName 
        ? `Function '${functionName}' not found.`
        : position !== undefined
        ? "Place cursor inside a function to generate a flowchart."
        : "No function found in code.";
      console.log("[PyAstParser] No function node found:", { functionName, position, functionNodes: functionNodes.map(f => f.childForFieldName("name")?.text) });
      return {
        nodes: [{ id: "A", label: message, shape: "rect" }],
        edges: [],
        locationMap: [],
      };
    }

    const funcNameNode = functionNode.childForFieldName("name");
    let discoveredFunctionName = funcNameNode?.text || "[anonymous]";
    
    // The AST structure for decorators and async changed.
    // In older versions, they were part of the function_definition node itself.
    let parent: Parser.SyntaxNode | null = functionNode;
    let isAsync = false;
    const decoratorNames: string[] = [];

    // Check for async keyword and decorators on the function definition itself
    if (parent?.firstChild?.type === 'async') {
      isAsync = true;
    }
    parent?.children.forEach((child: any) => {
      if (child.type === 'decorator') {
        decoratorNames.push(`@${child.text}`);
      }
    });

    if (decoratorNames.length > 0) {
      discoveredFunctionName = `${decoratorNames.join('\\n')}\\n${discoveredFunctionName}`;
    }

    if (isAsync) {
      discoveredFunctionName = `async ${discoveredFunctionName}`;
    }

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
      // FIX: Changed "end" to "End" to avoid Mermaid keyword conflict
      label: "End",
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
        // Body was empty or only contained 'pass' statements
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

    // LOGGING: Output the generated nodes and edges for debugging Mermaid syntax issues
    console.log("[PyAstParser] Function:", discoveredFunctionName);
    console.log("[PyAstParser] Nodes:", JSON.stringify(nodes, null, 2));
    console.log("[PyAstParser] Edges:", JSON.stringify(validEdges, null, 2));
    console.log("[PyAstParser] LocationMap:", JSON.stringify(this.locationMap, null, 2));

    const result: FlowchartIR = {
      nodes,
      edges: validEdges,
      locationMap: this.locationMap,
      functionRange: {
        start: functionNode.startIndex,
        end: functionNode.endIndex,
      },
      title: `Flowchart for ${funcNameNode?.text || '[anonymous]'}`,
      entryNodeId: entryId,
      exitNodeId: exitId,
    };
    console.log("[PyAstParser] FlowchartIR:", JSON.stringify(result, null, 2));
    return result;
  }

  /**
   * Processes a block of statements, connecting them sequentially.
   */
  private processBlock(
    blockNode: any | null | undefined,
    exitId: string,
    loopContext?: LoopContext
  ): ProcessResult {
    if (!blockNode) {
      return { nodes: [], edges: [], entryNodeId: undefined, exitPoints: [], nodesConnectedToExit: new Set<string>(), };
    }
    const nodes: FlowchartNode[] = [];
    const edges: FlowchartEdge[] = [];
    let entryNodeId: string | undefined = undefined;
    const nodesConnectedToExit = new Set<string>();
    let lastExitPoints: { id: string; label?: string }[] = [];

    const statements = blockNode.namedChildren.filter((s: any) => s.type !== 'pass_statement' && s.type !== 'comment');

    if (statements.length === 0) {
      return { nodes: [], edges: [], entryNodeId: undefined, exitPoints: [], nodesConnectedToExit, };
    }
    
    for (const statement of statements) {
      const result = this.processStatement(statement, exitId, loopContext);
      nodes.push(...result.nodes);
      edges.push(...result.edges);

      if (lastExitPoints.length > 0) {
        lastExitPoints.forEach((exitPoint) => {
          if (result.entryNodeId) {
            edges.push({
              from: exitPoint.id,
              to: result.entryNodeId,
              label: exitPoint.label,
            });
          }
        });
      } else if (!entryNodeId) {
        entryNodeId = result.entryNodeId;
      }
      
      // FIX: Always update lastExitPoints with the new result.
      // If a 'return' is processed, result.exitPoints will be [], correctly
      // indicating that this path of execution has terminated.
      lastExitPoints = result.exitPoints;

      result.nodesConnectedToExit.forEach((n) => nodesConnectedToExit.add(n));
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
    statement: any, // TODO: Add type
    exitId: string,
    loopContext?: LoopContext
  ): ProcessResult {
    switch (statement.type) {
      case "if_statement":
        return this.processIfStatement(statement, exitId, loopContext);
      case "elif_clause":
        return this.processIfStatement(statement, exitId, loopContext);
      case "else_clause": {
        const blockNode = statement.namedChildren.find((c: any) => c.type === "block") || null;
        return this.processBlock(blockNode, exitId, loopContext);
      }
      case "for_statement":
        return this.processForStatement(statement, exitId);
      case "while_statement":
        return this.processWhileStatement(statement, exitId);
      case "with_statement":
        return this.processWithStatement(statement, exitId, loopContext);
      case "try_statement":
        return this.processTryStatement(statement, exitId, loopContext);
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
      case "pass_statement":
         return { nodes: [], edges: [], entryNodeId: undefined, exitPoints: [], nodesConnectedToExit: new Set<string>() };
    }
    return this.processDefaultStatement(statement);
  }

  /**
   * Processes a standard statement, creating a single node.
   */
  private processDefaultStatement(statement: any): ProcessResult {
    const nodeId = this.generateNodeId("stmt");
    let nodeText = this.escapeString(statement.text);
    let style = this.nodeStyles.process;

    // Check for await expressions
    if (statement.descendantsOfType('await').length > 0) {
        nodeText = `(await) ${nodeText}`;
        style = this.nodeStyles.await;
    }

    const nodes: FlowchartNode[] = [{ id: nodeId, label: nodeText, shape: "rect", style }];

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
   * Processes an if-elif-else statement chain.
   */
  private processIfStatement(
    ifNode: any, // can be if_statement or elif_clause
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

    // Process "then" block
    const thenBlock = ifNode.childForFieldName("body")!;
    const thenResult = this.processBlock(thenBlock, exitId, loopContext);
    nodes.push(...thenResult.nodes);
    edges.push(...thenResult.edges);
    if (thenResult.entryNodeId) {
      edges.push({ from: conditionId, to: thenResult.entryNodeId, label: "True" });
      exitPoints.push(...thenResult.exitPoints);
    } else {
      // Body was empty or pass, so flow continues from condition
      exitPoints.push({id: conditionId, label: "True"});
    }
    thenResult.nodesConnectedToExit.forEach((n) => nodesConnectedToExit.add(n));

    // Process 'elif' or 'else' clauses
    const alternative = ifNode.childForFieldName("alternative");

    if (alternative) {
      const elseResult = this.processStatement(alternative, exitId, loopContext);
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
      // No 'else', so the 'False' path is a valid exit from the if statement
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
    forNode: any,
    exitId: string
  ): ProcessResult {
    const nodes: FlowchartNode[] = [];
    const edges: FlowchartEdge[] = [];
    const nodesConnectedToExit = new Set<string>();

    const headerText = this.escapeString(`for ${forNode.childForFieldName('left')!.text} in ${forNode.childForFieldName('right')!.text}`);
    const headerId = this.generateNodeId("for_header");
    nodes.push({ id: headerId, label: headerText, shape: "diamond", style: this.nodeStyles.decision });
    this.locationMap.push({ start: forNode.startIndex, end: forNode.endIndex, nodeId: headerId });

    const elseClause = forNode.childForFieldName("alternative");
    
    // The final exit point for the whole construct. 'break' statements will target this.
    const finalExitId = this.generateNodeId("for_final_exit");
    nodes.push({ id: finalExitId, label: " ", shape: "stadium", style: "width:0;height:0;" });

    // The point where the loop terminates naturally. This leads to the 'else' block if it exists.
    const naturalExitId = elseClause ? this.generateNodeId("for_natural_exit") : finalExitId;
    if (elseClause) {
        nodes.push({ id: naturalExitId, label: " ", shape: "stadium", style: "width:0;height:0;" });
    }

    const loopContext: LoopContext = {
      breakTargetId: finalExitId, // 'break' must skip the 'else' block.
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

    bodyResult.exitPoints.forEach((ep) => {
      edges.push({ from: ep.id, to: headerId });
    });

    // The natural "End Loop" path goes to the natural exit node.
    edges.push({ from: headerId, to: naturalExitId, label: "End Loop" });

    if (elseClause) {
      const elseResult = this.processBlock(elseClause.childForFieldName("body"), exitId, loopContext);
      nodes.push(...elseResult.nodes);
      edges.push(...elseResult.edges);
      elseResult.nodesConnectedToExit.forEach((n) => nodesConnectedToExit.add(n));
      
      // Connect natural exit to the 'else' block's entry.
      if (elseResult.entryNodeId) {
        edges.push({ from: naturalExitId, to: elseResult.entryNodeId });
      } else { // If 'else' block is empty, natural exit goes straight to final exit.
        edges.push({ from: naturalExitId, to: finalExitId });
      }

      // Exits from the 'else' block go to the final exit point.
      elseResult.exitPoints.forEach(ep => {
        edges.push({ from: ep.id, to: finalExitId });
      });

      return { nodes, edges, entryNodeId: headerId, exitPoints: [{ id: finalExitId }], nodesConnectedToExit };
    }

    // No 'else' clause, so the natural exit is the final exit.
    return { nodes, edges, entryNodeId: headerId, exitPoints: [{ id: finalExitId }], nodesConnectedToExit };
  }


  /**
   * Processes a while loop.
   */
  private processWhileStatement(
    whileNode: any,
    exitId: string
  ): ProcessResult {
    const nodes: FlowchartNode[] = [];
    const edges: FlowchartEdge[] = [];
    const nodesConnectedToExit = new Set<string>();

    const conditionText = this.escapeString(whileNode.childForFieldName('condition')!.text);
    const conditionId = this.generateNodeId("while_cond");
    nodes.push({ id: conditionId, label: conditionText, shape: "diamond", style: this.nodeStyles.decision });
    this.locationMap.push({ start: whileNode.startIndex, end: whileNode.endIndex, nodeId: conditionId });
    
    const elseClause = whileNode.childForFieldName("alternative");
    
    // The final exit point for the whole construct. 'break' statements will target this.
    const finalExitId = this.generateNodeId("while_final_exit");
    nodes.push({ id: finalExitId, label: " ", shape: "stadium", style: "width:0;height:0;" });

    // The point where the loop terminates naturally. This leads to the 'else' block if it exists.
    const naturalExitId = elseClause ? this.generateNodeId("while_natural_exit") : finalExitId;
    if (elseClause) {
        nodes.push({ id: naturalExitId, label: " ", shape: "stadium", style: "width:0;height:0;" });
    }

    const loopContext: LoopContext = {
      breakTargetId: finalExitId, // 'break' must skip the 'else' block.
      continueTargetId: conditionId,
    };

    const body = whileNode.childForFieldName("body")!;
    const bodyResult = this.processBlock(body, exitId, loopContext);
    nodes.push(...bodyResult.nodes);
    edges.push(...bodyResult.edges);
    bodyResult.nodesConnectedToExit.forEach((n) => nodesConnectedToExit.add(n));

    if (bodyResult.entryNodeId) {
      edges.push({ from: conditionId, to: bodyResult.entryNodeId, label: "True" });
    } else {
      edges.push({ from: conditionId, to: conditionId, label: "True" });
    }

    bodyResult.exitPoints.forEach((ep) => {
      edges.push({ from: ep.id, to: conditionId });
    });

    // The natural "False" path goes to the natural exit node.
    edges.push({ from: conditionId, to: naturalExitId, label: "False" });
    
    if (elseClause) {
      const elseResult = this.processBlock(elseClause.childForFieldName("body"), exitId, loopContext);
      nodes.push(...elseResult.nodes);
      edges.push(...elseResult.edges);
      elseResult.nodesConnectedToExit.forEach((n) => nodesConnectedToExit.add(n));
      
      // Connect natural exit to the 'else' block's entry.
      if(elseResult.entryNodeId) {
          edges.push({ from: naturalExitId, to: elseResult.entryNodeId });
      } else { // If 'else' block is empty, natural exit goes straight to final exit.
          edges.push({ from: naturalExitId, to: finalExitId });
      }

      // Exits from the 'else' block go to the final exit point.
      elseResult.exitPoints.forEach(ep => {
        edges.push({ from: ep.id, to: finalExitId });
      });

      return { nodes, edges, entryNodeId: conditionId, exitPoints: [{ id: finalExitId }], nodesConnectedToExit };
    }
    
    // No 'else' clause, so the natural exit is the final exit.
    return { nodes, edges, entryNodeId: conditionId, exitPoints: [{ id: finalExitId }], nodesConnectedToExit };
  }

  /**
   * Processes a `with` statement.
   */
  private processWithStatement(
    withNode: any,
    exitId: string,
    loopContext?: LoopContext
  ): ProcessResult {
    const nodes: FlowchartNode[] = [];
    const edges: FlowchartEdge[] = [];
    
    // The `with_clause` node contains the item(s) being managed.
    const withClauseNode = withNode.children.find((c: any) => c.type === 'with_clause');
    const withClauseText = this.escapeString(withClauseNode?.text || "...");

    const withEntryId = this.generateNodeId("with_entry");
    nodes.push({ id: withEntryId, label: `with ${withClauseText}`, shape: "rect", style: this.nodeStyles.special });
    this.locationMap.push({ start: withNode.startIndex, end: withNode.endIndex, nodeId: withEntryId });

    const body = withNode.childForFieldName("body")!;
    const bodyResult = this.processBlock(body, exitId, loopContext);
    
    nodes.push(...bodyResult.nodes);
    edges.push(...bodyResult.edges);

    if (bodyResult.entryNodeId) {
        edges.push({ from: withEntryId, to: bodyResult.entryNodeId });
    }

    // If body was empty, the exit point is the with-node itself
    const exitPoints = bodyResult.exitPoints.length > 0 ? bodyResult.exitPoints : [{ id: withEntryId }];

    return {
        nodes,
        edges,
        entryNodeId: withEntryId,
        exitPoints: exitPoints,
        nodesConnectedToExit: bodyResult.nodesConnectedToExit,
    };
  }

  /**
   * Processes a try-except-else-finally statement.
   */
  private processTryStatement(
    tryNode: any,
    exitId: string,
    loopContext?: LoopContext
  ): ProcessResult {
    const nodes: FlowchartNode[] = [];
    const edges: FlowchartEdge[] = [];
    const nodesConnectedToExit = new Set<string>();

    const entryNodeId = this.generateNodeId("try_entry");
    nodes.push({ id: entryNodeId, label: "Try", shape: "stadium", style: this.nodeStyles.special });
    this.locationMap.push({ start: tryNode.startIndex, end: tryNode.endIndex, nodeId: entryNodeId });

    let lastExitPoints: { id: string; label?: string }[] = [];

    const tryBody = tryNode.childForFieldName("body")!;
    const tryResult = this.processBlock(tryBody, exitId, loopContext);
    nodes.push(...tryResult.nodes);
    edges.push(...tryResult.edges);
    tryResult.nodesConnectedToExit.forEach((n) => nodesConnectedToExit.add(n));
    if (tryResult.entryNodeId) {
      edges.push({ from: entryNodeId, to: tryResult.entryNodeId });
    }
    
    let successfulTryExits = tryResult.exitPoints;

    // Process except clauses
    const exceptClauses = tryNode.children.filter((c: any) => c.type === "except_clause");
    for (const clause of exceptClauses) {
      const exceptBody = clause.childForFieldName("body")!;
      const exceptResult = this.processBlock(exceptBody, exitId, loopContext);
      nodes.push(...exceptResult.nodes);
      edges.push(...exceptResult.edges);
      exceptResult.nodesConnectedToExit.forEach((n) => nodesConnectedToExit.add(n));

      if (exceptResult.entryNodeId) {
        // Find exception type, which is the first named child that isn't the body block
        const typeNode = clause.namedChildren.find((c: any) => c.type !== 'block');
        const exceptionType = this.escapeString(typeNode?.text || 'except');
        edges.push({ from: entryNodeId, to: exceptResult.entryNodeId, label: exceptionType });
      }
      lastExitPoints.push(...exceptResult.exitPoints);
    }

    const elseClause = tryNode.childForFieldName('else_clause');
    if (elseClause) {
        const elseBody = elseClause.childForFieldName('body') || elseClause.namedChildren.find((c: any) => c.type === 'block');
        if (elseBody) {
            const elseResult = this.processBlock(elseBody, exitId, loopContext);
            nodes.push(...elseResult.nodes);
            edges.push(...elseResult.edges);
            elseResult.nodesConnectedToExit.forEach(n => nodesConnectedToExit.add(n));

            if (elseResult.entryNodeId) {
                successfulTryExits.forEach(ep => {
                    if (!nodesConnectedToExit.has(ep.id)) {
                        edges.push({ from: ep.id, to: elseResult.entryNodeId! });
                    }
                });
            }
            lastExitPoints.push(...elseResult.exitPoints);
        }
    } else {
        lastExitPoints.push(...successfulTryExits);
    }

    const finallyClause = tryNode.childForFieldName("finally_clause");
    if (finallyClause) {
      const finallyBody = finallyClause.childForFieldName('body') || finallyClause.namedChildren.find((c: any) => c.type === 'block');
      if (finallyBody) {
        const finallyResult = this.processBlock(finallyBody, exitId, loopContext);
        nodes.push(...finallyResult.nodes);
        edges.push(...finallyResult.edges);
        finallyResult.nodesConnectedToExit.forEach((n) => nodesConnectedToExit.add(n));

        if (finallyResult.entryNodeId) {
          lastExitPoints.forEach((ep) => {
            if (!nodesConnectedToExit.has(ep.id)) {
              edges.push({ from: ep.id, to: finallyResult.entryNodeId! });
            }
          });
          // After finally, the new exit points are the exits from the finally block
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

  private processReturnStatement(
    returnNode: any,
    exitId: string
  ): ProcessResult {
    const nodeId = this.generateNodeId("return_stmt");

    // Grab the return expression (if any) so we can display it in the label.
    const argNode = returnNode.childForFieldName("argument");
    const argText = argNode ? this.escapeString(argNode.text) : "";
    const nodeText = argText ? `return ${argText}` : "return";

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
      start: returnNode.startIndex,
      end: returnNode.endIndex,
      nodeId,
    });

    return {
      nodes,
      edges,
      entryNodeId: nodeId,
      exitPoints: [], // Return terminates the current execution path.
      nodesConnectedToExit: new Set<string>().add(nodeId),
    };
  }

  private processBreakStatement(
    breakNode: any,
    loopContext: LoopContext
  ): ProcessResult {
    const nodeId = this.generateNodeId("break_stmt");
    const nodes: FlowchartNode[] = [
      { id: nodeId, label: "break", shape: "stadium", style: this.nodeStyles.break },
    ];
    const edges: FlowchartEdge[] = [
      { from: nodeId, to: loopContext.breakTargetId },
    ];
    this.locationMap.push({ start: breakNode.startIndex, end: breakNode.endIndex, nodeId });

    return {
      nodes,
      edges,
      entryNodeId: nodeId,
      exitPoints: [],
      nodesConnectedToExit: new Set<string>().add(nodeId),
    };
  }

  private processContinueStatement(
    continueNode: any,
    loopContext: LoopContext
  ): ProcessResult {
    const nodeId = this.generateNodeId("continue_stmt");
    const nodes: FlowchartNode[] = [
      { id: nodeId, label: "continue", shape: "stadium", style: this.nodeStyles.break },
    ];
    const edges: FlowchartEdge[] = [
      { from: nodeId, to: loopContext.continueTargetId },
    ];
    this.locationMap.push({ start: continueNode.startIndex, end: continueNode.endIndex, nodeId });

    return {
      nodes,
      edges,
      entryNodeId: nodeId,
      exitPoints: [],
      nodesConnectedToExit: new Set<string>().add(nodeId),
    };
  }
}



const sourceCode = `
async def full_feature_test(data_list, config_path):
    print("Function execution started.")
    processed_items = []

    # Test a 'with' statement
    with open(config_path, 'r') as f:
        config = f.read()
        print("Config loaded successfully.")

    # Test a 'for' loop with complex branching
    for item in data_list:
        if item is None:
            # Test a 'pass' statement in a simple block
            pass
            # Test 'continue'
            continue
        elif item < 0:
            print("Negative item found, breaking loop.")
            # Test 'break'
            break
        else:
            # Test 'try/except/else/finally'
            try:
                # Test an 'await' call
                result = await asyncio.sleep(0, item / 10)
                if result > 5:
                    print("Result is large.")
                else:
                    print("Result is small.")
            except TypeError:
                print("A TypeError occurred.")
            except ValueError as e:
                print(f"A ValueError occurred: {e}")
            else:
                # Test the 'else' block of a 'try' statement
                print("Try block completed without exceptions.")
                processed_items.append(result)
            finally:
                # Test the 'finally' block
                print("Finished processing one item.")
    else:
        # Test the 'else' block of a 'for' loop
        print("For loop completed without a break.")

    # Test a simple 'while' loop
    count = 3
    while count > 0:
        print(f"Countdown: {count}")
        count -= 1
        if count == 1:
            # This break will prevent the while-loop's else from running
            break
    else:
        print("This should not be printed.")

    return processed_items

`
// Test driver code
const parser = new PyAstParser();
const ir = parser.generateFlowchart(sourceCode);
console.log(ir);

// Mermaid code from ir
function irToMermaid(ir: FlowchartIR): string {
  const nodeLines = ir.nodes.map((n) => {
    const label = n.label.replace(/"/g, '\\"');
    switch (n.shape) {
      case "round":
        return `${n.id}("${label}")`;
      case "stadium":
        return `${n.id}([${label}])`;
      case "diamond":
        return `${n.id}{"${label}"}`;
      case "rect":
      default:
        return `${n.id}["${label}"]`;
    }
  });

  const edgeLines = ir.edges.map(
    (e) => `${e.from} -->${e.label ? `|${e.label}|` : ""} ${e.to}`
  );

  const styleLines = ir.nodes
    .filter((n) => n.style)
    .map((n) => `style ${n.id} ${n.style}`);

  return ["flowchart TD", ...nodeLines, ...edgeLines, ...styleLines].join(
    "\n"
  );
}

// Example usage:
const mermaid = irToMermaid(ir);
console.log(mermaid);