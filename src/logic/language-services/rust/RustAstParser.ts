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
    node: Parser.SyntaxNode,
    exitId: string,
    loopContext?: LoopContext
  ): ProcessResult {
    const nodes: FlowchartNode[] = [];
    const edges: FlowchartEdge[] = [];
    const exitPoints: { id: string; label?: string }[] = [];
    const nodesConnectedToExit = new Set<string>();

    let entryNodeId: string | undefined;
    let lastNodeIds: string[] = [];

    // Process all statements in the block
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (!child) continue;

      const result = this.processStatement(child, exitId, loopContext);

      nodes.push(...result.nodes);
      edges.push(...result.edges);

      if (!entryNodeId && result.entryNodeId) {
        entryNodeId = result.entryNodeId;
      }

      // Connect previous statements to current
      if (lastNodeIds.length > 0 && result.entryNodeId) {
        lastNodeIds.forEach((lastId) => {
          edges.push({ from: lastId, to: result.entryNodeId! });
        });
      }

      // Update last node IDs for next iteration
      if (result.exitPoints.length > 0) {
        lastNodeIds = result.exitPoints.map((ep) => ep.id);
      } else if (result.entryNodeId) {
        lastNodeIds = [result.entryNodeId];
      }

      // Collect exit points
      exitPoints.push(...result.exitPoints);
      result.nodesConnectedToExit.forEach((id) => nodesConnectedToExit.add(id));
    }

    // If no statements, create a simple pass-through
    if (!entryNodeId) {
      const emptyId = this.generateNodeId("empty");
      const emptyNode = this.createSemanticNode(
        emptyId,
        "",
        NodeType.PROCESS,
        node
      );
      nodes.push(emptyNode);
      entryNodeId = emptyId;
      lastNodeIds = [emptyId];
    }

    // If we have remaining last nodes, they become exit points
    if (lastNodeIds.length > 0) {
      lastNodeIds.forEach((id) => {
        exitPoints.push({ id });
      });
    }

    return {
      nodes,
      edges,
      entryNodeId,
      exitPoints,
      nodesConnectedToExit,
    };
  }

  protected processStatement(
    statement: Parser.SyntaxNode,
    exitId: string,
    loopContext?: LoopContext
  ): ProcessResult {
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

    return {
      nodes: [declNode],
      edges: [],
      entryNodeId: declId,
      exitPoints: [{ id: declId }],
      nodesConnectedToExit: new Set(),
    };
  }

  private processExpressionStatement(
    node: Parser.SyntaxNode,
    exitId: string,
    loopContext?: LoopContext
  ): ProcessResult {
    // Get the first child which should be the expression
    const expr = node.namedChild(0);
    if (expr) {
      return this.processStatement(expr, exitId, loopContext);
    }

    const stmtId = this.generateNodeId("stmt");
    const stmtNode = this.createSemanticNode(
      stmtId,
      this.truncateText(node.text),
      NodeType.PROCESS,
      node
    );

    return {
      nodes: [stmtNode],
      edges: [],
      entryNodeId: stmtId,
      exitPoints: [{ id: stmtId }],
      nodesConnectedToExit: new Set(),
    };
  }

  private processIfExpression(
    node: Parser.SyntaxNode,
    exitId: string,
    loopContext?: LoopContext
  ): ProcessResult {
    const condition = node.childForFieldName("condition");
    const consequence = node.childForFieldName("consequence");
    const alternative = node.childForFieldName("alternative");

    const conditionText = condition
      ? this.truncateText(condition.text)
      : "condition";
    const conditionId = this.generateNodeId("if");
    const conditionNode = this.createSemanticNode(
      conditionId,
      `if ${conditionText}`,
      NodeType.DECISION,
      node
    );

    const nodes: FlowchartNode[] = [conditionNode];
    const edges: FlowchartEdge[] = [];
    const exitPoints: { id: string; label?: string }[] = [];
    const nodesConnectedToExit = new Set<string>();

    let thenResult: ProcessResult;
    if (consequence) {
      thenResult = this.processStatement(consequence, exitId, loopContext);
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
      const elseResult = this.processStatement(
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

    return {
      nodes,
      edges,
      entryNodeId: conditionId,
      exitPoints,
      nodesConnectedToExit,
    };
  }

  private processMatchExpression(
    node: Parser.SyntaxNode,
    exitId: string,
    loopContext?: LoopContext
  ): ProcessResult {
    const value = node.childForFieldName("value");
    const body = node.childForFieldName("body");

    const valueText = value ? this.truncateText(value.text) : "value";
    const matchId = this.generateNodeId("match");
    const matchNode = this.createSemanticNode(
      matchId,
      `match ${valueText}`,
      NodeType.DECISION,
      node
    );

    const nodes: FlowchartNode[] = [matchNode];
    const edges: FlowchartEdge[] = [];
    const exitPoints: { id: string; label?: string }[] = [];
    const nodesConnectedToExit = new Set<string>();

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
          const armResult = this.processStatement(
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
        }
      });
    }

    return {
      nodes,
      edges,
      entryNodeId: matchId,
      exitPoints,
      nodesConnectedToExit,
    };
  }

  private processWhileExpression(
    node: Parser.SyntaxNode,
    exitId: string,
    loopContext?: LoopContext
  ): ProcessResult {
    const condition = node.childForFieldName("condition");
    const body = node.childForFieldName("body");

    const conditionText = condition
      ? this.truncateText(condition.text)
      : "condition";
    const conditionId = this.generateNodeId("while");
    const conditionNode = this.createSemanticNode(
      conditionId,
      `while ${conditionText}`,
      NodeType.DECISION,
      node
    );

    const nodes: FlowchartNode[] = [conditionNode];
    const edges: FlowchartEdge[] = [];
    const exitPoints: { id: string; label?: string }[] = [
      { id: conditionId, label: "false" },
    ];
    const nodesConnectedToExit = new Set<string>();

    if (body) {
      const newLoopContext: LoopContext = {
        breakTargetId: exitId,
        continueTargetId: conditionId,
      };

      const bodyResult = this.processStatement(body, exitId, newLoopContext);
      nodes.push(...bodyResult.nodes);
      edges.push(...bodyResult.edges);

      if (bodyResult.entryNodeId) {
        edges.push({
          from: conditionId,
          to: bodyResult.entryNodeId,
          label: "true",
        });
      }

      // Connect body exit points back to condition
      bodyResult.exitPoints.forEach((ep) => {
        if (!bodyResult.nodesConnectedToExit.has(ep.id)) {
          edges.push({ from: ep.id, to: conditionId });
        }
      });

      bodyResult.nodesConnectedToExit.forEach((id) =>
        nodesConnectedToExit.add(id)
      );
    }

    return {
      nodes,
      edges,
      entryNodeId: conditionId,
      exitPoints,
      nodesConnectedToExit,
    };
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

    if (body) {
      const newLoopContext: LoopContext = {
        breakTargetId: exitId,
        continueTargetId: loopId,
      };

      const bodyResult = this.processStatement(body, exitId, newLoopContext);
      nodes.push(...bodyResult.nodes);
      edges.push(...bodyResult.edges);

      if (bodyResult.entryNodeId) {
        edges.push({ from: loopId, to: bodyResult.entryNodeId });
      }

      // Connect body exit points back to loop start
      bodyResult.exitPoints.forEach((ep) => {
        if (!bodyResult.nodesConnectedToExit.has(ep.id)) {
          edges.push({ from: ep.id, to: loopId });
        }
      });

      bodyResult.nodesConnectedToExit.forEach((id) =>
        nodesConnectedToExit.add(id)
      );
    }

    return {
      nodes,
      edges,
      entryNodeId: loopId,
      exitPoints,
      nodesConnectedToExit,
    };
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

    if (body) {
      const newLoopContext: LoopContext = {
        breakTargetId: exitId,
        continueTargetId: forId,
      };

      const bodyResult = this.processStatement(body, exitId, newLoopContext);
      nodes.push(...bodyResult.nodes);
      edges.push(...bodyResult.edges);

      if (bodyResult.entryNodeId) {
        edges.push({ from: forId, to: bodyResult.entryNodeId });
      }

      // Connect body exit points back to for loop
      bodyResult.exitPoints.forEach((ep) => {
        if (!bodyResult.nodesConnectedToExit.has(ep.id)) {
          edges.push({ from: ep.id, to: forId });
        }
      });

      bodyResult.nodesConnectedToExit.forEach((id) =>
        nodesConnectedToExit.add(id)
      );
    }

    return {
      nodes,
      edges,
      entryNodeId: forId,
      exitPoints,
      nodesConnectedToExit,
    };
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

    // Connect to the nearest loop's break target
    if (loopContext) {
      edges.push({ from: breakId, to: loopContext.breakTargetId });
      nodesConnectedToExit.add(breakId);
    }

    return {
      nodes: [breakNode],
      edges,
      entryNodeId: breakId,
      exitPoints: [],
      nodesConnectedToExit,
    };
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

    // Connect to the nearest loop's continue target
    if (loopContext) {
      edges.push({ from: continueId, to: loopContext.continueTargetId });
      nodesConnectedToExit.add(continueId);
    }

    return {
      nodes: [continueNode],
      edges,
      entryNodeId: continueId,
      exitPoints: [],
      nodesConnectedToExit,
    };
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

    return {
      nodes: [returnNode],
      edges,
      entryNodeId: returnId,
      exitPoints: [],
      nodesConnectedToExit,
    };
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

    return {
      nodes: [assignNode],
      edges: [],
      entryNodeId: assignId,
      exitPoints: [{ id: assignId }],
      nodesConnectedToExit: new Set(),
    };
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

    return {
      nodes: [callNode],
      edges: [],
      entryNodeId: callId,
      exitPoints: [{ id: callId }],
      nodesConnectedToExit: new Set(),
    };
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

    return {
      nodes: [stmtNode],
      edges: [],
      entryNodeId: stmtId,
      exitPoints: [{ id: stmtId }],
      nodesConnectedToExit: new Set(),
    };
  }

  private truncateText(text: string, maxLength: number = 30): string {
    if (text.length <= maxLength) {
      return text;
    }
    return text.substring(0, maxLength - 3) + "...";
  }
}
