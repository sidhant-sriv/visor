import Parser from "web-tree-sitter";
import { AbstractParser } from "../../common/AbstractParser";
import {
  FlowchartIR,
  FlowchartNode,
  FlowchartEdge,
  NodeType,
  Location,
} from "../../../ir/ir";
import { ProcessResult, LoopContext } from "../../common/AstParserTypes";
import { ensureParserInit } from "../common/ParserInit";

export class RustAstParser extends AbstractParser {
  private currentFunctionIsClosure = false;

  private constructor(parser: Parser) {
    super(parser, "rust");
  }

  /**
   * Asynchronously creates and initializes an instance of RustAstParser.
   * This is the required entry point for creating a parser instance.
   * @param wasmPath The file path to the tree-sitter-rust.wasm file.
   * @returns A promise that resolves to a new RustAstParser instance.
   */
  public static async create(wasmPath: string): Promise<RustAstParser> {
    await ensureParserInit();
    const language = await Parser.Language.load(wasmPath);
    const parser = new Parser();
    parser.setLanguage(language);
    return new RustAstParser(parser);
  }

  public listFunctions(sourceCode: string): string[] {
    return this.measurePerformance("listFunctions", () => {
      const tree = this.parser.parse(sourceCode);

      // Get function definitions
      const funcNames = tree.rootNode
        .descendantsOfType("function_item")
        .map((f: Parser.SyntaxNode) => {
          const nameField = f.childForFieldName("name");
          return nameField?.text || "[anonymous]";
        });

      // Get closure expressions assigned to variables
      const closureNames = tree.rootNode
        .descendantsOfType("let_declaration")
        .filter((v) => {
          const value = v.childForFieldName("value");
          return value?.type === "closure_expression";
        })
        .map((v) => {
          const pattern = v.childForFieldName("pattern");
          return pattern?.text || "[anonymous closure]";
        });
      
      // Get method names from impl blocks
      const methodNames = tree.rootNode
        .descendantsOfType("impl_item")
        .flatMap((impl) => {
          return impl.descendantsOfType("function_item").map((f) => {
            const nameField = f.childForFieldName("name");
            return nameField?.text || "[anonymous method]";
          });
        });

      return [...funcNames, ...closureNames, ...methodNames];
    });
  }

