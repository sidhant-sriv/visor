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

export class GoAstParser extends AbstractParser {
  private constructor(parser: Parser) {
    super(parser, "go");
  }

  public static async create(wasmPath: string): Promise<GoAstParser> {
    await ensureParserInit();
    const language = await Parser.Language.load(wasmPath);
    const parser = new Parser();
    parser.setLanguage(language);
    return new GoAstParser(parser);
  }

  public listFunctions(sourceCode: string): string[] {
    return this.measurePerformance("listFunctions", () => {
      const tree = this.parser.parse(sourceCode);
      const funcNames = tree.rootNode
        .descendantsOfType(["function_declaration", "method_declaration"])
        .map(
          (f: Parser.SyntaxNode) => this.extractFunctionName(f) || "[anonymous]"
        );
      return funcNames;
    });
  }

  public findFunctionAtPosition(
    sourceCode: string,
    position: number
  ): string | undefined {
    const tree = this.parser.parse(sourceCode);
    const func = tree.rootNode
      .descendantsOfType(["function_declaration", "method_declaration"])
      .find((f) => position >= f.startIndex && position <= f.endIndex);
    if (func) {
      return this.extractFunctionName(func) || "[anonymous]";
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

    if (position !== undefined) {
      targetNode = tree.rootNode
        .descendantsOfType(["function_declaration", "method_declaration"])
        .find((f) => position >= f.startIndex && position <= f.endIndex);
    } else if (functionName) {
      targetNode = tree.rootNode
        .descendantsOfType(["function_declaration", "method_declaration"])
        .find((f) => this.extractFunctionName(f) === functionName);
    } else {
      targetNode = tree.rootNode.descendantsOfType("function_declaration")[0];
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

    const bodyToProcess = targetNode.childForFieldName("body");
    const funcNameStr = this.escapeString(
      this.extractFunctionName(targetNode) || "[anonymous]"
    );
    const title = `Flowchart for function: ${funcNameStr}`;

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
        title,
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

    const bodyResult = this.processBlock(bodyToProcess, exitId);
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
      entryNodeId: entryId,
      exitNodeId: exitId,
      locationMap: this.locationMap,
      title,
    };

    this.addFunctionComplexity(ir, targetNode);

    return ir;
  }

  protected processBlock(
    blockNode: Parser.SyntaxNode,
    exitId: string,
    loopContext?: LoopContext,
    finallyContext?: { finallyEntryId: string }
  ): ProcessResult {
    if (!blockNode) {
      return this.createProcessResult();
    }

    // Filter out non-executable statements
    const statements = blockNode.namedChildren.filter(
      (s) =>
        ![
          "line_comment",
          "block_comment",
          "empty_statement",
          "import_declaration",
          "package_clause",
          "type_declaration",
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

      const result = this.processStatement(
        statement,
        exitId,
        loopContext,
        finallyContext
      );

      if (result.nodes.length === 0 && !result.entryNodeId) {
        continue; // Skip empty results
      }

      nodes.push(...result.nodes);
      edges.push(...result.edges);
      result.nodesConnectedToExit.forEach((n) => nodesConnectedToExit.add(n));

      if (!entryNodeId) {
        entryNodeId = result.entryNodeId;
      }

      // Connect the previous statement's exit points to the current statement's entry
      if (lastExitPoints.length > 0 && result.entryNodeId) {
        for (const exitPoint of lastExitPoints) {
          edges.push({
            from: exitPoint.id,
            to: result.entryNodeId,
            label: exitPoint.label,
          });
        }
      }

      // The exit points for the next iteration are the exit points from the statement we just processed
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
    node: Parser.SyntaxNode,
    exitId: string,
    loopContext?: LoopContext,
    finallyContext?: { finallyEntryId: string }
  ): ProcessResult {
    switch (node.type) {
      case "short_var_declaration":
      case "var_declaration":
      case "const_declaration":
      case "assignment_statement":
        return this.processAssignmentLike(node);
      case "call_expression":
        return this.processCall(node);
      case "if_statement":
        return this.processIf(node, exitId, loopContext, finallyContext);
      case "for_statement":
        return this.processFor(node);
      case "range_clause": // Go's for-range loop
        return this.processForRange(node, exitId, finallyContext);
      case "switch_statement":
        return this.processSwitchStatement(
          node,
          exitId,
          loopContext,
          finallyContext
        );
      case "type_switch_statement":
        return this.processTypeSwitchStatement(
          node,
          exitId,
          loopContext,
          finallyContext
        );
      case "select_statement":
        return this.processSelectStatement(
          node,
          exitId,
          loopContext,
          finallyContext
        );
      case "return_statement":
        return this.processReturn(node, exitId);
      case "break_statement":
        return this.processBreakStatement(node, loopContext);
      case "continue_statement":
        return this.processContinueStatement(node, loopContext);
      case "goto_statement":
        return this.processGotoStatement(node);
      case "labeled_statement":
        return this.processLabeledStatement(
          node,
          exitId,
          loopContext,
          finallyContext
        );
      case "defer_statement":
        return this.processDeferStatement(node);
      case "go_statement":
        return this.processGoStatement(node);
      case "panic_statement":
      case "panic":
        return this.processPanicStatement(node, exitId);
      case "expression_statement":
        return this.processExpressionStatement(node);
      case "block":
        return this.processBlock(node, exitId, loopContext, finallyContext);
      default:
        return this.processDefaultStatement(node);
    }
  }

  private wrapAsProcess(node: Parser.SyntaxNode): ProcessResult {
    const result = this.createProcessResult();
    const id = this.generateNodeId("n");
    result.nodes.push(
      this.createSemanticNode(
        id,
        this.summarizeNode(node),
        NodeType.PROCESS,
        node
      )
    );
    result.entryNodeId = id;
    return result;
  }

  private processAssignmentLike(node: Parser.SyntaxNode): ProcessResult {
    const result = this.createProcessResult();
    const id = this.generateNodeId("assign");
    result.nodes.push(
      this.createSemanticNode(
        id,
        this.summarizeNode(node),
        NodeType.ASSIGNMENT,
        node
      )
    );
    result.entryNodeId = id;
    result.exitPoints.push({ id });
    return result;
  }

  private processCall(node: Parser.SyntaxNode): ProcessResult {
    const result = this.createProcessResult();
    const id = this.generateNodeId("call");
    result.nodes.push(
      this.createSemanticNode(
        id,
        this.summarizeNode(node),
        NodeType.FUNCTION_CALL,
        node
      )
    );
    result.entryNodeId = id;
    result.exitPoints.push({ id });
    return result;
  }

  private processReturn(
    node: Parser.SyntaxNode,
    exitId: string
  ): ProcessResult {
    const result = this.createProcessResult();
    const id = this.generateNodeId("ret");
    result.nodes.push(
      this.createSemanticNode(
        id,
        this.summarizeNode(node),
        NodeType.RETURN,
        node
      )
    );
    result.entryNodeId = id;
    // Directly connect return to function exit
    result.edges.push({ from: id, to: exitId });
    result.nodesConnectedToExit.add(id);
    return result;
  }

  private processIf(
    node: Parser.SyntaxNode,
    exitId: string,
    loopContext?: LoopContext,
    finallyContext?: { finallyEntryId: string }
  ): ProcessResult {
    const result = this.createProcessResult();

    const cond = node.childForFieldName("condition");
    const consequence = node.childForFieldName("consequence");
    const alternative = node.childForFieldName("alternative");

    const decisionId = this.generateNodeId("if");
    result.nodes.push(
      this.createSemanticNode(
        decisionId,
        cond ? this.summarizeNode(cond) : "if",
        NodeType.DECISION,
        node
      )
    );
    result.entryNodeId = decisionId;

    const thenRes = consequence
      ? this.processBlock(consequence, exitId, loopContext, finallyContext)
      : this.createProcessResult();
    const elseRes = alternative
      ? this.processBlock(alternative, exitId, loopContext, finallyContext)
      : this.createProcessResult();

    result.nodes.push(...thenRes.nodes, ...elseRes.nodes);
    result.edges.push(...thenRes.edges, ...elseRes.edges);

    // Connect decision to branches
    if (thenRes.entryNodeId) {
      result.edges.push({
        from: decisionId,
        to: thenRes.entryNodeId,
        label: "true",
      });
    } else {
      // No then branch, decision directly exits
      result.exitPoints.push({ id: decisionId, label: "true" });
    }

    if (elseRes.entryNodeId) {
      result.edges.push({
        from: decisionId,
        to: elseRes.entryNodeId,
        label: "false",
      });
    } else {
      // No else branch, decision directly exits
      result.exitPoints.push({ id: decisionId, label: "false" });
    }

    // Collect exit points from both branches
    result.exitPoints.push(...thenRes.exitPoints, ...elseRes.exitPoints);

    // Add nodes connected to exit
    thenRes.nodesConnectedToExit.forEach((id) =>
      result.nodesConnectedToExit.add(id)
    );
    elseRes.nodesConnectedToExit.forEach((id) =>
      result.nodesConnectedToExit.add(id)
    );

    return result;
  }

  private processFor(node: Parser.SyntaxNode): ProcessResult {
    const result = this.createProcessResult();
    const header = this.summarizeForHeader(node);
    const loopId = this.generateNodeId("for");

    result.nodes.push(
      this.createSemanticNode(loopId, header, NodeType.LOOP_START, node)
    );
    result.entryNodeId = loopId;

    const body = node.childForFieldName("body");
    const loopEndId = this.generateNodeId("for_end");
    result.nodes.push(
      this.createSemanticNode(loopEndId, "Loop End", NodeType.LOOP_END, node)
    );

    if (body) {
      const inner = this.processBlock(body, loopEndId, {
        breakTargetId: loopEndId,
        continueTargetId: loopId,
      });
      result.nodes.push(...inner.nodes);
      result.edges.push(...inner.edges);

      if (inner.entryNodeId) {
        result.edges.push({ from: loopId, to: inner.entryNodeId });
      } else {
        result.edges.push({ from: loopId, to: loopEndId });
      }

      inner.exitPoints.forEach((ep) => {
        if (!inner.nodesConnectedToExit.has(ep.id)) {
          result.edges.push({ from: ep.id, to: loopId });
        }
      });
    } else {
      result.edges.push({ from: loopId, to: loopEndId });
    }

    result.exitPoints.push({ id: loopEndId });
    result.nodesConnectedToExit.add(loopEndId);
    return result;
  }

  private summarizeForHeader(node: Parser.SyntaxNode): string {
    // for (init; cond; post) | for cond | for range
    const rangeClause = node.childForFieldName("clause");
    const cond = node.childForFieldName("condition");
    if (rangeClause) {
      return `for ${this.summarizeNode(rangeClause)}`;
    }
    if (cond) {
      return `for ${this.summarizeNode(cond)}`;
    }
    return "for";
  }

  private summarizeNode(node: Parser.SyntaxNode): string {
    // Prefer concise text; fallback to node.text trimmed
    switch (node.type) {
      case "short_var_declaration":
      case "assignment_statement":
        return node.text.replace(/\n/g, " ").slice(0, 120);
      case "call_expression":
        return node.text.replace(/\n/g, " ").slice(0, 120);
      case "if_statement":
        return `if ${node.childForFieldName("condition")?.text ?? ""}`;
      case "return_statement":
        return node.text.replace(/\n/g, " ").slice(0, 120);
      default:
        return node.text.replace(/\n/g, " ").slice(0, 120);
    }
  }

  private extractFunctionName(
    funcNode: Parser.SyntaxNode | undefined
  ): string | undefined {
    if (!funcNode) return undefined;

    // function_declaration: 'func' identifier signature body
    if (funcNode.type === "function_declaration") {
      const nameNode =
        funcNode.childForFieldName("name") ||
        funcNode.namedChildren.find((c) => c.type === "identifier");
      return nameNode?.text;
    }

    // method_declaration: 'func' receiver identifier signature body
    if (funcNode.type === "method_declaration") {
      const nameNode =
        funcNode.childForFieldName("name") ||
        funcNode.namedChildren.find(
          (c) => c.type === "field_identifier" || c.type === "identifier"
        );
      const receiverNode = funcNode.childForFieldName("receiver");

      if (nameNode && receiverNode) {
        // Extract receiver type
        const receiverType = this.extractReceiverType(receiverNode);
        return receiverType
          ? `${receiverType}.${nameNode.text}`
          : nameNode.text;
      }

      return nameNode?.text;
    }

    return undefined;
  }

  private extractReceiverType(
    receiverNode: Parser.SyntaxNode
  ): string | undefined {
    // receiver: '(' [identifier] type_identifier ')'
    const typeNode = receiverNode.namedChildren.find(
      (c) => c.type === "type_identifier" || c.type === "pointer_type"
    );

    if (typeNode?.type === "pointer_type") {
      const innerType = typeNode.namedChildren.find(
        (c) => c.type === "type_identifier"
      );
      return innerType ? `*${innerType.text}` : "*unknown";
    }

    return typeNode?.text;
  }

  private processForRange(
    node: Parser.SyntaxNode,
    exitId: string,
    finallyContext?: { finallyEntryId: string }
  ): ProcessResult {
    const result = this.createProcessResult();
    const header = `for range ${this.summarizeNode(node)}`;
    const loopId = this.generateNodeId("for_range");

    result.nodes.push(
      this.createSemanticNode(loopId, header, NodeType.LOOP_START, node)
    );
    result.entryNodeId = loopId;

    const body = node.childForFieldName("body");
    const loopEndId = this.generateNodeId("for_range_end");
    result.nodes.push(
      this.createSemanticNode(
        loopEndId,
        "Range Loop End",
        NodeType.LOOP_END,
        node
      )
    );

    if (body) {
      const inner = this.processBlock(
        body,
        loopEndId,
        {
          breakTargetId: loopEndId,
          continueTargetId: loopId,
        },
        finallyContext
      );
      result.nodes.push(...inner.nodes);
      result.edges.push(...inner.edges);

      if (inner.entryNodeId) {
        result.edges.push({ from: loopId, to: inner.entryNodeId });
      } else {
        result.edges.push({ from: loopId, to: loopEndId });
      }

      inner.exitPoints.forEach((ep) => {
        if (!inner.nodesConnectedToExit.has(ep.id)) {
          result.edges.push({ from: ep.id, to: loopId });
        }
      });
    } else {
      result.edges.push({ from: loopId, to: loopEndId });
    }

    result.exitPoints.push({ id: loopEndId });
    result.nodesConnectedToExit.add(loopEndId);
    return result;
  }

  private processSwitchStatement(
    node: Parser.SyntaxNode,
    exitId: string,
    loopContext?: LoopContext,
    finallyContext?: { finallyEntryId: string }
  ): ProcessResult {
    const result = this.createProcessResult();
    const condition =
      node.childForFieldName("value") || node.childForFieldName("condition");
    const switchId = this.generateNodeId("switch");

    result.nodes.push(
      this.createSemanticNode(
        switchId,
        `switch ${condition ? this.summarizeNode(condition) : ""}`,
        NodeType.DECISION,
        node
      )
    );
    result.entryNodeId = switchId;

    const body = node.childForFieldName("body");
    if (body) {
      const cases = body.namedChildren.filter(
        (child) => child.type === "case_clause" || child.type === "default_case"
      );

      let lastCaseExitPoints: { id: string; label?: string }[] = [];
      let allExitPoints: { id: string; label?: string }[] = [];

      for (let i = 0; i < cases.length; i++) {
        const caseNode = cases[i];
        const caseId = this.generateNodeId(
          caseNode.type === "default_case" ? "default" : "case"
        );
        const caseLabel =
          caseNode.type === "default_case"
            ? "default"
            : `case ${caseNode.childForFieldName("value")?.text || ""}`;

        result.nodes.push(
          this.createSemanticNode(caseId, caseLabel, NodeType.PROCESS, caseNode)
        );

        // Connect from switch or previous case
        if (i === 0) {
          result.edges.push({ from: switchId, to: caseId });
        } else {
          lastCaseExitPoints.forEach((ep) => {
            result.edges.push({
              from: ep.id,
              to: caseId,
              label: ep.label || "fallthrough",
            });
          });
        }

        // Process case body
        const caseBody = caseNode.namedChildren.find(
          (child) => child.type === "statement_list"
        );
        if (caseBody) {
          const caseResult = this.processBlock(
            caseBody,
            exitId,
            loopContext,
            finallyContext
          );
          result.nodes.push(...caseResult.nodes);
          result.edges.push(...caseResult.edges);

          if (caseResult.entryNodeId) {
            result.edges.push({ from: caseId, to: caseResult.entryNodeId });
          }

          lastCaseExitPoints = caseResult.exitPoints;
          allExitPoints.push(...caseResult.exitPoints);
        } else {
          lastCaseExitPoints = [{ id: caseId }];
          allExitPoints.push({ id: caseId });
        }
      }

      result.exitPoints.push(...allExitPoints);
    } else {
      result.exitPoints.push({ id: switchId });
    }

    return result;
  }

  private processTypeSwitchStatement(
    node: Parser.SyntaxNode,
    exitId: string,
    loopContext?: LoopContext,
    finallyContext?: { finallyEntryId: string }
  ): ProcessResult {
    // Type switch is similar to switch but with type assertions
    const result = this.createProcessResult();
    const switchId = this.generateNodeId("type_switch");

    result.nodes.push(
      this.createSemanticNode(switchId, "type switch", NodeType.DECISION, node)
    );
    result.entryNodeId = switchId;
    result.exitPoints.push({ id: switchId });

    return result;
  }

  private processSelectStatement(
    node: Parser.SyntaxNode,
    exitId: string,
    loopContext?: LoopContext,
    finallyContext?: { finallyEntryId: string }
  ): ProcessResult {
    // Select statement for channel operations
    const result = this.createProcessResult();
    const selectId = this.generateNodeId("select");

    result.nodes.push(
      this.createSemanticNode(selectId, "select", NodeType.DECISION, node)
    );
    result.entryNodeId = selectId;
    result.exitPoints.push({ id: selectId });

    return result;
  }

  private processBreakStatement(
    node: Parser.SyntaxNode,
    loopContext?: LoopContext
  ): ProcessResult {
    const result = this.createProcessResult();
    const id = this.generateNodeId("break");

    result.nodes.push(
      this.createSemanticNode(id, "break", NodeType.BREAK_CONTINUE, node)
    );
    result.entryNodeId = id;

    if (loopContext) {
      // Create a direct edge to the break target (loop exit)
      result.edges.push({ from: id, to: loopContext.breakTargetId });
      result.nodesConnectedToExit.add(id);
      // No exit points since the break is directly connected to its target
    } else {
      // If there's no loop context, this break doesn't make sense but we'll handle it gracefully
      result.exitPoints.push({ id });
    }

    return result;
  }

  private processContinueStatement(
    node: Parser.SyntaxNode,
    loopContext?: LoopContext
  ): ProcessResult {
    const result = this.createProcessResult();
    const id = this.generateNodeId("continue");

    result.nodes.push(
      this.createSemanticNode(id, "continue", NodeType.BREAK_CONTINUE, node)
    );
    result.entryNodeId = id;

    if (loopContext) {
      // Create a direct edge to the continue target (loop header)
      result.edges.push({ from: id, to: loopContext.continueTargetId });
      result.nodesConnectedToExit.add(id);
      // No exit points since the continue is directly connected to its target
    } else {
      // If there's no loop context, this continue doesn't make sense but we'll handle it gracefully
      result.exitPoints.push({ id });
    }

    return result;
  }

  private processGotoStatement(node: Parser.SyntaxNode): ProcessResult {
    const result = this.createProcessResult();
    const id = this.generateNodeId("goto");
    const label = node.childForFieldName("label")?.text || "unknown";

    result.nodes.push(
      this.createSemanticNode(id, `goto ${label}`, NodeType.PROCESS, node)
    );
    result.entryNodeId = id;
    result.exitPoints.push({ id });

    return result;
  }

  private processLabeledStatement(
    node: Parser.SyntaxNode,
    exitId: string,
    loopContext?: LoopContext,
    finallyContext?: { finallyEntryId: string }
  ): ProcessResult {
    const result = this.createProcessResult();
    const label = node.childForFieldName("label")?.text || "unknown";
    const labelId = this.generateNodeId("label");

    result.nodes.push(
      this.createSemanticNode(labelId, `${label}:`, NodeType.PROCESS, node)
    );
    result.entryNodeId = labelId;

    const statement = node.namedChildren.find(
      (child) => child.type !== "label_name"
    );
    if (statement) {
      const stmtResult = this.processStatement(
        statement,
        exitId,
        loopContext,
        finallyContext
      );
      result.nodes.push(...stmtResult.nodes);
      result.edges.push(...stmtResult.edges);

      if (stmtResult.entryNodeId) {
        result.edges.push({ from: labelId, to: stmtResult.entryNodeId });
      }

      result.exitPoints.push(...stmtResult.exitPoints);
      stmtResult.nodesConnectedToExit.forEach((id) =>
        result.nodesConnectedToExit.add(id)
      );
    } else {
      result.exitPoints.push({ id: labelId });
    }

    return result;
  }

  private processDeferStatement(node: Parser.SyntaxNode): ProcessResult {
    const result = this.createProcessResult();
    const id = this.generateNodeId("defer");

    result.nodes.push(
      this.createSemanticNode(
        id,
        `defer ${this.summarizeNode(node)}`,
        NodeType.ASYNC_OPERATION,
        node
      )
    );
    result.entryNodeId = id;
    result.exitPoints.push({ id });

    return result;
  }

  private processGoStatement(node: Parser.SyntaxNode): ProcessResult {
    const result = this.createProcessResult();
    const id = this.generateNodeId("go");

    result.nodes.push(
      this.createSemanticNode(
        id,
        `go ${this.summarizeNode(node)}`,
        NodeType.ASYNC_OPERATION,
        node
      )
    );
    result.entryNodeId = id;
    result.exitPoints.push({ id });

    return result;
  }

  private processPanicStatement(
    node: Parser.SyntaxNode,
    exitId: string
  ): ProcessResult {
    const result = this.createProcessResult();
    const id = this.generateNodeId("panic");

    result.nodes.push(
      this.createSemanticNode(
        id,
        `panic(${this.summarizeNode(node)})`,
        NodeType.PANIC,
        node
      )
    );
    result.entryNodeId = id;
    // Directly connect panic to function exit
    result.edges.push({ from: id, to: exitId });
    result.nodesConnectedToExit.add(id);

    return result;
  }

  private processExpressionStatement(node: Parser.SyntaxNode): ProcessResult {
    const result = this.createProcessResult();
    const id = this.generateNodeId("expr");

    result.nodes.push(
      this.createSemanticNode(
        id,
        this.summarizeNode(node),
        NodeType.PROCESS,
        node
      )
    );
    result.entryNodeId = id;
    result.exitPoints.push({ id });

    return result;
  }

  private findLastNodeId(result: ProcessResult): string | undefined {
    if (result.exitPoints.length > 0) {
      return result.exitPoints[result.exitPoints.length - 1].id;
    }
    if (result.nodes.length > 0) {
      return result.nodes[result.nodes.length - 1].id;
    }
    return undefined;
  }
}
