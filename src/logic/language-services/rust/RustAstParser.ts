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
      const result = this.processStatement(statement, exitId, loopContext);

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
      case "block":
        return this.processBlock(statement, exitId, loopContext);
      default:
        return this.processGenericStatement(statement, exitId);
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
    if (value) {
      label += " = " + this.truncateText(value.text);
    }

    const declId = this.generateNodeId("let");
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
        new Set()
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
      case "method_call_expression":
        return NodeType.FUNCTION_CALL;
      default:
        return NodeType.PROCESS;
    }
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
        const armValue = arm.childForFieldName("value");

        const patternText = pattern
          ? this.truncateText(pattern.text)
          : `arm_${index}`;

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
              from: matchId,
              to: armResult.entryNodeId,
              label: patternText,
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
          edges.push({ from: matchId, to: armId, label: patternText });
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

    return this.createProcessResult(
      [callNode],
      [],
      callId,
      [{ id: callId }],
      new Set()
    );
  }

  private truncateText(text: string, maxLength: number = 30): string {
    if (text.length <= maxLength) {
      return text;
    }
    return text.substring(0, maxLength - 3) + "...";
  }
}