  public findFunctionAtPosition(
    sourceCode: string,
    position: number
  ): string | undefined {
    const tree = this.parser.parse(sourceCode);

    // Check impl blocks first
    const impl = tree.rootNode
      .descendantsOfType("impl_item")
      .find((i) => position >= i.startIndex && position <= i.endIndex);
    if (impl) {
        const method = impl.descendantsOfType("function_item").find(f => position >= f.startIndex && position <= f.endIndex);
        if (method) {
            const nameField = method.childForFieldName("name");
            return nameField?.text || "[anonymous method]";
        }
    }

    // Check standalone function definitions
    let func = tree.rootNode
      .descendantsOfType("function_item")
      .find((f) => position >= f.startIndex && position <= f.endIndex);
    if (func) {
      const nameField = func.childForFieldName("name");
      return nameField?.text || "[anonymous]";
    }

    // Check closure expressions
    const closure = tree.rootNode
      .descendantsOfType("let_declaration")
      .find((v) => {
        const value = v.childForFieldName("value");
        return (
          position >= v.startIndex &&
          position <= v.endIndex &&
          value?.type === "closure_expression"
        );
      });
    if (closure) {
      const pattern = closure.childForFieldName("pattern");
      return pattern?.text || "[anonymous closure]";
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
    let isClosure = false;

    if (position !== undefined) {
      // Find impl_item at position first
      targetNode = tree.rootNode
        .descendantsOfType("impl_item")
        .find((f) => position >= f.startIndex && position <= f.endIndex);
      
      if (!targetNode) {
        // Fallback to existing function/closure search
        targetNode = tree.rootNode
          .descendantsOfType("function_item")
          .find((f) => position >= f.startIndex && position <= f.endIndex);

        if (!targetNode) {
          targetNode = tree.rootNode
            .descendantsOfType("let_declaration")
            .find((v) => {
              const value = v.childForFieldName("value");
              return (
                position >= v.startIndex &&
                position <= v.endIndex &&
                value?.type === "closure_expression"
              );
            });
          isClosure = !!targetNode;
        }
      }
    } else if (functionName) {
      // Find impl_item containing the function name
      targetNode = tree.rootNode
        .descendantsOfType("impl_item")
        .find((impl) => {
          return impl.descendantsOfType("function_item").some((f) => {
            const nameField = f.childForFieldName("name");
            return nameField?.text === functionName;
          });
        });
      
      if (!targetNode) {
        // Fallback to existing function/closure search
        targetNode = tree.rootNode
          .descendantsOfType("function_item")
          .find((f) => {
            const nameField = f.childForFieldName("name");
            return nameField?.text === functionName;
          });

        if (!targetNode) {
          targetNode = tree.rootNode
            .descendantsOfType("let_declaration")
            .find((v) => {
              const pattern = v.childForFieldName("pattern");
              const value = v.childForFieldName("value");
              return (
                pattern?.text === functionName &&
                value?.type === "closure_expression"
              );
            });
          isClosure = !!targetNode;
        }
      }
    } else {
      // Get first function, impl, or closure
      targetNode =
        tree.rootNode.descendantsOfType("function_item")[0] ||
        tree.rootNode.descendantsOfType("impl_item")[0] ||
        tree.rootNode
          .descendantsOfType("let_declaration")
          .find(
            (v) => v.childForFieldName("value")?.type === "closure_expression"
          );

      if (targetNode?.type === "let_declaration") {
        isClosure = true;
      }
    }
    
    // Handle impl_item specifically
    if (targetNode?.type === "impl_item") {
      // If a specific function name was provided, find that function within the impl block
      if (functionName) {
        const methodNode = targetNode.descendantsOfType("function_item").find(f => {
          const nameField = f.childForFieldName("name");
          return nameField?.text === functionName;
        });
        if (methodNode) {
          targetNode = methodNode;
          isClosure = false;
        } else {
           // If the function is not found inside, flowchart the whole impl block
           return this.processImplItem(targetNode);
        }
      } else {
        // If cursor is inside an impl but not a specific method, or no name is given, flowchart the whole block
        return this.processImplItem(targetNode);
      }
    }


    if (!targetNode) {
      return {
        nodes: [
          this.createSemanticNode(
            "A",
            "Place cursor inside a function or impl block to generate a flowchart.",
            NodeType.PROCESS
          ),
        ],
        edges: [],
        locationMap: [],
      };
    }

    this.currentFunctionIsClosure = isClosure;

    let bodyNode: Parser.SyntaxNode | null = null;
    let funcNameStr: string;

    if (isClosure) {
      const value = targetNode.childForFieldName("value");
      bodyNode = value?.childForFieldName("body") || null;
      const pattern = targetNode.childForFieldName("pattern");
      funcNameStr = this.escapeString(pattern?.text || "[anonymous closure]");
    } else {
      bodyNode = targetNode.childForFieldName("body");
      const nameField = targetNode.childForFieldName("name");
      funcNameStr = this.escapeString(nameField?.text || "[anonymous]");
    }

    const title = `Flowchart for ${
      isClosure ? "closure" : "function"
    }: ${funcNameStr}`;

    if (!bodyNode) {
      return {
        nodes: [
          this.createSemanticNode(
            "A",
            `Function ${funcNameStr} has no body.`,
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

    nodes.push(
      this.createSemanticNode(entryId, "Start", NodeType.ENTRY, targetNode)
    );
    nodes.push(
      this.createSemanticNode(exitId, "End", NodeType.EXIT, targetNode)
    );

    const bodyResult = this.processBlock(bodyNode, exitId);

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
    
    this.addFunctionComplexity(ir, targetNode);

    return ir;
  }

  private processImplItem(implNode: Parser.SyntaxNode): FlowchartIR {
    const titleNode = implNode.childForFieldName("type");
    const title = titleNode ? `impl ${titleNode.text}` : "impl block";

    const nodes: FlowchartNode[] = [];
    const edges: FlowchartEdge[] = [];
    const entryId = this.generateNodeId("start");
    const exitId = this.generateNodeId("end");

    nodes.push(
        this.createSemanticNode(entryId, "Start", NodeType.ENTRY, implNode)
    );
    
    let lastExitPoints: { id: string; label?: string }[] = [{ id: entryId }];
    const methods = implNode.descendantsOfType("function_item");

    if (methods.length > 0) {
        for (const method of methods) {
            // Process the function to get its graph components, without Start/End nodes.
            const methodResult = this.processFunctionNode(method);
            
            nodes.push(...methodResult.nodes);
            edges.push(...methodResult.edges);
            
            // Connect the exit points of the previous block to the entry of this method.
            if (methodResult.entryNodeId) {
                for (const lastExit of lastExitPoints) {
                    edges.push({ from: lastExit.id, to: methodResult.entryNodeId, label: lastExit.label });
                }
            }
            
            // The new exit points are the exit points of the method we just processed.
            // If a method has no exit points (e.g., it panics), the flow stops.
            lastExitPoints = methodResult.exitPoints;
        }
    }
    
    // Connect the final exit points to the main End node.
    nodes.push(
        this.createSemanticNode(exitId, "End", NodeType.EXIT, implNode)
    );
    for (const lastExit of lastExitPoints) {
        edges.push({ from: lastExit.id, to: exitId, label: lastExit.label });
    }

    return {
        nodes,
        edges,
        locationMap: this.locationMap,
        functionRange: { start: implNode.startIndex, end: implNode.endIndex },
        title,
        entryNodeId: entryId,
        exitNodeId: exitId,
    };
  }

  /**
   * Processes a function node and returns its complete flowchart, but without Start/End nodes.
   */
  private processFunctionNode(funcNode: Parser.SyntaxNode): ProcessResult {
      const bodyNode = funcNode.childForFieldName("body");
      const nameField = funcNode.childForFieldName("name");
      const funcName = nameField?.text || "anonymous";
      
      const nodes: FlowchartNode[] = [];
      const edges: FlowchartEdge[] = [];
      
      // Create function header node, which serves as the entry for this subgraph.
      const headerId = this.generateNodeId("func_header");
      nodes.push(
          this.createSemanticNode(
              headerId,
              funcName,
              NodeType.SUBROUTINE,
              funcNode
          )
      );

      // This is a placeholder target for any 'return' statements within the function body.
      // It allows us to identify the nodes that lead to an exit. It is not added to the graph.
      const internalExitTargetId = this.generateNodeId("func_internal_exit");
      
      if (bodyNode) {
          const bodyResult = this.processBlock(bodyNode, internalExitTargetId);
          nodes.push(...bodyResult.nodes);
          
          // Identify nodes that connect to the internal exit (i.e., return statements)
          const returnExitPoints = bodyResult.edges
              .filter(e => e.to === internalExitTargetId)
              .map(e => ({ id: e.from, label: e.label }));

          // Add edges from the body, excluding those that point to the internal exit.
          edges.push(...bodyResult.edges.filter(e => e.to !== internalExitTargetId));
          
          // Connect the header to the entry point of the function's body.
          if (bodyResult.entryNodeId) {
              edges.push({ from: headerId, to: bodyResult.entryNodeId });
          }
          
          // The exit points for this function are a combination of natural "fall-through" exits
          // from the block and explicit "return" exits.
          const allExitPoints = [...bodyResult.exitPoints, ...returnExitPoints];

          return {
              nodes,
              edges,
              entryNodeId: headerId,
              // If there are no specific exit points, it means the entire body is the flow,
              // so the last node of the body (or the header if the body is empty) is the exit.
              // However, `processBlock` should always return exit points. If it's empty,
              // it means the block never terminates.
              exitPoints: allExitPoints,
              nodesConnectedToExit: new Set(), // This is handled by the caller (`processImplItem`)
          };
      } else {
          // If there's no body, the header is both the entry and exit point.
          return {
              nodes,
              edges,
              entryNodeId: headerId,
              exitPoints: [{ id: headerId }],
              nodesConnectedToExit: new Set()
          };
      }
  }

  protected processBlock(
    blockNode: Parser.SyntaxNode,
    exitId: string,
    loopContext?: LoopContext
  ): ProcessResult {
    if (!blockNode) {
      return this.createProcessResult();
    }
    
    const statements = blockNode.namedChildren.filter(
      (s) =>
        ![
          "line_comment",
          "block_comment",
          "empty_statement",
          "use_declaration",
          "type_item",
          "struct_item",
          "enum_item",
          "impl_item",
          "trait_item",
          "mod_item",
          "const_item",
          "static_item",
          "macro_definition",
          "attribute_item",
        ].includes(s.type)
    );

    if (statements.length === 0) {
      return this.createProcessResult();
    }

    const nodes: FlowchartNode[] = [];
    const edges: FlowchartEdge[] = [];
    const nodesConnectedToExit = new Set<string>();
    let entryNodeId: string | undefined;
    let lastExitPoints: { id: string; label?: string }[] = [];

    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      const isLastStatement = i === statements.length - 1;

      let result: ProcessResult;
      if (isLastStatement && this.isImplicitReturn(statement, blockNode)) {
        result = this.processImplicitReturn(statement, exitId, loopContext);
      } else {
        result = this.processStatement(statement, exitId, loopContext);
      }

      nodes.push(...result.nodes);
      edges.push(...result.edges);
      result.nodesConnectedToExit.forEach((n) => nodesConnectedToExit.add(n));

      if (!entryNodeId) entryNodeId = result.entryNodeId;
      if (lastExitPoints.length > 0 && result.entryNodeId) {
        for (const exitPoint of lastExitPoints) {
          edges.push({
            from: exitPoint.id,
            to: result.entryNodeId,
            label: exitPoint.label,
          });
        }
      }
      lastExitPoints = result.exitPoints;
    }

    return this.createProcessResult(
      nodes,
      edges,
      entryNodeId,
      lastExitPoints,
      nodesConnectedToExit
    );
  }

  private isImplicitReturn(
    statement: Parser.SyntaxNode,
    blockNode: Parser.SyntaxNode
  ): boolean {
    if (statement.type === "expression_statement") {
      return false; 
    }

    const returnableExpressions = [
      "if_expression",
      "match_expression",
      "call_expression",
      "method_call_expression",
      "binary_expression",
      "identifier",
      "literal",
      "field_expression",
      "index_expression",
      "try_expression",
      "await_expression",
      "block",
    ];

    return returnableExpressions.includes(statement.type);
  }

  private processImplicitReturn(
    statement: Parser.SyntaxNode,
    exitId: string,
    loopContext?: LoopContext
  ): ProcessResult {
    const exprResult = this.processStatement(statement, exitId, loopContext);

    if (exprResult.exitPoints.length > 0) {
      const edges = [...exprResult.edges];
      const nodesConnectedToExit = new Set(exprResult.nodesConnectedToExit);

      exprResult.exitPoints.forEach((ep) => {
        if (!exprResult.nodesConnectedToExit.has(ep.id)) {
          edges.push({ from: ep.id, to: exitId, label: ep.label || "return" });
          nodesConnectedToExit.add(ep.id);
        }
      });

      return this.createProcessResult(
        exprResult.nodes,
        edges,
        exprResult.entryNodeId,
        [],
        nodesConnectedToExit
      );
    }

    return exprResult;
  }

  protected processStatement(
    statement: Parser.SyntaxNode,
    exitId: string,
    loopContext?: LoopContext
  ): ProcessResult {
    if (
      [
        "line_comment",
        "block_comment",
        "empty_statement",
        "use_declaration",
        "type_item",
        "struct_item",
        "enum_item",
        "impl_item",
        "trait_item",
        "mod_item",
        "const_item",
        "static_item",
        "macro_definition",
        "attribute_item",
      ].includes(statement.type)
    ) {
      return this.createProcessResult();
    }

    switch (statement.type) {
      case "let_declaration":
        return this.processLetDeclaration(statement, exitId);
      case "expression_statement":
        return this.processExpressionStatement(statement, exitId, loopContext);
      case "if_expression":
        return this.processIfExpression(statement, exitId, loopContext);
      case "match_expression":
        return this.processMatchExpression(statement, exitId, loopContext);
      case "while_expression":
        return this.processWhileExpression(statement, exitId, loopContext);
      case "loop_expression":
        return this.processLoopExpression(statement, exitId, loopContext);
      case "for_expression":
        return this.processForExpression(statement, exitId, loopContext);
      case "break_expression":
        return this.processBreakExpression(statement, exitId, loopContext);
      case "continue_expression":
        return this.processContinueExpression(statement, exitId, loopContext);
      case "return_expression":
        return this.processReturnExpression(statement, exitId);
      case "assignment_expression":
        return this.processAssignmentExpression(statement, exitId);
      case "call_expression":
        return this.processCallExpression(statement, exitId);
      case "method_call_expression": // This case now delegates to the chained method processor
        return this.processChainedMethodCalls(statement, exitId);
      case "macro_invocation":
        return this.processMacroInvocation(statement, exitId);
      case "try_expression":
        return this.processTryExpression(statement, exitId);
      case "await_expression":
        return this.processAwaitExpression(statement, exitId);
      case "block":
        return this.processBlock(statement, exitId, loopContext);
      default:
        return this.processGenericStatement(statement, exitId);
    }
  }

  private processGenericStatement(
    node: Parser.SyntaxNode,
    exitId: string
  ): ProcessResult {
    const stmtId = this.generateNodeId("stmt");
    const stmtNode = this.createSemanticNode(
      stmtId,
      this.truncateText(node.text),
      NodeType.PROCESS,
      node
    );

    this.locationMap.push({
      start: node.startIndex,
      end: node.endIndex,
      nodeId: stmtId,
    });

    return this.createProcessResult(
      [stmtNode],
      [],
      stmtId,
      [{ id: stmtId }],
      new Set()
    );
  }

  /**
   * UPDATED: Handles method call chains by calling the new processChainedMethodCalls function.
   */
  private processExpressionStatement(
    node: Parser.SyntaxNode,
    exitId: string,
    loopContext?: LoopContext
  ): ProcessResult {
    const expr = node.namedChild(0);
    if (expr) {
      // Handle method call chains with the new processor
      if (expr.type === "method_call_expression") {
        return this.processChainedMethodCalls(expr, exitId);
      }
  
      // Existing processing logic for other expression types
      if (
        [
          "if_expression",
          "match_expression",
          "while_expression",
          "loop_expression",
          "for_expression",
          "break_expression",
          "continue_expression",
          "return_expression",
          "try_expression",
          "await_expression",
          "call_expression",
          "macro_invocation",
        ].includes(expr.type)
      ) {
        return this.processStatement(expr, exitId, loopContext);
      }
      
      const stmtId = this.generateNodeId("stmt");
      const stmtNode = this.createSemanticNode(
        stmtId,
        this.truncateText(expr.text),
        this.getNodeTypeForExpression(expr.type),
        expr
      );
  
      return this.createProcessResult(
        [stmtNode],
        [],
        stmtId,
        [{ id: stmtId }],
        new Set<string>()
      );
    }
  
    return this.createProcessResult();
  }

  private getNodeTypeForExpression(exprType: string): NodeType {
    switch (exprType) {
      case "assignment_expression":
        return NodeType.ASSIGNMENT;
      case "call_expression":
        return NodeType.FUNCTION_CALL;
      case "method_call_expression":
        return NodeType.METHOD_CALL;
      case "macro_invocation":
        return NodeType.MACRO_CALL;
      case "try_expression":
        return NodeType.EARLY_RETURN_ERROR;
      case "await_expression":
        return NodeType.AWAIT;
      default:
        return NodeType.PROCESS;
    }
  }

  private processLetDeclaration(
    node: Parser.SyntaxNode,
    exitId: string
  ): ProcessResult {
    const pattern = node.childForFieldName("pattern");
    const value = node.childForFieldName("value");

    let label = "let ";
    if (pattern) {
      label += pattern.text;
    }

    if (!value) {
        const declId = this.generateNodeId("let");
        const declNode = this.createSemanticNode(declId, label, NodeType.ASSIGNMENT, node);
        this.locationMap.push({ start: node.startIndex, end: node.endIndex, nodeId: declId });
        return this.createProcessResult([declNode], [], declId, [{ id: declId }], new Set());
    }

    const isComplex = this.isComplexExpression(value) || 
                      ['method_call_expression', 'call_expression', 'await_expression', 'try_expression'].includes(value.type);

    if (isComplex) {
        const valueResult = this.processStatement(value, exitId);
        
        const declId = this.generateNodeId("let_assign");
        const declNode = this.createSemanticNode(
            declId,
            `${label} = <result>`,
            NodeType.ASSIGNMENT,
            node
        );

        const nodes = [...valueResult.nodes, declNode];
        const edges = [...valueResult.edges];
        const nodesConnectedToExit = new Set(valueResult.nodesConnectedToExit);

        valueResult.exitPoints.forEach(ep => {
            if (!nodesConnectedToExit.has(ep.id)) {
                edges.push({ from: ep.id, to: declId, label: ep.label });
            }
        });

        this.locationMap.push({ start: node.startIndex, end: node.endIndex, nodeId: declId });

        return this.createProcessResult(
            nodes,
            edges,
            valueResult.entryNodeId,
            [{ id: declId }],
            nodesConnectedToExit
        );
    } else {
      label += " = " + this.truncateText(value.text);
      const declId = this.generateNodeId("let");
      const declNode = this.createSemanticNode(declId, label, NodeType.ASSIGNMENT, node);
      this.locationMap.push({ start: node.startIndex, end: node.endIndex, nodeId: declId });
      return this.createProcessResult([declNode], [], declId, [{ id: declId }], new Set());
    }
  }

  private isComplexExpression(expr: Parser.SyntaxNode): boolean {
    return [
      "if_expression",
      "match_expression",
      "while_expression",
      "loop_expression",
      "for_expression",
      "block",
      "method_call_expression",
      "call_expression",
      "try_expression",
      "await_expression"
    ].includes(expr.type);
  }

  private processIfExpression(
    node: Parser.SyntaxNode,
    exitId: string,
    loopContext?: LoopContext
  ): ProcessResult {
    const condition = node.childForFieldName("condition");
    const consequence = node.childForFieldName("consequence");
    const alternative = node.childForFieldName("alternative");

    if (!condition) {
      return this.createProcessResult();
    }

    const conditionText = this.truncateText(condition.text);
    const conditionId = this.generateNodeId("if");
    const conditionNode = this.createSemanticNode(
      conditionId,
      `if ${conditionText}`,
      NodeType.DECISION,
      condition
    );

    const nodes: FlowchartNode[] = [conditionNode];
    const edges: FlowchartEdge[] = [];
    const exitPoints: { id: string; label?: string }[] = [];
    const nodesConnectedToExit = new Set<string>();

    this.locationMap.push({
      start: condition.startIndex,
      end: condition.endIndex,
      nodeId: conditionId,
    });

    if (consequence) {
      const thenResult = this.processStatementOrBlock(
        consequence,
        exitId,
        loopContext
      );
      nodes.push(...thenResult.nodes);
      edges.push(...thenResult.edges);

      if (thenResult.entryNodeId) {
        edges.push({
          from: conditionId,
          to: thenResult.entryNodeId,
          label: "true",
        });
      }
      exitPoints.push(...thenResult.exitPoints);
      thenResult.nodesConnectedToExit.forEach((id) =>
        nodesConnectedToExit.add(id)
      );
    } else {
      exitPoints.push({ id: conditionId, label: "true" });
    }

    if (alternative) {
      const elseBody = alternative.namedChild(0);

      if (elseBody) {
        const elseResult = this.processStatementOrBlock(
          elseBody,
          exitId,
          loopContext
        );
        nodes.push(...elseResult.nodes);
        edges.push(...elseResult.edges);

        if (elseResult.entryNodeId) {
          edges.push({
            from: conditionId,
            to: elseResult.entryNodeId,
            label: "false",
          });
        }
        exitPoints.push(...elseResult.exitPoints);
        elseResult.nodesConnectedToExit.forEach((id) =>
          nodesConnectedToExit.add(id)
        );
      }
    } else {
      exitPoints.push({ id: conditionId, label: "false" });
    }

    return this.createProcessResult(
      nodes,
      edges,
      conditionId,
      exitPoints,
      nodesConnectedToExit
    );
  }

  private processStatementOrBlock(
    statementOrBlock: Parser.SyntaxNode,
    exitId: string,
    loopContext?: LoopContext
  ): ProcessResult {
    if (statementOrBlock.type === "block") {
      return this.processBlock(statementOrBlock, exitId, loopContext);
    }
    
    return this.processStatement(statementOrBlock, exitId, loopContext);
  }

  private processMatchExpression(
    node: Parser.SyntaxNode,
    exitId: string,
    loopContext?: LoopContext
  ): ProcessResult {
    const value = node.childForFieldName("value");
    const body = node.childForFieldName("body");

    if (!value) {
      return this.createProcessResult();
    }

    const valueText = this.truncateText(value.text);
    const matchId = this.generateNodeId("match");
    const matchNode = this.createSemanticNode(
      matchId,
      `match ${valueText}`,
      NodeType.DECISION,
      value
    );

    const nodes: FlowchartNode[] = [matchNode];
    const edges: FlowchartEdge[] = [];
    const exitPoints: { id: string; label?: string }[] = [];
    const nodesConnectedToExit = new Set<string>();

    this.locationMap.push({
      start: value.startIndex,
      end: value.endIndex,
      nodeId: matchId,
    });

    if (body) {
      const arms = body.descendantsOfType("match_arm");
      arms.forEach((arm, index) => {
        const pattern = arm.childForFieldName("pattern");
        const guard = arm.childForFieldName("guard");
        const armValue = arm.childForFieldName("value");

        const patternText = pattern
          ? this.truncateText(pattern.text)
          : `arm_${index}`;

        let currentNodeId = matchId;
        let currentLabel = patternText;

        if (guard) {
          const guardCondition = guard.namedChild(0);
          if (guardCondition) {
            const guardId = this.generateNodeId("guard");
            const guardText = this.truncateText(guardCondition.text);
            const guardNode = this.createSemanticNode(
              guardId,
              `${patternText} if ${guardText}`,
              NodeType.DECISION,
              guard
            );

            nodes.push(guardNode);
            edges.push({
              from: matchId,
              to: guardId,
              label: patternText,
            });

            this.locationMap.push({
              start: guard.startIndex,
              end: guard.endIndex,
              nodeId: guardId,
            });

            currentNodeId = guardId;
            currentLabel = "true";
          }
        }

        if (armValue) {
          const armResult = this.processStatementOrBlock(
            armValue,
            exitId,
            loopContext
          );
          nodes.push(...armResult.nodes);
          edges.push(...armResult.edges);

          if (armResult.entryNodeId) {
            edges.push({
              from: currentNodeId,
              to: armResult.entryNodeId,
              label: currentLabel,
            });
          }
          exitPoints.push(...armResult.exitPoints);
          armResult.nodesConnectedToExit.forEach((id) =>
            nodesConnectedToExit.add(id)
          );
        } else {
          const armId = this.generateNodeId("arm");
          const armNode = this.createSemanticNode(
            armId,
            patternText,
            NodeType.PROCESS,
            arm
          );
          nodes.push(armNode);
          edges.push({ from: currentNodeId, to: armId, label: currentLabel });
          exitPoints.push({ id: armId });

          this.locationMap.push({
            start: arm.startIndex,
            end: arm.endIndex,
            nodeId: armId,
          });
        }
      });
    }

    return this.createProcessResult(
      nodes,
      edges,
      matchId,
      exitPoints,
      nodesConnectedToExit
    );
  }

  private processWhileExpression(
    node: Parser.SyntaxNode,
    exitId: string,
    loopContext?: LoopContext
  ): ProcessResult {
    const condition = node.childForFieldName("condition");
    const body = node.childForFieldName("body");

    if (!condition) {
      return this.createProcessResult();
    }

    const conditionText = this.truncateText(condition.text);
    const conditionId = this.generateNodeId("while");
    const conditionNode = this.createSemanticNode(
      conditionId,
      `while ${conditionText}`,
      NodeType.DECISION,
      condition
    );

    const nodes: FlowchartNode[] = [conditionNode];
    const edges: FlowchartEdge[] = [];
    const exitPoints: { id: string; label?: string }[] = [
      { id: conditionId, label: "false" },
    ];
    const nodesConnectedToExit = new Set<string>();

    this.locationMap.push({
      start: condition.startIndex,
      end: condition.endIndex,
      nodeId: conditionId,
    });

    if (body) {
      const newLoopContext: LoopContext = {
        breakTargetId: exitId,
        continueTargetId: conditionId,
      };

      const bodyResult = this.processStatementOrBlock(
        body,
        exitId,
        newLoopContext
      );
      nodes.push(...bodyResult.nodes);
      edges.push(...bodyResult.edges);

      if (bodyResult.entryNodeId) {
        edges.push({
          from: conditionId,
          to: bodyResult.entryNodeId,
          label: "true",
        });
      }

      bodyResult.exitPoints.forEach((ep) => {
        if (!bodyResult.nodesConnectedToExit.has(ep.id)) {
          edges.push({ from: ep.id, to: conditionId });
        }
      });

      bodyResult.nodesConnectedToExit.forEach((id) =>
        nodesConnectedToExit.add(id)
      );
    }

    return this.createProcessResult(
      nodes,
      edges,
      conditionId,
      exitPoints,
      nodesConnectedToExit
    );
  }

  private processLoopExpression(
    node: Parser.SyntaxNode,
    exitId: string,
    loopContext?: LoopContext
  ): ProcessResult {
    const body = node.childForFieldName("body");

    const loopId = this.generateNodeId("loop");
    const loopNode = this.createSemanticNode(
      loopId,
      "loop",
      NodeType.LOOP_START,
      node
    );

    const nodes: FlowchartNode[] = [loopNode];
    const edges: FlowchartEdge[] = [];
    const exitPoints: { id: string; label?: string }[] = [];
    const nodesConnectedToExit = new Set<string>();

    this.locationMap.push({
      start: node.startIndex,
      end: node.endIndex,
      nodeId: loopId,
    });

    if (body) {
      const newLoopContext: LoopContext = {
        breakTargetId: exitId,
        continueTargetId: loopId,
      };

      const bodyResult = this.processStatementOrBlock(
        body,
        exitId,
        newLoopContext
      );
      nodes.push(...bodyResult.nodes);
      edges.push(...bodyResult.edges);

      if (bodyResult.entryNodeId) {
        edges.push({ from: loopId, to: bodyResult.entryNodeId });
      }
      
      bodyResult.exitPoints.forEach((ep) => {
        if (!bodyResult.nodesConnectedToExit.has(ep.id)) {
          edges.push({ from: ep.id, to: loopId });
        }
      });

      bodyResult.nodesConnectedToExit.forEach((id) =>
        nodesConnectedToExit.add(id)
      );
    }

    return this.createProcessResult(
      nodes,
      edges,
      loopId,
      exitPoints,
      nodesConnectedToExit
    );
  }

  private processForExpression(
    node: Parser.SyntaxNode,
    exitId: string,
    loopContext?: LoopContext
  ): ProcessResult {
    const pattern = node.childForFieldName("pattern");
    const value = node.childForFieldName("value");
    const body = node.childForFieldName("body");

    const patternText = pattern ? pattern.text : "item";
    const valueText = value ? this.truncateText(value.text) : "iterable";

    const forId = this.generateNodeId("for");
    const forNode = this.createSemanticNode(
      forId,
      `for ${patternText} in ${valueText}`,
      NodeType.LOOP_START,
      node
    );

    const nodes: FlowchartNode[] = [forNode];
    const edges: FlowchartEdge[] = [];
    const exitPoints: { id: string; label?: string }[] = [
      { id: forId, label: "done" },
    ];
    const nodesConnectedToExit = new Set<string>();

    this.locationMap.push({
      start: node.startIndex,
      end: node.endIndex,
      nodeId: forId,
    });

    if (body) {
      const newLoopContext: LoopContext = {
        breakTargetId: exitId,
        continueTargetId: forId,
      };

      const bodyResult = this.processStatementOrBlock(
        body,
        exitId,
        newLoopContext
      );
      nodes.push(...bodyResult.nodes);
      edges.push(...bodyResult.edges);

      if (bodyResult.entryNodeId) {
        edges.push({ from: forId, to: bodyResult.entryNodeId });
      }
      
      bodyResult.exitPoints.forEach((ep) => {
        if (!bodyResult.nodesConnectedToExit.has(ep.id)) {
          edges.push({ from: ep.id, to: forId });
        }
      });

      bodyResult.nodesConnectedToExit.forEach((id) =>
        nodesConnectedToExit.add(id)
      );
    }

    return this.createProcessResult(
      nodes,
      edges,
      forId,
      exitPoints,
      nodesConnectedToExit
    );
  }

  private processBreakExpression(
    node: Parser.SyntaxNode,
    exitId: string,
    loopContext?: LoopContext
  ): ProcessResult {
    const breakId = this.generateNodeId("break");
    const breakNode = this.createSemanticNode(
      breakId,
      "break",
      NodeType.BREAK_CONTINUE,
      node
    );

    const nodesConnectedToExit = new Set<string>();
    const edges: FlowchartEdge[] = [];

    this.locationMap.push({
      start: node.startIndex,
      end: node.endIndex,
      nodeId: breakId,
    });

    if (loopContext) {
      edges.push({ from: breakId, to: loopContext.breakTargetId });
      nodesConnectedToExit.add(breakId);
    }

    return this.createProcessResult(
      [breakNode],
      edges,
      breakId,
      [],
      nodesConnectedToExit
    );
  }

  private processContinueExpression(
    node: Parser.SyntaxNode,
    exitId: string,
    loopContext?: LoopContext
  ): ProcessResult {
    const continueId = this.generateNodeId("continue");
    const continueNode = this.createSemanticNode(
      continueId,
      "continue",
      NodeType.BREAK_CONTINUE,
      node
    );

    const nodesConnectedToExit = new Set<string>();
    const edges: FlowchartEdge[] = [];

    this.locationMap.push({
      start: node.startIndex,
      end: node.endIndex,
      nodeId: continueId,
    });

    if (loopContext) {
      edges.push({ from: continueId, to: loopContext.continueTargetId });
      nodesConnectedToExit.add(continueId);
    }

    return this.createProcessResult(
      [continueNode],
      edges,
      continueId,
      [],
      nodesConnectedToExit
    );
  }

  private processReturnExpression(
    node: Parser.SyntaxNode,
    exitId: string
  ): ProcessResult {
    const value = node.namedChild(0);
    const label = value ? `return ${this.truncateText(value.text)}` : "return";

    const returnId = this.generateNodeId("return");
    const returnNode = this.createSemanticNode(
      returnId,
      label,
      NodeType.RETURN,
      node
    );

    const nodesConnectedToExit = new Set([returnId]);
    const edges: FlowchartEdge[] = [{ from: returnId, to: exitId }];

    this.locationMap.push({
      start: node.startIndex,
      end: node.endIndex,
      nodeId: returnId,
    });

    return this.createProcessResult(
      [returnNode],
      edges,
      returnId,
      [],
      nodesConnectedToExit
    );
  }

  private processAssignmentExpression(
    node: Parser.SyntaxNode,
    exitId: string
  ): ProcessResult {
    const left = node.childForFieldName("left");
    const right = node.childForFieldName("right");

    let label = "";
    if (left) {
      label += left.text;
    }
    label += " = ";
    if (right) {
      label += this.truncateText(right.text);
    }

    const assignId = this.generateNodeId("assign");
    const assignNode = this.createSemanticNode(
      assignId,
      label,
      NodeType.ASSIGNMENT,
      node
    );

    this.locationMap.push({
      start: node.startIndex,
      end: node.endIndex,
      nodeId: assignId,
    });

    return this.createProcessResult(
      [assignNode],
      [],
      assignId,
      [{ id: assignId }],
      new Set()
    );
  }

  private processCallExpression(
    node: Parser.SyntaxNode,
    exitId: string
  ): ProcessResult {
    const function_node = node.childForFieldName("function");
    const arguments_node = node.childForFieldName("arguments");

    let label = "";
    if (function_node) {
      label += function_node.text;
    }
    if (arguments_node) {
      label += arguments_node.text;
    }

    const callId = this.generateNodeId("call");
    const callNode = this.createSemanticNode(
      callId,
      this.truncateText(label),
      NodeType.FUNCTION_CALL,
      node
    );
    
    this.locationMap.push({
      start: node.startIndex,
      end: node.endIndex,
      nodeId: callId,
    });

    const closureNodes = this.findClosuresInArguments(arguments_node);
    const nodes: FlowchartNode[] = [callNode];
    const edges: FlowchartEdge[] = [];

    closureNodes.forEach((closure, index) => {
      const closureBody = closure.childForFieldName("body");
      if (closureBody) {
        const closureId = this.generateNodeId(`closure_${index}`);
        const closureHeaderNode = this.createSemanticNode(
          closureId,
          `closure ${index + 1}`,
          NodeType.FUNCTION_CALL,
          closure
        );
        nodes.push(closureHeaderNode);
        edges.push({ from: callId, to: closureId, label: `arg ${index + 1}` });

        const closureResult = this.processBlock(closureBody, exitId);
        nodes.push(...closureResult.nodes);
        edges.push(...closureResult.edges);

        if (closureResult.entryNodeId) {
          edges.push({ from: closureId, to: closureResult.entryNodeId });
        }
      }
    });

    return this.createProcessResult(
      nodes,
      edges,
      callId,
      [{ id: callId }],
      new Set<string>()
    );
  }

  /**
   * Processes a chain of method calls, like `s.trim().to_uppercase().count()`.
   *
   * This function breaks down the chain into a sequence of connected nodes.
   * - If the chain starts with a simple identifier (e.g., `s`), it's merged with the first
   * call to create a single node (e.g., `s.trim()`).
   * - If the chain starts with a complex expression (e.g., `get_string()`), that expression
   * is processed as a separate, preceding node.
   * - Each subsequent method call in the chain (`.to_uppercase()`, `.count()`, etc.) becomes
   * its own node, linked sequentially.
   * - Closures passed as arguments (e.g., in `.filter()`) are processed as sub-graphs.
   *
   * @param node The top-level `method_call_expression` node of the chain.
   * @param exitId The ID of the node to connect to for `return` or end-of-function.
   * @returns A `ProcessResult` containing the flowchart components for the chain.
   */
  private processChainedMethodCalls(
    node: Parser.SyntaxNode,
    exitId: string
  ): ProcessResult {
    const nodes: FlowchartNode[] = [];
    const edges: FlowchartEdge[] = [];
    const nodesConnectedToExit = new Set<string>();

    // 1. Build the chain of method calls in reverse order by traversing up the receivers.
    const chain: Parser.SyntaxNode[] = [];
    let currentNode: Parser.SyntaxNode | null = node;
    while (currentNode?.type === "method_call_expression") {
      chain.unshift(currentNode);
      currentNode = currentNode.childForFieldName("receiver");
    }
    const initialReceiver = currentNode;

    // This should not happen in valid Rust, but handle gracefully.
    if (!initialReceiver) {
        return this.processGenericStatement(node, exitId);
    }

    let entryNodeId: string | undefined;
    let previousNodeId: string | undefined;

    // If the initial receiver is a complex expression (e.g., another function call),
    // create a separate node for it first.
    if (this.isComplexExpression(initialReceiver)) {
        const receiverResult = this.processStatement(initialReceiver, exitId);
        nodes.push(...receiverResult.nodes);
        edges.push(...receiverResult.edges);
        receiverResult.nodesConnectedToExit.forEach((id) =>
            nodesConnectedToExit.add(id)
        );
        entryNodeId = receiverResult.entryNodeId;
        if (receiverResult.exitPoints.length > 0) {
            // For a chain, we assume a single flow.
            previousNodeId = receiverResult.exitPoints[0].id;
        }
    }

    // 2. Process each method call in the chain.
    for (const [index, callPart] of chain.entries()) {
      const method = callPart.childForFieldName("method");
      const args = callPart.childForFieldName("arguments");

      let label: string;
      // If the receiver was simple (e.g., an identifier), merge it with the first call.
      if (index === 0 && !previousNodeId) {
          label = `${initialReceiver.text}.${method?.text || "unknown"}${args?.text || "()"}`;
      } else {
          label = `.${method?.text || "unknown"}${args?.text || "()"}`;
      }

      const callId = this.generateNodeId("method_call");
      const callNode = this.createSemanticNode(
        callId,
        this.truncateText(label),
        NodeType.METHOD_CALL,
        callPart
      );
      nodes.push(callNode);

      // Create a location map entry. For the first merged node, span from receiver to method call.
      if (index === 0 && !previousNodeId) {
          this.locationMap.push({
            start: initialReceiver.startIndex,
            end: callPart.endIndex,
            nodeId: callId,
          });
      } else {
          this.locationMap.push({
            start: callPart.startIndex,
            end: callPart.endIndex,
            nodeId: callId,
          });
      }

      // Connect to the previous node in the chain.
      if (previousNodeId) {
        edges.push({ from: previousNodeId, to: callId });
      }

      // The first node we create is the entry point for the whole chain.
      if (!entryNodeId) {
        entryNodeId = callId;
      }
      previousNodeId = callId;

      // 3. Process any closures in the arguments of this specific method call.
      if (args) {
        const closures = this.findClosuresInArguments(args);
        closures.forEach((closure, i) => {
          const closureBody = closure.childForFieldName("body");
          if (closureBody) {
            const closureId = this.generateNodeId(`closure_${i}`);
            const closureHeaderNode = this.createSemanticNode(
              closureId,
              `closure ${i + 1}`,
              NodeType.FUNCTION_CALL,
              closure
            );
            nodes.push(closureHeaderNode);
            // The closure is an argument to the current method call.
            edges.push({ from: callId, to: closureId, label: `arg ${i + 1}` });

            const closureResult = this.processBlock(closureBody, exitId);
            nodes.push(...closureResult.nodes);
            edges.push(...closureResult.edges);

            if (closureResult.entryNodeId) {
              edges.push({ from: closureId, to: closureResult.entryNodeId });
            }
          }
        });
      }
    }

    return this.createProcessResult(
      nodes,
      edges,
      entryNodeId,
      previousNodeId ? [{ id: previousNodeId }] : [],
      nodesConnectedToExit
    );
  }

  private processMacroInvocation(
    node: Parser.SyntaxNode,
    exitId: string
  ): ProcessResult {
    const macro_name = node.childForFieldName("macro");
    const token_tree = node.childForFieldName("token_tree");

    const macroName = macro_name?.text || "unknown_macro";
    let label = macroName;
    if (token_tree) {
      label += token_tree.text;
    }

    if (macroName === "panic!") {
      const panicId = this.generateNodeId("panic");
      const panicNode = this.createSemanticNode(
        panicId,
        `panic!${token_tree?.text || "()"}`,
        NodeType.PANIC,
        node
      );

      this.locationMap.push({
        start: node.startIndex,
        end: node.endIndex,
        nodeId: panicId,
      });

      const edges: FlowchartEdge[] = [{ from: panicId, to: exitId }];
      const nodesConnectedToExit = new Set([panicId]);

      return this.createProcessResult(
        [panicNode],
        edges,
        panicId,
        [],
        nodesConnectedToExit
      );
    }

    const callId = this.generateNodeId("macro");
    const nodeType = [
      "println!",
      "print!",
      "eprintln!",
      "eprint!",
      "dbg!",
    ].includes(macroName)
      ? NodeType.FUNCTION_CALL
      : NodeType.MACRO_CALL;

    const callNode = this.createSemanticNode(
      callId,
      this.truncateText(label),
      nodeType,
      node
    );

    this.locationMap.push({
      start: node.startIndex,
      end: node.endIndex,
      nodeId: callId,
    });

    return this.createProcessResult(
      [callNode],
      [],
      callId,
      [{ id: callId }],
      new Set()
    );
  }

  private processTryExpression(
    node: Parser.SyntaxNode,
    exitId: string
  ): ProcessResult {
    const expr = node.namedChild(0);

    if (!expr) {
      return this.createProcessResult();
    }

    if (expr.type === "await_expression") {
      const innerExpr = expr.namedChild(0);
      if (!innerExpr) {
        return this.createProcessResult();
      }
      
      const awaitTryId = this.generateNodeId("await_try");
      const awaitTryNode = this.createSemanticNode(
        awaitTryId,
        `${this.truncateText(innerExpr.text)}.await?`,
        NodeType.AWAIT,
        node
      );

      this.locationMap.push({
        start: node.startIndex,
        end: node.endIndex,
        nodeId: awaitTryId,
      });
      
      const exitPoints: { id: string; label?: string }[] = [
        { id: awaitTryId, label: "Ok" },
      ];
      const nodesConnectedToExit = new Set<string>();
      
      const edges: FlowchartEdge[] = [
        { from: awaitTryId, to: exitId, label: "Err" },
      ];
      nodesConnectedToExit.add(awaitTryId);

      return this.createProcessResult(
        [awaitTryNode],
        edges,
        awaitTryId,
        exitPoints,
        nodesConnectedToExit
      );
    }

    if (this.shouldDecomposeExpression(expr)) {
      const exprResult = this.processComplexExpression(expr, exitId);

      const tryId = this.generateNodeId("try");
      const tryNode = this.createSemanticNode(
        tryId,
        `${this.truncateText(expr.text)}?`,
        NodeType.EARLY_RETURN_ERROR,
        node
      );

      const nodes: FlowchartNode[] = [...exprResult.nodes, tryNode];
      const edges: FlowchartEdge[] = [...exprResult.edges];
      const exitPoints: { id: string; label?: string }[] = [
        { id: tryId, label: "Ok" },
      ];
      const nodesConnectedToExit = new Set<string>();
      exprResult.nodesConnectedToExit.forEach((id) =>
        nodesConnectedToExit.add(id)
      );

      this.locationMap.push({
        start: node.startIndex,
        end: node.endIndex,
        nodeId: tryId,
      });

      if (exprResult.exitPoints.length > 0) {
        exprResult.exitPoints.forEach((ep: { id: string; label?: string }) => {
          if (!exprResult.nodesConnectedToExit.has(ep.id)) {
            edges.push({ from: ep.id, to: tryId, label: ep.label });
          }
        });
      } else if (exprResult.entryNodeId) {
        edges.push({ from: exprResult.entryNodeId, to: tryId });
      }

      edges.push({ from: tryId, to: exitId, label: "Err" });
      nodesConnectedToExit.add(tryId);

      return this.createProcessResult(
        nodes,
        edges,
        exprResult.entryNodeId || tryId,
        exitPoints,
        nodesConnectedToExit
      );
    } else {
      const tryId = this.generateNodeId("try");
      const tryNode = this.createSemanticNode(
        tryId,
        `${this.truncateText(expr.text)}?`,
        NodeType.EARLY_RETURN_ERROR,
        node
      );

      const exitPoints: { id: string; label?: string }[] = [
        { id: tryId, label: "Ok" },
      ];
      const nodesConnectedToExit = new Set<string>();
      
      this.locationMap.push({
        start: node.startIndex,
        end: node.endIndex,
        nodeId: tryId,
      });
      
      const edges: FlowchartEdge[] = [
        { from: tryId, to: exitId, label: "Err" },
      ];
      nodesConnectedToExit.add(tryId);

      return this.createProcessResult(
        [tryNode],
        edges,
        tryId,
        exitPoints,
        nodesConnectedToExit
      );
    }
  }

  private processComplexExpression(
    expr: Parser.SyntaxNode,
    exitId: string
  ): ProcessResult {
    if (
      [
        "call_expression",
        "method_call_expression",
        "await_expression",
        "try_expression",
        "if_expression",
        "match_expression",
        "macro_invocation",
      ].includes(expr.type)
    ) {
      return this.processStatement(expr, exitId);
    }
    
    if (
      [
        "identifier",
        "literal",
        "field_expression",
        "index_expression",
        "binary_expression",
        "unary_expression",
      ].includes(expr.type)
    ) {
      const exprId = this.generateNodeId("expr");
      const exprNode = this.createSemanticNode(
        exprId,
        this.truncateText(expr.text),
        NodeType.PROCESS,
        expr
      );

      this.locationMap.push({
        start: expr.startIndex,
        end: expr.endIndex,
        nodeId: exprId,
      });

      return this.createProcessResult(
        [exprNode],
        [],
        exprId,
        [{ id: exprId }],
        new Set<string>()
      );
    }

    return this.processStatement(expr, exitId);
  }

  private isSemanticUnit(node: Parser.SyntaxNode): boolean {
    return ["await_expression", "try_expression", "call_expression"].includes(
      node.type
    );
  }

  private shouldDecomposeExpression(expr: Parser.SyntaxNode): boolean {
    return [
      "if_expression",
      "match_expression",
      "while_expression",
      "loop_expression",
      "for_expression",
      "block",
    ].includes(expr.type);
  }

  private processAwaitExpression(
    node: Parser.SyntaxNode,
    exitId: string
  ): ProcessResult {
    const expr = node.namedChild(0);

    if (!expr) {
      return this.createProcessResult();
    }
    
    if (this.shouldDecomposeExpression(expr)) {
      const exprResult = this.processComplexExpression(expr, exitId);

      const awaitId = this.generateNodeId("await");
      const awaitNode = this.createSemanticNode(
        awaitId,
        `await ${this.truncateText(expr.text)}`,
        NodeType.AWAIT,
        node
      );

      const nodes: FlowchartNode[] = [...exprResult.nodes, awaitNode];
      const edges: FlowchartEdge[] = [...exprResult.edges];
      const nodesConnectedToExit = new Set<string>();
      exprResult.nodesConnectedToExit.forEach((id) =>
        nodesConnectedToExit.add(id)
      );

      this.locationMap.push({
        start: node.startIndex,
        end: node.endIndex,
        nodeId: awaitId,
      });

      if (exprResult.exitPoints.length > 0) {
        exprResult.exitPoints.forEach((ep: { id: string; label?: string }) => {
          if (!exprResult.nodesConnectedToExit.has(ep.id)) {
            edges.push({ from: ep.id, to: awaitId, label: ep.label });
          }
        });
      } else if (exprResult.entryNodeId) {
        edges.push({ from: exprResult.entryNodeId, to: awaitId });
      }

      return this.createProcessResult(
        nodes,
        edges,
        exprResult.entryNodeId || awaitId,
        [{ id: awaitId }],
        nodesConnectedToExit
      );
    } else {
      const awaitId = this.generateNodeId("await");
      const awaitNode = this.createSemanticNode(
        awaitId,
        `await ${this.truncateText(expr.text)}`,
        NodeType.AWAIT,
        node
      );
      
      this.locationMap.push({
        start: node.startIndex,
        end: node.endIndex,
        nodeId: awaitId,
      });

      return this.createProcessResult(
        [awaitNode],
        [],
        awaitId,
        [{ id: awaitId }],
        new Set<string>()
      );
    }
  }

  private findClosuresInArguments(
    argumentsNode: Parser.SyntaxNode | null
  ): Parser.SyntaxNode[] {
    if (!argumentsNode) return [];

    const closures: Parser.SyntaxNode[] = [];
    
    for (let i = 0; i < argumentsNode.namedChildCount; i++) {
      const arg = argumentsNode.namedChild(i);
      if (arg?.type === "closure_expression") {
        closures.push(arg);
      }
    }

    return closures;
  }

  private truncateText(text: string, maxLength: number = 30): string {
    const cleanedText = text.replace(/\s+/g, ' ').trim();
    if (cleanedText.length <= maxLength) {
      return cleanedText;
    }
    return cleanedText.substring(0, maxLength - 3) + "...";
  }
}
