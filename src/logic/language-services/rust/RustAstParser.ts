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

  // This is a more robust way to get all executable statements from a block,
  // including the final expression that acts as an implicit return.
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

    // Check if the final statement in the block is an expression that should be an implicit return.
    if (isLastStatement && this.isImplicitReturn(statement, blockNode)) {
      result = this.processImplicitReturn(statement, exitId, loopContext);
    } else {
      result = this.processStatement(statement, exitId, loopContext);
    }

    if (result.nodes.length === 0 && !result.entryNodeId) {
        continue; // Skip empty results (e.g., from comments)
    }

    nodes.push(...result.nodes);
    edges.push(...result.edges);
    result.nodesConnectedToExit.forEach((n) => nodesConnectedToExit.add(n));

    if (!entryNodeId) {
      entryNodeId = result.entryNodeId;
    }

    // Connect the previous statement's exit points to the current statement's entry.
    if (lastExitPoints.length > 0 && result.entryNodeId) {
      for (const exitPoint of lastExitPoints) {
        edges.push({
          from: exitPoint.id,
          to: result.entryNodeId,
          label: exitPoint.label,
        });
      }
    }
    
    // The exit points for the next iteration are the exit points from the statement we just processed.
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
    // [FIX 1]: Check if the implicit return is a method call chain OR a call expression that's part of a chain
    if (statement.type === "method_call_expression" || this.isMethodCallChain(statement)) {
      const chainResult = this.processChainedMethodCalls(statement, exitId);
      
      // Connect the final exit points to the function exit with a "return" label
      const edges = [...chainResult.edges];
      const nodesConnectedToExit = new Set(chainResult.nodesConnectedToExit);
      
      chainResult.exitPoints.forEach((ep) => {
        if (!chainResult.nodesConnectedToExit.has(ep.id)) {
          edges.push({ from: ep.id, to: exitId, label: ep.label || "return" });
          nodesConnectedToExit.add(ep.id);
        }
      });
      
      return this.createProcessResult(
        chainResult.nodes,
        edges,
        chainResult.entryNodeId,
        [], // No further exit points, they all go to the function exit
        nodesConnectedToExit
      );
    }
  
    // Original logic for other implicit return types
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
      case "method_call_expression":
        return this.processChainedMethodCalls(statement, exitId);
      case "call_expression":
        // Delegate to processChainedMethodCalls if it's part of a chain
        if (this.isMethodCallChain(statement)) {
          return this.processChainedMethodCalls(statement, exitId);
        }
        return this.processCallExpression(statement, exitId);
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

  private processExpressionStatement(
    node: Parser.SyntaxNode,
    exitId: string,
    loopContext?: LoopContext
  ): ProcessResult {
    const expr = node.namedChild(0);
    if (!expr) {
      return this.createProcessResult();
    }
  
    // Check if this is a method call chain (including call_expression chains)
    if (expr.type === "method_call_expression" || this.isMethodCallChain(expr)) {
      return this.processChainedMethodCalls(expr, exitId);
    }
  
    // Handle other expression types
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
        "call_expression", // Keep this for non-chain call expressions
        "macro_invocation",
        "assignment_expression",
      ].includes(expr.type)
    ) {
      return this.processStatement(expr, exitId, loopContext);
    }
    
    // Handle simple expressions
    const stmtId = this.generateNodeId("stmt");
    const stmtNode = this.createSemanticNode(
      stmtId,
      this.truncateText(expr.text),
      this.getNodeTypeForExpression(expr.type),
      expr
    );
  
    this.locationMap.push({
      start: expr.startIndex,
      end: expr.endIndex,
      nodeId: stmtId,
    });
  
    return this.createProcessResult(
      [stmtNode],
      [],
      stmtId,
      [{ id: stmtId }],
      new Set<string>()
    );
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

  /**
   * Correctly processes a match expression by modeling its sequential evaluation of arms.
   * Handles guard clauses by creating fall-through logic.
   */
  private processMatchExpression(
    node: Parser.SyntaxNode,
    exitId: string,
    loopContext?: LoopContext
  ): ProcessResult {
    const value = node.childForFieldName("value");
    const body = node.childForFieldName("body");

    if (!value || !body) {
      return this.createProcessResult();
    }

    const valueText = this.truncateText(value.text);
    const matchStartId = this.generateNodeId("match_start");
    const matchStartNode = this.createSemanticNode(
        matchStartId,
        `match ${valueText}`,
        NodeType.PROCESS, // A setup step, not a decision itself
        value
    );

    this.locationMap.push({
      start: value.startIndex,
      end: value.endIndex,
      nodeId: matchStartId,
    });

    const nodes: FlowchartNode[] = [matchStartNode];
    const edges: FlowchartEdge[] = [];
    const nodesConnectedToExit = new Set<string>();

    const mergeId = this.generateNodeId("match_merge");
    nodes.push(this.createSemanticNode(mergeId, "", NodeType.MERGE, node));

    const arms = body.descendantsOfType("match_arm");
    let fallthroughSourceId = matchStartId;

    for (let i = 0; i < arms.length; i++) {
        const arm = arms[i];
        const pattern = arm.childForFieldName("pattern");
        const guard = arm.childForFieldName("guard");
        const armValue = arm.childForFieldName("value");

        if (!armValue) continue; // Skip arms with no value/body

        const patternText = pattern ? this.truncateText(pattern.text) : `arm_${i}`;

        // Process the arm's body subgraph first
        const armResult = this.processStatementOrBlock(armValue, exitId, loopContext);
        nodes.push(...armResult.nodes);
        edges.push(...armResult.edges);
        armResult.nodesConnectedToExit.forEach((id) => nodesConnectedToExit.add(id));
        
        // Connect all successful exits from the arm's body to the common merge point
        armResult.exitPoints.forEach(ep => {
            if (!armResult.nodesConnectedToExit.has(ep.id)) {
                edges.push({ from: ep.id, to: mergeId, label: ep.label });
            }
        });

        // Create the decision node for this arm
        const armDecisionId = this.generateNodeId("match_arm_decision");
        let decisionLabel: string;
        if (guard) {
            const guardCondition = guard.childForFieldName("condition");
            const guardText = guardCondition ? this.truncateText(guardCondition.text) : '...';
            decisionLabel = `${patternText} if ${guardText}`;
        } else {
            decisionLabel = patternText;
        }
        const armDecisionNode = this.createSemanticNode(armDecisionId, decisionLabel, NodeType.DECISION, arm);
        nodes.push(armDecisionNode);

        // Connect from the previous fallthrough point to this arm's decision
        // The label is empty for the first arm, and "false" for subsequent fallthroughs.
        edges.push({ from: fallthroughSourceId, to: armDecisionId, label: fallthroughSourceId === matchStartId ? undefined : "false" });

        // Connect the 'true' path of the decision to the arm's body
        if (armResult.entryNodeId) {
            edges.push({ from: armDecisionId, to: armResult.entryNodeId, label: "true" });
        } else {
            // If arm body is empty, its true path goes directly to the merge point
            edges.push({ from: armDecisionId, to: mergeId, label: "true" });
        }
        
        // The new fallthrough point is the 'false' path of the current arm's decision
        fallthroughSourceId = armDecisionId;
    }

    // Connect the final fallthrough (if all arms fail) to the merge point
    edges.push({ from: fallthroughSourceId, to: mergeId, label: "false" });
    
    const exitPoints: { id: string; label?: string }[] = [{ id: mergeId }];

    return this.createProcessResult(
      nodes,
      edges,
      matchStartId,
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

    // Handles a return statement without a value, e.g., `return;`
    if (!value) {
      const returnId = this.generateNodeId("return");
      const returnNode = this.createSemanticNode(
        returnId,
        "return",
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

    // Recursively process the expression within the return statement.
    // This will correctly delegate to `processChainedMethodCalls` for method chains.
    const valueResult = this.processStatement(value, exitId);

    // Add the edges from the processed expression.
    const edges = [...valueResult.edges];
    const nodesConnectedToExit = new Set(valueResult.nodesConnectedToExit);

    // Connect the final nodes of the expression to the function's main exit node.
    valueResult.exitPoints.forEach((ep) => {
      if (!nodesConnectedToExit.has(ep.id)) {
        edges.push({ from: ep.id, to: exitId, label: ep.label || "return" });
        nodesConnectedToExit.add(ep.id);
      }
    });
    
    // Map the location of the entire `return ...;` statement to the entry node of the processed expression.
    if (valueResult.entryNodeId) {
        this.locationMap.push({ start: node.startIndex, end: node.endIndex, nodeId: valueResult.entryNodeId });
    }

    return this.createProcessResult(
      valueResult.nodes,
      edges,
      valueResult.entryNodeId,
      [], // All paths now explicitly lead to the function exit, so no further exit points.
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

  private isMethodCallChain(node: Parser.SyntaxNode): boolean {
    // Check if this is a call_expression that's part of a method chain
    if (node.type === "call_expression") {
      const function_node = node.childForFieldName("function");
      return function_node?.type === "field_expression";
    }
    
    // Check if this node contains method calls in its tree
    if (node.type === "method_call_expression") {
      return true;
    }
    
    // Recursively check if any child is a method call
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (child && (child.type === "method_call_expression" || this.isMethodCallChain(child))) {
        return true;
      }
    }
    
    return false;
  }

  /**
   * Parses the AST for a method call chain to extract the base object and the sequence of calls.
   * @param node The starting node of the method call chain.
   * @returns An object containing the base receiver node and an array of call information.
   */
  private _buildMethodCallChain(node: Parser.SyntaxNode): {
    baseReceiver: Parser.SyntaxNode | null;
    calls: {
        node: Parser.SyntaxNode;
        method: string;
        args: string;
    }[];
  } {
      const methodCalls: { node: Parser.SyntaxNode; method: string; args: string }[] = [];
      let currentNode: Parser.SyntaxNode | null = node;

      while (currentNode) {
          if (currentNode.type === 'method_call_expression') {
              const methodField = currentNode.childForFieldName('method');
              const argsField = currentNode.childForFieldName('arguments');
              
              const methodName = methodField?.text || 'unknown';
              const argsText = argsField ? this.truncateText(argsField.text, 15) : '()';

              methodCalls.unshift({ node: currentNode, method: methodName, args: argsText });
              currentNode = currentNode.childForFieldName('receiver');
          } else if (currentNode.type === 'call_expression') {
              const functionField = currentNode.childForFieldName('function');
              const argsField = currentNode.childForFieldName('arguments');
              
              if (functionField?.type === 'field_expression') {
                  const fieldName = functionField.childForFieldName('field');
                  const methodName = fieldName?.text || 'unknown';
                  const argsText = argsField ? this.truncateText(argsField.text, 15) : '()';
                  
                  methodCalls.unshift({ node: currentNode, method: methodName, args: argsText });
                  currentNode = functionField.childForFieldName('value');
              } else {
                  break;
              }
          } else {
              break;
          }
      }
      
      return { baseReceiver: currentNode, calls: methodCalls };
  }

  private processChainedMethodCalls(
    node: Parser.SyntaxNode,
    exitId: string
  ): ProcessResult {
    const { baseReceiver, calls: methodCalls } = this._buildMethodCallChain(node);
    
    if (!baseReceiver) {
      return this.processGenericStatement(node, exitId);
    }
  
    const nodes: FlowchartNode[] = [];
    const edges: FlowchartEdge[] = [];
    const nodesConnectedToExit = new Set<string>();
  
    // Process the base receiver first, which might be a simple variable or a complex expression.
    const receiverResult = this.processStatement(baseReceiver, exitId);
    nodes.push(...receiverResult.nodes);
    edges.push(...receiverResult.edges);
    receiverResult.nodesConnectedToExit.forEach(id => nodesConnectedToExit.add(id));
      
    let entryNodeId = receiverResult.entryNodeId;
    let lastExitPoints = receiverResult.exitPoints;
  
    // Process each method call in sequence
    for (const { node: methodNode, method, args } of methodCalls) {
      const methodId = this.generateNodeId("method");
      const methodCallNode = this.createSemanticNode(
        methodId,
        `.${method}${args}`,
        NodeType.METHOD_CALL,
        methodNode
      );
      nodes.push(methodCallNode);
  
      this.locationMap.push({
        start: methodNode.startIndex,
        end: methodNode.endIndex,
        nodeId: methodId,
      });
  
      // Connect previous step's exit points to this new method call node.
      for (const exitPoint of lastExitPoints) {
        if (!nodesConnectedToExit.has(exitPoint.id)) {
          edges.push({ 
            from: exitPoint.id, 
            to: methodId, 
            label: exitPoint.label 
          });
        }
      }
  
      // Handle closures in method arguments - create branches for complex closures
      const argsNode = methodNode.childForFieldName('arguments');
      if (argsNode) {
        const closures = this.findClosuresInArguments(argsNode);
        
        closures.forEach((closure, closureIndex) => {
          const closureBody = closure.childForFieldName("body");
          
          if (closureBody && this.isComplexClosureBody(closureBody)) {
            const closureId = this.generateNodeId(`closure_${closureIndex}`);
            const params = this.getClosureParameters(closure);
            const closureHeaderNode = this.createSemanticNode(
              closureId,
              `|${params}| { ... }`,
              NodeType.FUNCTION_CALL,
              closure
            );
            nodes.push(closureHeaderNode);
            edges.push({ from: methodId, to: closureId, label: `closure` });

            const internalClosureExitId = this.generateNodeId('closure_internal_exit');
            const closureResult = this.processBlock(closureBody, internalClosureExitId);
            
            nodes.push(...closureResult.nodes);
            edges.push(...closureResult.edges.filter(e => e.to !== internalClosureExitId));

            if (closureResult.entryNodeId) {
              edges.push({ from: closureId, to: closureResult.entryNodeId });
            }
            
            closureResult.nodesConnectedToExit.forEach(id => nodesConnectedToExit.add(id));
          }
        });
      }
  
      // For the next method in the chain, the flow continues from this method call node.
      lastExitPoints = [{ id: methodId }];
    }
  
    return this.createProcessResult(
      nodes,
      edges,
      entryNodeId,
      lastExitPoints,
      nodesConnectedToExit
    );
  }

  /**
   * Determines if a closure's body is complex enough to warrant its own branch.
   * @param body The closure body node.
   * @returns True if the closure body is considered complex.
   */
  private isComplexClosureBody(body: Parser.SyntaxNode): boolean {
    // A block is complex if it has more than one statement,
    // or if its single statement is itself a complex structure.
    if (body.type === 'block') {
        const statements = body.namedChildren.filter(
            c => c.type !== 'line_comment' && c.type !== 'block_comment'
        );
        if (statements.length > 1) {
            return true;
        }
        if (statements.length === 1) {
            // Check if the single statement is complex (e.g., if, match, loop)
            return this.isComplexExpression(statements[0]);
        }
    }
    // If it's not a block (e.g., a simple expression like `word.len() > 2`), treat it as simple.
    return false;
  }

  /**
  * Helper method to extract closure parameters for better labeling
  */
  private getClosureParameters(closure: Parser.SyntaxNode): string {
    const params = closure.childForFieldName("parameters");
    if (params) {
      // Remove the | | wrapper and clean up whitespace
      return params.text.slice(1, -1).trim();
    }
    return "";
  }

  private processMacroInvocation(
    node: Parser.SyntaxNode,
    exitId: string
  ): ProcessResult {
    const macro_name = node.childForFieldName("macro");
    const argumentsNode = node.childForFieldName("arguments");

    const macroName = macro_name?.text || "unknown_macro";
    let label = this.truncateText(node.text);
    if (argumentsNode) {
      label += argumentsNode.text;
    }

    if (macroName === "panic!") {
      const panicId = this.generateNodeId("panic");
      const panicNode = this.createSemanticNode(
        panicId,
        `panic!${argumentsNode?.text || "()"}`,
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

  /**
  * Enhanced method to find closures in function arguments
  */
  private findClosuresInArguments(argumentsNode: Parser.SyntaxNode | null): Parser.SyntaxNode[] {
    if (!argumentsNode) return [];

    const closures: Parser.SyntaxNode[] = [];
    
    // Traverse all arguments looking for closures
    const traverse = (node: Parser.SyntaxNode) => {
      if (node.type === "closure_expression") {
        closures.push(node);
        return;
      }
      
      // Recursively check children for nested closures
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child) {
          traverse(child);
        }
      }
    };
    
    traverse(argumentsNode);
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