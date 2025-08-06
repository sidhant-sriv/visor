import Parser from "web-tree-sitter";
import { AbstractParser } from "../../common/AbstractParser";
import {
  FlowchartIR,
  FlowchartNode,
  FlowchartEdge,
  NodeType,
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

      return [...funcNames, ...closureNames];
    });
  }

  public findFunctionAtPosition(
    sourceCode: string,
    position: number
  ): string | undefined {
    const tree = this.parser.parse(sourceCode);

    // Check function definitions
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
      // Try to find function definition at position
      targetNode = tree.rootNode
        .descendantsOfType("function_item")
        .find((f) => position >= f.startIndex && position <= f.endIndex);

      if (!targetNode) {
        // Try to find closure expression at position
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
    } else if (functionName) {
      // Find by function name
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
    } else {
      // Get first function
      targetNode =
        tree.rootNode.descendantsOfType("function_item")[0] ||
        tree.rootNode
          .descendantsOfType("let_declaration")
          .find(
            (v) => v.childForFieldName("value")?.type === "closure_expression"
          );

      if (targetNode?.type === "let_declaration") {
        isClosure = true;
      }
    }

    if (!targetNode) {
      return {
        nodes: [
          this.createSemanticNode(
            "A",
            "Place cursor inside a function to generate a flowchart.",
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

    // Create semantic entry and exit nodes
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

    // Add function complexity analysis
    this.addFunctionComplexity(ir, targetNode);

    return ir;
  }

  protected processBlock(
    blockNode: Parser.SyntaxNode,
    exitId: string,
    loopContext?: LoopContext
  ): ProcessResult {
    if (!blockNode) {
      return this.createProcessResult();
    }

    // Pre-filter statements to exclude non-executable nodes
    const statements = blockNode.namedChildren.filter(
      (s) =>
        ![
          "line_comment",
          "block_comment",
          "empty_statement",
          "use_declaration", // imports
          "type_item", // type aliases
          "struct_item", // struct definitions
          "enum_item", // enum definitions
          "impl_item", // impl blocks
          "trait_item", // trait definitions
          "mod_item", // module definitions
          "const_item", // const declarations at top level
          "static_item", // static declarations
          "macro_definition", // macro definitions
          "attribute_item", // attributes like #[derive(...)]
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

    // Process statements with improved loop
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      const isLastStatement = i === statements.length - 1;

      // Check if this is an implicit return (last statement is an expression without semicolon)
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

  /**
   * Check if a statement is an implicit return (expression without semicolon at end of block)
   */
  private isImplicitReturn(
    statement: Parser.SyntaxNode,
    blockNode: Parser.SyntaxNode
  ): boolean {
    // Check if this is an expression that's not terminated by a semicolon
    // and is the last statement in the block
    if (statement.type === "expression_statement") {
      return false; // expression_statement means it has a semicolon
    }

    // Check if it's an expression type that can be a return value
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

  /**
   * Process an implicit return statement
   */
  private processImplicitReturn(
    statement: Parser.SyntaxNode,
    exitId: string,
    loopContext?: LoopContext
  ): ProcessResult {
    // First process the expression normally
    const exprResult = this.processStatement(statement, exitId, loopContext);

    // If the expression has exit points, connect them to the function exit
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
        [], // No exit points since they're connected to function exit
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
    // Skip comments and non-executable statements
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
      case "method_call_expression":
        return this.processMethodCallExpression(statement, exitId);
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

    // Add location mapping
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
    // Get the first child which should be the expression
    const expr = node.namedChild(0);
    if (expr) {
      // For certain expression types, process them directly
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
          "method_call_expression",
          "call_expression",
          "macro_invocation",
        ].includes(expr.type)
      ) {
        return this.processStatement(expr, exitId, loopContext);
      }

      // For other expressions, create a simple process node
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

    // Fallback for malformed expression statements
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

    const declId = this.generateNodeId("let");
    const nodes: FlowchartNode[] = [];
    const edges: FlowchartEdge[] = [];
    const exitPoints: { id: string; label?: string }[] = [];
    const nodesConnectedToExit = new Set<string>();

    // If the value is a complex expression (if, match, loops), process it and link to declaration
    if (value && this.isComplexExpression(value)) {
      const valueResult = this.processStatement(value, exitId);
      nodes.push(...valueResult.nodes);
      edges.push(...valueResult.edges);
      valueResult.nodesConnectedToExit.forEach((id) =>
        nodesConnectedToExit.add(id)
      );

      // Create the declaration node
      const declNode = this.createSemanticNode(
        declId,
        `${label} = <expression result>`,
        NodeType.ASSIGNMENT,
        node
      );
      nodes.push(declNode);

      // Connect value expression exit points to declaration
      if (valueResult.exitPoints.length > 0) {
        valueResult.exitPoints.forEach((ep) => {
          if (!valueResult.nodesConnectedToExit.has(ep.id)) {
            edges.push({ from: ep.id, to: declId, label: ep.label });
          }
        });
      } else if (valueResult.entryNodeId) {
        edges.push({ from: valueResult.entryNodeId, to: declId });
      }

      exitPoints.push({ id: declId });

      // Add location mapping
      this.locationMap.push({
        start: node.startIndex,
        end: node.endIndex,
        nodeId: declId,
      });

      return this.createProcessResult(
        nodes,
        edges,
        valueResult.entryNodeId,
        exitPoints,
        nodesConnectedToExit
      );
    } else if (value && this.isSemanticUnit(value)) {
      // For semantic units (await, try, method chains), process them but integrate into single assignment
      const valueResult = this.processStatement(value, exitId);

      // Create a combined assignment node that includes the semantic operation
      let assignmentLabel = `${label} = ${this.truncateText(value.text)}`;

      const declNode = this.createSemanticNode(
        declId,
        assignmentLabel,
        NodeType.ASSIGNMENT,
        node
      );

      // Add location mapping
      this.locationMap.push({
        start: node.startIndex,
        end: node.endIndex,
        nodeId: declId,
      });

      // If the value expression has nodes and is truly multi-step (like method chains), include them in the flow
      if (valueResult.nodes.length > 1) {
        nodes.push(...valueResult.nodes);
        nodes.push(declNode);
        edges.push(...valueResult.edges);
        valueResult.nodesConnectedToExit.forEach((id) =>
          nodesConnectedToExit.add(id)
        );

        // Connect value expression to assignment
        if (valueResult.exitPoints.length > 0) {
          valueResult.exitPoints.forEach((ep) => {
            if (!valueResult.nodesConnectedToExit.has(ep.id)) {
              edges.push({ from: ep.id, to: declId, label: ep.label });
            }
          });
        } else if (valueResult.entryNodeId) {
          edges.push({ from: valueResult.entryNodeId, to: declId });
        }

        return this.createProcessResult(
          nodes,
          edges,
          valueResult.entryNodeId,
          [{ id: declId }],
          nodesConnectedToExit
        );
      } else {
        // Single semantic unit - use the semantic node directly instead of creating a separate assignment
        if (valueResult.nodes.length === 1) {
          const semanticNode = valueResult.nodes[0];
          // Update the existing semantic node to include the assignment context
          semanticNode.label = `${label} = ${semanticNode.label}`;

          return this.createProcessResult(
            [semanticNode],
            valueResult.edges,
            valueResult.entryNodeId,
            valueResult.exitPoints,
            valueResult.nodesConnectedToExit
          );
        } else {
          // No nodes from value processing - create simple assignment
          return this.createProcessResult(
            [declNode],
            [],
            declId,
            [{ id: declId }],
            new Set()
          );
        }
      }
    } else {
      // Simple assignment
      if (value) {
        label += " = " + this.truncateText(value.text);
      }

      const declNode = this.createSemanticNode(
        declId,
        label,
        NodeType.ASSIGNMENT,
        node
      );

      // Add location mapping
      this.locationMap.push({
        start: node.startIndex,
        end: node.endIndex,
        nodeId: declId,
      });

      return this.createProcessResult(
        [declNode],
        [],
        declId,
        [{ id: declId }],
        new Set()
      );
    }
  }

  /**
   * Check if an expression is complex enough to warrant separate processing
   * Updated to align with our semantic unit approach for await/try expressions
   */
  private isComplexExpression(expr: Parser.SyntaxNode): boolean {
    return [
      "if_expression",
      "match_expression",
      "while_expression",
      "loop_expression",
      "for_expression",
      "block",
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

    // Add location mapping for the condition
    this.locationMap.push({
      start: condition.startIndex,
      end: condition.endIndex,
      nodeId: conditionId,
    });

    // Process consequence (then branch)
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

    // Process alternative (else branch)
    if (alternative) {
      const elseResult = this.processStatementOrBlock(
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
          label: "false",
        });
      }
      exitPoints.push(...elseResult.exitPoints);
      elseResult.nodesConnectedToExit.forEach((id) =>
        nodesConnectedToExit.add(id)
      );
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

  /**
   * Process either a single statement or a block
   * This handles both single statements and blocks properly for conditionals
   */
  private processStatementOrBlock(
    statementOrBlock: Parser.SyntaxNode,
    exitId: string,
    loopContext?: LoopContext
  ): ProcessResult {
    // If it's a block, process it as a block
    if (statementOrBlock.type === "block") {
      return this.processBlock(statementOrBlock, exitId, loopContext);
    }

    // Otherwise, process it as a single statement
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

    // Add location mapping for the match value
    this.locationMap.push({
      start: value.startIndex,
      end: value.endIndex,
      nodeId: matchId,
    });

    if (body) {
      // Process match arms
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

        // Handle match guard if present
        if (guard) {
          const guardCondition = guard.namedChild(0); // The condition after 'if'
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

            // Add location mapping for the guard
            this.locationMap.push({
              start: guard.startIndex,
              end: guard.endIndex,
              nodeId: guardId,
            });

            currentNodeId = guardId;
            currentLabel = "true";

            // Guard failure should continue to next arm (represented by not connecting to this arm)
            // In a real implementation, this would need more sophisticated handling
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
          // Create a simple node for arms without complex expressions
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

          // Add location mapping for the arm
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

    // Add location mapping for the condition
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

      // Connect body exit points back to condition (for natural loop flow)
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

    // Add location mapping
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

      // Connect body exit points back to loop start (for natural loop flow)
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

    // Add location mapping
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

      // Connect body exit points back to for loop (for natural loop flow)
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

    // Add location mapping
    this.locationMap.push({
      start: node.startIndex,
      end: node.endIndex,
      nodeId: breakId,
    });

    // Connect to the nearest loop's break target
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

    // Add location mapping
    this.locationMap.push({
      start: node.startIndex,
      end: node.endIndex,
      nodeId: continueId,
    });

    // Connect to the nearest loop's continue target
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

    // Add location mapping
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

    // Add location mapping
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

    // Add location mapping
    this.locationMap.push({
      start: node.startIndex,
      end: node.endIndex,
      nodeId: callId,
    });

    // Check for closures in arguments and process them
    const closureNodes = this.findClosuresInArguments(arguments_node);
    const nodes: FlowchartNode[] = [callNode];
    const edges: FlowchartEdge[] = [];

    // Process closure arguments recursively
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

  private processMethodCallExpression(
    node: Parser.SyntaxNode,
    exitId: string
  ): ProcessResult {
    const receiver = node.childForFieldName("receiver");
    const method = node.childForFieldName("method");
    const arguments_node = node.childForFieldName("arguments");

    const nodes: FlowchartNode[] = [];
    const edges: FlowchartEdge[] = [];
    const nodesConnectedToExit = new Set<string>();
    let entryNodeId: string | undefined;
    let lastNodeId: string | undefined;

    // Process the receiver (which might be a method chain)
    if (receiver) {
      if (receiver.type === "method_call_expression") {
        // Recursive method chaining
        const receiverResult = this.processMethodCallExpression(
          receiver,
          exitId
        );
        nodes.push(...receiverResult.nodes);
        edges.push(...receiverResult.edges);
        receiverResult.nodesConnectedToExit.forEach((id) =>
          nodesConnectedToExit.add(id)
        );

        entryNodeId = receiverResult.entryNodeId;
        // Get the last node from the receiver chain
        if (receiverResult.exitPoints.length > 0) {
          lastNodeId = receiverResult.exitPoints[0].id;
        } else if (receiverResult.entryNodeId) {
          // Fallback to entry node if no explicit exit points
          lastNodeId = receiverResult.entryNodeId;
        }
      } else if (receiver.type === "call_expression") {
        // Handle function call as receiver
        const receiverResult = this.processCallExpression(receiver, exitId);
        nodes.push(...receiverResult.nodes);
        edges.push(...receiverResult.edges);
        receiverResult.nodesConnectedToExit.forEach((id) =>
          nodesConnectedToExit.add(id)
        );

        entryNodeId = receiverResult.entryNodeId;
        if (receiverResult.exitPoints.length > 0) {
          lastNodeId = receiverResult.exitPoints[0].id;
        } else if (receiverResult.entryNodeId) {
          // Fallback to entry node if no explicit exit points
          lastNodeId = receiverResult.entryNodeId;
        }
      } else {
        // Simple receiver (identifier, literal, etc.)
        const receiverId = this.generateNodeId("receiver");
        const receiverNode = this.createSemanticNode(
          receiverId,
          this.truncateText(receiver.text),
          NodeType.PROCESS,
          receiver
        );
        nodes.push(receiverNode);
        entryNodeId = receiverId;
        lastNodeId = receiverId;

        this.locationMap.push({
          start: receiver.startIndex,
          end: receiver.endIndex,
          nodeId: receiverId,
        });
      }
    }

    // Create the method call node
    let label = "";
    if (method) {
      label += method.text;
    }
    if (arguments_node) {
      label += arguments_node.text;
    }

    const callId = this.generateNodeId("method_call");
    const callNode = this.createSemanticNode(
      callId,
      this.truncateText(label),
      NodeType.METHOD_CALL,
      node
    );
    nodes.push(callNode);

    // Add location mapping
    this.locationMap.push({
      start: node.startIndex,
      end: node.endIndex,
      nodeId: callId,
    });

    // Connect receiver to method call
    if (lastNodeId) {
      edges.push({ from: lastNodeId, to: callId });
    }

    // Set entry node - preserve receiver's entry, or use this call if no receiver
    if (!entryNodeId) {
      entryNodeId = callId;
    }

    // Check for closures in arguments and process them
    const closureNodes = this.findClosuresInArguments(arguments_node);

    // Process closure arguments recursively
    closureNodes.forEach((closure, index) => {
      const closureBody = closure.childForFieldName("body");
      if (closureBody) {
        const closureId = this.generateNodeId(`method_closure_${index}`);
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
      entryNodeId,
      [{ id: callId }],
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

    // Handle panic! macros specially
    if (macroName === "panic!") {
      const panicId = this.generateNodeId("panic");
      const panicNode = this.createSemanticNode(
        panicId,
        `panic!${token_tree?.text || "()"}`,
        NodeType.PANIC,
        node
      );

      // Add location mapping
      this.locationMap.push({
        start: node.startIndex,
        end: node.endIndex,
        nodeId: panicId,
      });

      // panic! connects directly to exit (terminates function)
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

    // Handle other macros as function calls
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

    // Add location mapping
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
    const expr = node.namedChild(0); // The expression being tried

    if (!expr) {
      return this.createProcessResult();
    }

    // Special handling for await? pattern - this is common in async Rust code
    if (expr.type === "await_expression") {
      // Get the inner expression being awaited
      const innerExpr = expr.namedChild(0);
      if (!innerExpr) {
        return this.createProcessResult();
      }

      // Create a combined await? node that represents both operations
      const awaitTryId = this.generateNodeId("await_try");
      const awaitTryNode = this.createSemanticNode(
        awaitTryId,
        `${this.truncateText(innerExpr.text)}.await?`,
        NodeType.AWAIT,
        node
      );

      // Add location mapping for the entire await? expression
      this.locationMap.push({
        start: node.startIndex,
        end: node.endIndex,
        nodeId: awaitTryId,
      });

      // Create exit points - Ok continues, Err goes to function exit
      const exitPoints: { id: string; label?: string }[] = [
        { id: awaitTryId, label: "Ok" },
      ];
      const nodesConnectedToExit = new Set<string>();

      // Add the Err edge that goes to function exit (early return)
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

    // For most cases, treat the entire try expression as a single node
    // Only decompose if the inner expression is complex control flow
    if (this.shouldDecomposeExpression(expr)) {
      // First process the underlying expression
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

      // Add location mapping
      this.locationMap.push({
        start: node.startIndex,
        end: node.endIndex,
        nodeId: tryId,
      });

      // Connect the expression result to the try node
      if (exprResult.exitPoints.length > 0) {
        exprResult.exitPoints.forEach((ep: { id: string; label?: string }) => {
          if (!exprResult.nodesConnectedToExit.has(ep.id)) {
            edges.push({ from: ep.id, to: tryId, label: ep.label });
          }
        });
      } else if (exprResult.entryNodeId) {
        edges.push({ from: exprResult.entryNodeId, to: tryId });
      }

      // The "Err" path connects directly to function exit (early return)
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
      // Simple case: create a single try node for the entire expression
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

      // Add location mapping
      this.locationMap.push({
        start: node.startIndex,
        end: node.endIndex,
        nodeId: tryId,
      });

      // The "Err" path connects directly to function exit (early return)
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

  /**
   * Helper method to process complex expressions that might need special handling
   */
  private processComplexExpression(
    expr: Parser.SyntaxNode,
    exitId: string
  ): ProcessResult {
    // For expressions that should be processed as statements, delegate to processStatement
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

    // For truly simple expressions, create a basic node
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

    // For other complex expressions, process them as statements
    return this.processStatement(expr, exitId);
  }

  /**
   * Check if an expression represents a semantic unit that should be handled specially
   * but not decomposed like complex control flow expressions
   */
  private isSemanticUnit(node: Parser.SyntaxNode): boolean {
    return ["await_expression", "try_expression", "call_expression"].includes(
      node.type
    );
  }

  /**
   * Determine if an expression should be decomposed into separate nodes
   * Only decompose truly complex control flow expressions
   */
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
    const expr = node.namedChild(0); // The expression being awaited

    if (!expr) {
      return this.createProcessResult();
    }

    // For most cases, treat the entire await expression as a single node
    // Only decompose if the inner expression is complex (like if/match)
    if (this.shouldDecomposeExpression(expr)) {
      // First process the underlying expression
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

      // Add location mapping
      this.locationMap.push({
        start: node.startIndex,
        end: node.endIndex,
        nodeId: awaitId,
      });

      // Connect the expression result to the await node
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
      // Simple case: create a single await node
      const awaitId = this.generateNodeId("await");
      const awaitNode = this.createSemanticNode(
        awaitId,
        `await ${this.truncateText(expr.text)}`,
        NodeType.AWAIT,
        node
      );

      // Add location mapping
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
   * Helper method to find closure expressions in function/method arguments
   */
  private findClosuresInArguments(
    argumentsNode: Parser.SyntaxNode | null
  ): Parser.SyntaxNode[] {
    if (!argumentsNode) return [];

    const closures: Parser.SyntaxNode[] = [];

    // Look for closure_expression nodes in the arguments
    for (let i = 0; i < argumentsNode.namedChildCount; i++) {
      const arg = argumentsNode.namedChild(i);
      if (arg?.type === "closure_expression") {
        closures.push(arg);
      }
    }

    return closures;
  }

  private truncateText(text: string, maxLength: number = 30): string {
    if (text.length <= maxLength) {
      return text;
    }
    return text.substring(0, maxLength - 3) + "...";
  }
}
