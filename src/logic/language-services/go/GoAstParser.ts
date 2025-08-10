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

// Minimal Go parser: functions, if, for, return, break/continue, basic statements.
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
      return tree.rootNode
        .descendantsOfType(["function_declaration", "method_declaration"])
        .map(
          (f: Parser.SyntaxNode) => this.extractFunctionName(f) || "[anonymous]"
        );
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
    return func ? this.extractFunctionName(func) || "[anonymous]" : undefined;
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
          this.createSemanticNode("msg", "Place cursor in a function.", NodeType.PROCESS),
        ],
        edges: [],
        locationMap: [],
      };
    }

    const funcNameStr = this.escapeString(this.extractFunctionName(targetNode) || "[anonymous]");
    const title = `Flowchart for function: ${funcNameStr}`;
    const body = targetNode.childForFieldName("body");

    const nodes: FlowchartNode[] = [];
    const edges: FlowchartEdge[] = [];
    const entryId = this.generateNodeId("start");
    const exitId = this.generateNodeId("end");

    nodes.push(this.createSemanticNode(entryId, "Start", NodeType.ENTRY, targetNode));
    nodes.push(this.createSemanticNode(exitId, "End", NodeType.EXIT, targetNode));
    this.locationMap.push({ start: targetNode.startIndex, end: targetNode.endIndex, nodeId: entryId });
    this.locationMap.push({ start: targetNode.startIndex, end: targetNode.endIndex, nodeId: exitId });

    if (!body) {
        const ir: FlowchartIR = { nodes, edges: [{ from: entryId, to: exitId }], entryNodeId: entryId, exitNodeId: exitId, locationMap: this.locationMap, title };
        this.addFunctionComplexity(ir, targetNode);
        return ir;
    }

    const bodyRes = this.processBlock(body, exitId);
    nodes.push(...bodyRes.nodes);
    edges.push(...bodyRes.edges);
    edges.push(bodyRes.entryNodeId ? { from: entryId, to: bodyRes.entryNodeId } : { from: entryId, to: exitId });
    bodyRes.exitPoints.forEach((ep) => {
        if (!bodyRes.nodesConnectedToExit.has(ep.id))
            edges.push({ from: ep.id, to: exitId, label: ep.label });
    });

    const idSet = new Set(nodes.map((n) => n.id));
    const validEdges = edges.filter((e) => idSet.has(e.from) && idSet.has(e.to));
    const filteredLocationMap = this.locationMap.filter((lm) => idSet.has(lm.nodeId));
    
    const ir: FlowchartIR = { nodes, edges: validEdges, entryNodeId: entryId, exitNodeId: exitId, locationMap: filteredLocationMap, title };
    this.addFunctionComplexity(ir, targetNode);
    return ir;
  }

  private processStatementList(
    statements: Parser.SyntaxNode[],
    exitId: string,
    loopContext?: LoopContext
  ): ProcessResult {
    if (statements.length === 0) return this.createProcessResult();

    const nodes: FlowchartNode[] = [];
    const edges: FlowchartEdge[] = [];
    const nodesConnectedToExit = new Set<string>();
    let entryNodeId: string | undefined;
    let lastExitPoints: { id: string; label?: string }[] = [];

    for (const st of statements) {
      if (st.type === 'fallthrough_statement') continue;
      
      const res = this.processStatement(st, exitId, loopContext);
      if (res.nodes.length === 0 && !res.entryNodeId) continue;
      
      nodes.push(...res.nodes);
      edges.push(...res.edges);
      res.nodesConnectedToExit.forEach((n) => nodesConnectedToExit.add(n));
      
      if (!entryNodeId) {
        entryNodeId = res.entryNodeId;
      }
      
      if (lastExitPoints.length > 0 && res.entryNodeId) {
        for (const ep of lastExitPoints) {
          edges.push({ from: ep.id, to: res.entryNodeId, label: ep.label });
        }
      }
      
      lastExitPoints = res.exitPoints;
      
      if (res.entryNodeId && lastExitPoints.length === 0) {
        break; 
      }
    }

    return this.createProcessResult(nodes, edges, entryNodeId, lastExitPoints, nodesConnectedToExit);
  }
  
  protected processBlock(
    blockNode: Parser.SyntaxNode | null,
    exitId: string,
    loopContext?: LoopContext,
  ): ProcessResult {
    if (!blockNode) {
      return this.createProcessResult();
    }
    const statements = blockNode.namedChildren.filter(s => !["line_comment", "block_comment", "comment", "empty_statement", "import_declaration", "package_clause", "type_declaration"].includes(s.type));
    return this.processStatementList(statements, exitId, loopContext);
  }

  protected processStatement(
    node: Parser.SyntaxNode,
    exitId: string,
    loopContext?: LoopContext
  ): ProcessResult {
    switch (node.type) {
      case "comment":
      case "line_comment":
      case "block_comment":
        return this.createProcessResult();
      case "short_var_declaration":
      case "var_declaration":
      case "const_declaration":
      case "assignment_statement":
      case "inc_dec_statement":
        return this.processAssignmentLike(node);
      case "call_expression":
        return this.processCall(node);
      case "expression_statement":
        return this.processExpression(node);
      case "if_statement":
        return this.processIf(node, exitId, loopContext);
      case "for_statement":
        return this.processFor(node, exitId);
      case "expression_switch_statement":
      case "type_switch_statement":
      case "switch_statement":
        return this.processSwitch(node, exitId, loopContext);
      case "select_statement":
        return this.processSelect(node, exitId, loopContext);
      case "go_statement":
        return this.processGo(node, exitId, loopContext);
      case "return_statement":
        return this.processReturn(node, exitId);
      case "break_statement":
        return this.processBreak(node, loopContext);
      case "continue_statement":
        return this.processContinue(node, loopContext);
      case "block":
        return this.processBlock(node, exitId, loopContext);
      default:
        return this.processDefaultStatement(node);
    }
  }

  private processAssignmentLike(node: Parser.SyntaxNode): ProcessResult {
    const result = this.createProcessResult();
    const id = this.generateNodeId("assign");
    result.nodes.push(
      this.createSemanticNode(id, this.summarizeNode(node), NodeType.ASSIGNMENT, node)
    );
    this.locationMap.push({ start: node.startIndex, end: node.endIndex, nodeId: id });
    result.entryNodeId = id;
    result.exitPoints.push({ id });
    return result;
  }

  private processCall(node: Parser.SyntaxNode): ProcessResult {
    const result = this.createProcessResult();
    const id = this.generateNodeId("call");
    result.nodes.push(
      this.createSemanticNode(id, this.summarizeNode(node), NodeType.FUNCTION_CALL, node)
    );
    this.locationMap.push({ start: node.startIndex, end: node.endIndex, nodeId: id });
    result.entryNodeId = id;
    result.exitPoints.push({ id });
    return result;
  }

  private processExpression(node: Parser.SyntaxNode): ProcessResult {
    const result = this.createProcessResult();
    const id = this.generateNodeId("expr");
    result.nodes.push(
      this.createSemanticNode(id, this.summarizeNode(node), NodeType.PROCESS, node)
    );
    this.locationMap.push({ start: node.startIndex, end: node.endIndex, nodeId: id });
    result.entryNodeId = id;
    result.exitPoints.push({ id });
    return result;
  }

  private processReturn(node: Parser.SyntaxNode, exitId: string): ProcessResult {
    const result = this.createProcessResult();
    const id = this.generateNodeId("ret");
    result.nodes.push(
      this.createSemanticNode(id, this.summarizeNode(node), NodeType.RETURN, node)
    );
    this.locationMap.push({ start: node.startIndex, end: node.endIndex, nodeId: id });
    result.entryNodeId = id;
    result.edges.push({ from: id, to: exitId });
    result.nodesConnectedToExit.add(id);
    return result;
  }

  private processIf(
    node: Parser.SyntaxNode,
    exitId: string,
    loopContext?: LoopContext
  ): ProcessResult {
    const result = this.createProcessResult();
    const initializer = node.childForFieldName("initializer");
    const cond = node.childForFieldName("condition");
    const thenBlock = node.childForFieldName("consequence");
    const elseNode = node.childForFieldName("alternative");

    const decisionId = this.generateNodeId("if");
    result.nodes.push(
      this.createSemanticNode(decisionId, cond ? this.summarizeNode(cond) : "if", NodeType.DECISION, node)
    );
    this.locationMap.push({ start: node.startIndex, end: node.endIndex, nodeId: decisionId });

    if (initializer) {
      const initRes = this.processStatement(initializer, exitId, loopContext);
      result.nodes.push(...initRes.nodes);
      result.edges.push(...initRes.edges);
      if (initRes.entryNodeId) {
        result.entryNodeId = initRes.entryNodeId;
        initRes.exitPoints.forEach((ep) => {
            result.edges.push({ from: ep.id, to: decisionId });
        });
      }
    } else {
      result.entryNodeId = decisionId;
    }

    const thenRes = thenBlock ? this.processBlock(thenBlock, exitId, loopContext) : this.createProcessResult();
    let elseRes = this.createProcessResult();
    if (elseNode) {
      elseRes = elseNode.type === "if_statement" ? this.processIf(elseNode, exitId, loopContext) : this.processBlock(elseNode, exitId, loopContext);
    }

    result.nodes.push(...thenRes.nodes, ...elseRes.nodes);
    result.edges.push(...thenRes.edges, ...elseRes.edges);
    if (thenRes.entryNodeId)
      result.edges.push({ from: decisionId, to: thenRes.entryNodeId, label: "true" });
    else result.exitPoints.push({ id: decisionId, label: "true" });

    if (elseRes.entryNodeId) {
      result.edges.push({ from: decisionId, to: elseRes.entryNodeId, label: "false" });
    } else {
      result.exitPoints.push({ id: decisionId, label: "false" });
    }

    result.exitPoints.push(...thenRes.exitPoints, ...elseRes.exitPoints);
    thenRes.nodesConnectedToExit.forEach((n) => result.nodesConnectedToExit.add(n));
    elseRes.nodesConnectedToExit.forEach((n) => result.nodesConnectedToExit.add(n));
    return result;
  }

  private processFor(node: Parser.SyntaxNode, exitId: string): ProcessResult {
    const result = this.createProcessResult();
    const clauseNode = node.children.find(c => c.type === 'for_clause' || c.type === 'range_clause');
    const initializer = clauseNode?.childForFieldName("initializer") || node.childForFieldName("initializer");
    const cond = clauseNode?.childForFieldName("condition") || node.childForFieldName("condition");
    const update = clauseNode?.childForFieldName("update") || node.childForFieldName("update");
    const isRange = clauseNode?.type === "range_clause";
    const body = node.childForFieldName("body");

    let lastId: string | undefined;
    if (initializer) {
      const initRes = this.processStatement(initializer, exitId);
      result.nodes.push(...initRes.nodes);
      result.edges.push(...initRes.edges);
      if (initRes.exitPoints.length > 0) lastId = initRes.exitPoints[0].id;
      result.entryNodeId = initRes.entryNodeId;
    }

    const headerId = this.generateNodeId("for");
    const headerText = this.summarizeForHeader(node);
    result.nodes.push(this.createSemanticNode(headerId, headerText, NodeType.LOOP_START, node));
    this.locationMap.push({ start: node.startIndex, end: node.endIndex, nodeId: headerId });
    if (!result.entryNodeId) result.entryNodeId = headerId;
    if (lastId) result.edges.push({ from: lastId, to: headerId });

    const endId = this.generateNodeId("for_end");
    let continueTargetId = headerId;
    if (update) {
      const updateId = this.generateNodeId("for_update");
      result.nodes.push(this.createSemanticNode(updateId, this.summarizeNode(update), NodeType.PROCESS, update));
      this.locationMap.push({ start: update.startIndex, end: update.endIndex, nodeId: updateId });
      result.edges.push({ from: updateId, to: headerId });
      continueTargetId = updateId;
    }

    let hasBreakToEnd = false;
    if (body) {
      const inner = this.processBlock(body, exitId, { breakTargetId: endId, continueTargetId });
      result.nodes.push(...inner.nodes);
      result.edges.push(...inner.edges);
      if (inner.entryNodeId) {
        result.edges.push({ from: headerId, to: inner.entryNodeId, label: cond ? "true" : "loop" });
      } else {
        result.edges.push({ from: headerId, to: continueTargetId, label: cond ? "true" : "loop" });
      }
      inner.exitPoints.forEach((ep) => {
        if (!inner.nodesConnectedToExit.has(ep.id)) {
          result.edges.push({ from: ep.id, to: continueTargetId });
        }
      });
      hasBreakToEnd = inner.edges.some((e) => e.to === endId);
    } else {
      result.edges.push({ from: headerId, to: continueTargetId, label: cond ? "true" : "loop" });
    }

    const needsEnd = !!cond || isRange || hasBreakToEnd;
    if (needsEnd) {
      result.nodes.push(this.createSemanticNode(endId, "Loop End", NodeType.LOOP_END, node));
      this.locationMap.push({ start: node.endIndex -1, end: node.endIndex, nodeId: endId });
      if (cond || isRange) {
        result.edges.push({ from: headerId, to: endId, label: cond ? "false" : "end" });
      }
      result.exitPoints.push({ id: endId });
    }
    return result;
  }

  private processSwitch(
    node: Parser.SyntaxNode,
    exitId: string,
    loopContext?: LoopContext
  ): ProcessResult {
    const result = this.createProcessResult();
    const switchId = this.generateNodeId("switch");
    const endId = this.generateNodeId("switch_end");

    const condition = node.childForFieldName("condition") || node.childForFieldName("value");
    const label = condition ? `switch ${this.summarizeNode(condition)}` : "switch";

    result.nodes.push(this.createSemanticNode(switchId, label, NodeType.DECISION, node));
    result.entryNodeId = switchId;
    result.nodes.push(this.createSemanticNode(endId, "End Switch", NodeType.MERGE, node));

    // The case clauses are direct named children of the switch statement node itself.
    const clauses = node.namedChildren.filter(
      c => c.type === "expression_case" || c.type === "default_case" || c.type === "type_case_clause"
    );
    
    if (clauses.length === 0) {
      result.edges.push({ from: switchId, to: endId });
      result.exitPoints.push({ id: endId });
      return result;
    }

    const clauseInfo = new Map<Parser.SyntaxNode, { bodyRes: ProcessResult; hasFallthrough: boolean }>();
    
    clauses.forEach(clause => {
      const expressionsNode = clause.childForFieldName("expressions") || clause.childForFieldName("type");
      const statements = clause.namedChildren.filter(c => c.id !== expressionsNode?.id);
      const hasFallthrough = statements.some(s => s.type === 'fallthrough_statement');
      const bodyStmts = statements.filter(s => s.type !== 'fallthrough_statement');
      const bodyRes = this.processStatementList(bodyStmts, exitId, loopContext);
      clauseInfo.set(clause, { bodyRes, hasFallthrough });
    });

    clauses.forEach((clause, index) => {
      const info = clauseInfo.get(clause)!;
      result.nodes.push(...info.bodyRes.nodes);
      result.edges.push(...info.bodyRes.edges);

      const isDefault = clause.type === "default_case";
      const expressions = clause.childForFieldName("expressions") || clause.childForFieldName("type");
      const rawCaseLabel = isDefault ? "default" : `case ${this.summarizeNode(expressions || clause)}`;
      const caseLabel = this.escapeString(rawCaseLabel);
      
      let branchTargetId = info.bodyRes.entryNodeId;
      if (!branchTargetId && info.hasFallthrough) {
        const nextClause = clauses[index + 1];
        if (nextClause) branchTargetId = clauseInfo.get(nextClause)?.bodyRes.entryNodeId;
      }
      branchTargetId = branchTargetId || endId;
      result.edges.push({ from: switchId, to: branchTargetId, label: caseLabel });
      
      let exitTargetId = endId;
      if (info.hasFallthrough) {
        const nextClause = clauses[index + 1];
        if (nextClause) {
          let nextEntryId: string | undefined;
          for (let j = index + 1; j < clauses.length; j++) {
            nextEntryId = clauseInfo.get(clauses[j])!.bodyRes.entryNodeId;
            if (nextEntryId) break;
          }
          exitTargetId = nextEntryId || endId;
        }
      }
      
      info.bodyRes.exitPoints.forEach(ep => {
        if (!info.bodyRes.nodesConnectedToExit.has(ep.id)) {
          result.edges.push({ from: ep.id, to: exitTargetId });
        }
      });
    });

    result.exitPoints.push({ id: endId });
    return result;
  }

  private processSelect(
    node: Parser.SyntaxNode,
    exitId: string,
    loopContext?: LoopContext
  ): ProcessResult {
    const result = this.createProcessResult();
    const selectId = this.generateNodeId("select");
    const endId = this.generateNodeId("select_end");

    result.nodes.push(
      this.createSemanticNode(selectId, "select", NodeType.DECISION, node)
    );
    this.locationMap.push({ start: node.startIndex, end: node.endIndex, nodeId: selectId });
    result.entryNodeId = selectId;
    result.nodes.push(this.createSemanticNode(endId, "End Select", NodeType.MERGE, node));
    this.locationMap.push({ start: node.endIndex - 1, end: node.endIndex, nodeId: endId });

    // FIX: The AST for `select` has `communication_case` nodes as direct children,
    // not nested inside a `block` node.
    const clauses = node.namedChildren.filter(
        (c) => c.type === "communication_case" || c.type === "default_case"
    );

    if (clauses.length === 0) {
        result.edges.push({ from: selectId, to: endId });
        result.exitPoints.push({ id: endId });
        return result;
    }

    for (const clause of clauses) {
      const isDefault = clause.type === "default_case";
      const comm = isDefault ? null : (clause.childForFieldName("communication") || clause.childForFieldName("expression"));
      const caseLabel = isDefault ? "default" : `case ${this.summarizeNode(comm!)}`;
      
      const caseLoopContext: LoopContext = {
        breakTargetId: endId,
        continueTargetId: loopContext?.continueTargetId ?? endId,
      };
      
      // The statements are the named children of the clause, excluding the 'communication' part itself.
      const statements = clause.namedChildren.filter(c => c.id !== comm?.id);
      const caseBodyRes = this.processStatementList(statements, exitId, caseLoopContext);

      result.nodes.push(...caseBodyRes.nodes);
      result.edges.push(...caseBodyRes.edges);

      if (caseBodyRes.entryNodeId) {
        result.edges.push({ from: selectId, to: caseBodyRes.entryNodeId, label: caseLabel });
      } else {
        result.edges.push({ from: selectId, to: endId, label: caseLabel });
      }

      caseBodyRes.exitPoints.forEach((ep) => {
        if (!caseBodyRes.nodesConnectedToExit.has(ep.id)) {
          result.edges.push({ from: ep.id, to: endId });
        }
      });
    }

    result.exitPoints.push({ id: endId });
    return result;
  }

  private processGo(
    node: Parser.SyntaxNode,
    exitId: string,
    loopContext?: LoopContext
  ): ProcessResult {
    const result = this.createProcessResult();
    const call = node.childForFieldName("call") || node.namedChildren[0];
    if (!call) return result;

    const goId = this.generateNodeId("go");
    result.nodes.push(
      this.createSemanticNode(goId, `go ${this.summarizeNode(call)}`, NodeType.ASYNC_OPERATION, node)
    );
    this.locationMap.push({ start: node.startIndex, end: node.endIndex, nodeId: goId });
    result.entryNodeId = goId;
    result.exitPoints.push({ id: goId });
    return result;
  }

  private summarizeForHeader(node: Parser.SyntaxNode): string {
    const clauseNode = node.children.find(c => c.type === 'for_clause' || c.type === 'range_clause');
    if (clauseNode?.type === "range_clause") {
      return `for ${this.summarizeNode(clauseNode)}`;
    }
    const cond = clauseNode?.childForFieldName("condition") || node.childForFieldName("condition");
    return cond ? `for ${this.summarizeNode(cond)}` : "for";
  }

  private processBreak(
    node: Parser.SyntaxNode,
    loopContext?: LoopContext
  ): ProcessResult {
    const result = this.createProcessResult();
    const id = this.generateNodeId("break");
    result.nodes.push(this.createSemanticNode(id, "break", NodeType.BREAK_CONTINUE, node));
    this.locationMap.push({ start: node.startIndex, end: node.endIndex, nodeId: id });
    result.entryNodeId = id;
    if (loopContext) {
      result.edges.push({ from: id, to: loopContext.breakTargetId });
      result.nodesConnectedToExit.add(id);
    }
    return result;
  }

  private processContinue(
    node: Parser.SyntaxNode,
    loopContext?: LoopContext
  ): ProcessResult {
    const result = this.createProcessResult();
    const id = this.generateNodeId("continue");
    result.nodes.push(this.createSemanticNode(id, "continue", NodeType.BREAK_CONTINUE, node));
    this.locationMap.push({ start: node.startIndex, end: node.endIndex, nodeId: id });
    result.entryNodeId = id;
    if (loopContext) {
      result.edges.push({ from: id, to: loopContext.continueTargetId });
      result.nodesConnectedToExit.add(id);
    }
    return result;
  }

  private summarizeNode(node: Parser.SyntaxNode): string {
    return node.text.replace(/\s+/g, " ").trim().slice(0, 120);
  }

  private extractFunctionName(
    funcNode: Parser.SyntaxNode | undefined
  ): string | undefined {
    if (!funcNode) return undefined;
    if (funcNode.type === "function_declaration") {
      const nameNode = funcNode.childForFieldName("name") || funcNode.namedChildren.find((c) => c.type === "identifier");
      return nameNode?.text;
    }
    if (funcNode.type === "method_declaration") {
      const nameNode = funcNode.childForFieldName("name") || funcNode.namedChildren.find((c) => c.type === "field_identifier" || c.type === "identifier");
      const receiverNode = funcNode.childForFieldName("receiver");
      if (nameNode && receiverNode) {
        const recvType = this.extractReceiverType(receiverNode);
        return recvType ? `${recvType}.${nameNode.text}` : nameNode.text;
      }
      return nameNode?.text;
    }
    return undefined;
  }

  private extractReceiverType(
    receiverNode: Parser.SyntaxNode
  ): string | undefined {
    const typeNode = receiverNode.namedChildren.find((c) => c.type === "type_identifier" || c.type === "pointer_type");
    if (typeNode?.type === "pointer_type") {
      const innerType = typeNode.namedChildren.find((c) => c.type === "type_identifier");
      return innerType ? `*${innerType.text}` : undefined;
    }
    return typeNode?.text;
  }
}
