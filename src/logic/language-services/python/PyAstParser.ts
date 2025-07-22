import Parser from "tree-sitter";
import Python from "tree-sitter-python";
import { FlowchartIR, FlowchartNode, FlowchartEdge, LocationMapEntry } from "../../../ir/ir";

type PythonLanguage = Parser.Language;

// Optimized string handling (shared with TypeScript parser)
class StringProcessor {
  private static escapeCache = new Map<string, string>();
  private static readonly MAX_CACHE_SIZE = 1000;
  
  // Precompiled regex for better performance
  private static readonly escapeRegex = /"|\\|\n/g;
  private static readonly escapeMap: Record<string, string> = {
    '"': '#quot;', // Python uses #quot; format
    '\\': '\\\\', 
    '\n': ' '
  };

  static escapeString(str: string): string {
    if (!str) return '';
    
    // Check cache first
    const cached = this.escapeCache.get(str);
    if (cached !== undefined) return cached;

    // Clear cache if too large
    if (this.escapeCache.size >= this.MAX_CACHE_SIZE) {
      this.escapeCache.clear();
    }

    let escaped = str.replace(this.escapeRegex, match => this.escapeMap[match]);
    escaped = escaped.replace(/:$/, "").trim();

    // Length limiting for readability
    const MAX_LABEL_LENGTH = 80;
    if (escaped.length > MAX_LABEL_LENGTH) {
      escaped = escaped.substring(0, MAX_LABEL_LENGTH - 3) + "...";
    }

    this.escapeCache.set(str, escaped);
    return escaped;
  }

  static clearCache(): void {
    this.escapeCache.clear();
  }
}

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

export class PyAstParser {
  private nodeIdCounter = 0;
  private locationMap: LocationMapEntry[] = [];
  private currentFunctionIsLambda = false;
  private debug = false;
  private readonly nodeStyles = {
    terminator: "fill:#e8f5e8,stroke:#2e7d32,stroke-width:1.5px,color:#000",
    decision: "fill:#fff3e0,stroke:#f57c00,stroke-width:1.5px,color:#000",
    process: "fill:#f3e5f5,stroke:#7b1fa2,stroke-width:1.5px,color:#000",
    special: "fill:#e3f2fd,stroke:#0d47a1,stroke-width:1.5px,color:#000",
    break: "fill:#ffebee,stroke:#c62828,stroke-width:1.5px,color:#000",
    hof: "fill:#e8eaf6,stroke:#3f51b5,stroke-width:1.5px,color:#000",
  };

  private log(message: string, ...args: any[]) {
    if (this.debug) console.log(`[PyAstParser] ${message}`, ...args);
  }

  private generateNodeId(prefix: string): string {
    return `${prefix}_${this.nodeIdCounter++}`;
  }

  private escapeString(str: string): string {
    return StringProcessor.escapeString(str);
  }

  public listFunctions(sourceCode: string): string[] {
    const parser = new Parser();
    parser.setLanguage(Python as PythonLanguage);
    const tree = parser.parse(sourceCode);

    const funcNames = tree.rootNode.descendantsOfType("function_definition")
      .map((f: Parser.SyntaxNode) => f.childForFieldName("name")?.text || "[anonymous]");

    const lambdaNames = tree.rootNode.descendantsOfType("assignment")
      .filter(a => a.childForFieldName("right")?.type === "lambda")
      .map(a => a.childForFieldName("left")?.text || "[anonymous lambda]");

    return [...funcNames, ...lambdaNames];
  }

  public findFunctionAtPosition(sourceCode: string, position: number): string | undefined {
    const parser = new Parser();
    parser.setLanguage(Python as PythonLanguage);
    const tree = parser.parse(sourceCode);

    const func = tree.rootNode.descendantsOfType("function_definition")
      .find(f => position >= f.startIndex && position <= f.endIndex);
    if (func) return func.childForFieldName("name")?.text || "[anonymous]";

    const lambda = tree.rootNode.descendantsOfType("assignment")
      .find(a => position >= a.startIndex && position <= a.endIndex && a.childForFieldName("right")?.type === "lambda");
    return lambda?.childForFieldName("left")?.text || "[anonymous lambda]";
  }

  private isHofCall(node: Parser.SyntaxNode | null | undefined): boolean {
    if (!node || node.type !== "call") return false;
    const functionName = node.childForFieldName("function")?.text.split(".").pop();
    return ["map", "filter", "reduce"].includes(functionName!);
  }

  private generateHofFlowchart(statementNode: Parser.SyntaxNode, hofCallNode: Parser.SyntaxNode, containerName?: string): FlowchartIR {
    this.nodeIdCounter = 0;
    this.locationMap = [];
    const nodes: FlowchartNode[] = [];
    const edges: FlowchartEdge[] = [];

    const hofResult = this.processHigherOrderFunctionCall(hofCallNode);
    if (!hofResult) return this.generateFlowchart(statementNode.text);

    nodes.push(...hofResult.nodes);
    edges.push(...hofResult.edges);
    let entryPointId = hofResult.entryNodeId;
    let finalExitPoints = hofResult.exitPoints;

    if (["assignment", "expression_statement"].includes(statementNode.type)) {
      const assignment = statementNode.type === "assignment" ? statementNode : statementNode.namedChild(0)!;
      const assignId = this.generateNodeId("assign_hof");
      const leftText = this.escapeString(assignment.childForFieldName("left")!.text);
      nodes.unshift({
        id: assignId,
        label: `${leftText} = ...`,
        shape: "rect",
        style: this.nodeStyles.process,
      });
      if (entryPointId) edges.unshift({ from: assignId, to: entryPointId });
      entryPointId = assignId;
      this.locationMap.push({
        start: assignment.childForFieldName("left")!.startIndex,
        end: assignment.childForFieldName("left")!.endIndex,
        nodeId: assignId,
      });
    }

    if (containerName) {
      const convertId = this.generateNodeId("convert");
      nodes.push({
        id: convertId,
        label: `Convert to ${containerName}`,
        shape: "rect",
        style: this.nodeStyles.process,
      });
      finalExitPoints.forEach(ep => edges.push({ from: ep.id, to: convertId, label: ep.label }));
      finalExitPoints = [{ id: convertId }];
    }

    const startId = this.generateNodeId("start");
    const endId = this.generateNodeId("end");
    nodes.unshift({ id: startId, label: "Start", shape: "round", style: this.nodeStyles.terminator });
    nodes.push({ id: endId, label: "End", shape: "round", style: this.nodeStyles.terminator });

    edges.unshift(entryPointId ? { from: startId, to: entryPointId } : { from: startId, to: endId });
    finalExitPoints.forEach(ep => edges.push({ from: ep.id, to: endId, label: ep.label }));

    return {
      nodes,
      edges,
      locationMap: this.locationMap,
      functionRange: { start: statementNode.startIndex, end: statementNode.endIndex },
      title: `Flowchart for: ${this.escapeString(statementNode.text)}`,
      entryNodeId: startId,
      exitNodeId: endId,
    };
  }

  public generateFlowchart(sourceCode: string, functionName?: string, position?: number): FlowchartIR {
    const parser = new Parser();
    parser.setLanguage(Python as PythonLanguage);
    const tree = parser.parse(sourceCode);

    if (position !== undefined) {
      const statements = tree.rootNode.descendantsOfType(["assignment", "expression_statement", "return_statement"]);
      const smallestStatement = statements.reduce<Parser.SyntaxNode | undefined>((smallest, stmt) => {
        if (position >= stmt.startIndex && position <= stmt.endIndex && 
            (!smallest || stmt.endIndex - stmt.startIndex < smallest.endIndex - smallest.startIndex)) {
          return stmt;
        }
        return smallest;
      }, undefined);

      if (smallestStatement) {
        let potentialCallNode: Parser.SyntaxNode | null | undefined;
        let baseStatement = smallestStatement;

        if (smallestStatement.type === "assignment") {
          potentialCallNode = smallestStatement.childForFieldName("right");
        } else if (smallestStatement.type === "expression_statement") {
          const child = smallestStatement.namedChild(0);
          if (child?.type === "assignment") {
            potentialCallNode = child.childForFieldName("right");
            baseStatement = child;
          } else {
            potentialCallNode = child;
          }
        } else if (smallestStatement.type === "return_statement") {
          potentialCallNode = smallestStatement.namedChild(0);
        }

        if (potentialCallNode?.type === "call") {
          const funcNode = potentialCallNode.childForFieldName("function");
          const funcName = funcNode?.text;
          const args = potentialCallNode.childForFieldName("arguments")?.namedChildren || [];

          if (["list", "tuple", "set"].includes(funcName!) && args.length === 1 && args[0].type === "call" && this.isHofCall(args[0])) {
            return this.generateHofFlowchart(baseStatement, args[0], funcName);
          } else if (this.isHofCall(potentialCallNode)) {
            return this.generateHofFlowchart(baseStatement, potentialCallNode);
          }
        }
      }
    }

    let targetNode: Parser.SyntaxNode | undefined;
    let isLambda = false;

    if (position !== undefined) {
      targetNode = tree.rootNode.descendantsOfType("function_definition")
        .find(f => position >= f.startIndex && position <= f.endIndex);
      
      if (!targetNode) {
        targetNode = tree.rootNode.descendantsOfType("assignment")
          .find(a => position >= a.startIndex && position <= a.endIndex && a.childForFieldName("right")?.type === "lambda");
        isLambda = !!targetNode;
      }
    } else if (functionName) {
      targetNode = tree.rootNode.descendantsOfType("function_definition")
        .find(f => f.childForFieldName("name")?.text === functionName);
      
      if (!targetNode) {
        targetNode = tree.rootNode.descendantsOfType("assignment")
          .find(a => a.childForFieldName("left")?.text === functionName && a.childForFieldName("right")?.type === "lambda");
        isLambda = !!targetNode;
      }
    } else {
      targetNode = tree.rootNode.descendantsOfType("function_definition")[0];
    }

    if (!targetNode) {
      return {
        nodes: [{ id: "A", label: "Place cursor inside a function or statement to generate a flowchart.", shape: "rect" }],
        edges: [],
        locationMap: [],
      };
    }

    this.nodeIdCounter = 0;
    this.locationMap = [];
    this.currentFunctionIsLambda = isLambda;

    const bodyToProcess = isLambda 
      ? targetNode.childForFieldName("right")!.childForFieldName("body")
      : targetNode.childForFieldName("body");

    if (!bodyToProcess) {
      return {
        nodes: [{ id: "A", label: "Function has no body.", shape: "rect" }],
        edges: [],
        locationMap: [],
      };
    }

    const nodes: FlowchartNode[] = [];
    const edges: FlowchartEdge[] = [];
    const entryId = this.generateNodeId("start");
    const exitId = this.generateNodeId("end");

    nodes.push({ id: entryId, label: `Start`, shape: "round", style: this.nodeStyles.terminator });
    nodes.push({ id: exitId, label: "End", shape: "round", style: this.nodeStyles.terminator });

    const bodyResult = isLambda 
      ? this.processStatement(bodyToProcess, exitId)
      : this.processBlock(bodyToProcess, exitId);

    nodes.push(...bodyResult.nodes);
    edges.push(...bodyResult.edges);

    edges.push(bodyResult.entryNodeId 
      ? { from: entryId, to: bodyResult.entryNodeId }
      : { from: entryId, to: exitId });

    bodyResult.exitPoints.forEach(ep => {
      if (!bodyResult.nodesConnectedToExit.has(ep.id)) {
        edges.push({ from: ep.id, to: exitId, label: ep.label });
      }
    });

    const nodeIdSet = new Set(nodes.map(n => n.id));
    const validEdges = edges.filter(e => nodeIdSet.has(e.from) && nodeIdSet.has(e.to));

    return {
      nodes,
      edges: validEdges,
      locationMap: this.locationMap,
      functionRange: { start: targetNode.startIndex, end: targetNode.endIndex },
      title: `Flowchart for ${isLambda ? "lambda" : "function"}: ${this.escapeString(
        isLambda ? targetNode.childForFieldName("left")!.text : targetNode.childForFieldName("name")!.text
      )}`,
      entryNodeId: entryId,
      exitNodeId: exitId,
    };
  }

  private processBlock(
    blockNode: Parser.SyntaxNode | null,
    exitId: string,
    loopContext?: LoopContext,
    finallyContext?: { finallyEntryId: string }
  ): ProcessResult {
    if (!blockNode) return { nodes: [], edges: [], entryNodeId: undefined, exitPoints: [], nodesConnectedToExit: new Set<string>() };

    const statements = blockNode.namedChildren.filter(s => !["pass_statement", "comment", "elif_clause", "else_clause"].includes(s.type));
    if (statements.length === 0) return { nodes: [], edges: [], entryNodeId: undefined, exitPoints: [], nodesConnectedToExit: new Set<string>() };

    const nodes: FlowchartNode[] = [];
    const edges: FlowchartEdge[] = [];
    const nodesConnectedToExit = new Set<string>();
    let entryNodeId: string | undefined;
    let lastExitPoints: { id: string; label?: string }[] = [];

    for (const statement of statements) {
      const result = this.processStatement(statement, exitId, loopContext, finallyContext);
      nodes.push(...result.nodes);
      edges.push(...result.edges);
      result.nodesConnectedToExit.forEach(n => nodesConnectedToExit.add(n));

      if (!entryNodeId) entryNodeId = result.entryNodeId;
      if (lastExitPoints.length > 0 && result.entryNodeId) {
        lastExitPoints.forEach(exitPoint => {
          edges.push({ from: exitPoint.id, to: result.entryNodeId!, label: exitPoint.label });
        });
      }
      lastExitPoints = result.exitPoints;
    }

    return { nodes, edges, entryNodeId, exitPoints: lastExitPoints, nodesConnectedToExit };
  }

  private findHofInExpression(expressionNode: Parser.SyntaxNode): { hofCallNode: Parser.SyntaxNode; containerName?: string } | null {
    if (expressionNode?.type !== "call") return null;
    
    const funcNode = expressionNode.childForFieldName("function");
    const funcName = funcNode?.text;
    const args = expressionNode.childForFieldName("arguments")?.namedChildren || [];
    
    if (["list", "tuple", "set"].includes(funcName!) && args.length === 1 && this.isHofCall(args[0])) {
      return { hofCallNode: args[0], containerName: funcName };
    } else if (this.isHofCall(expressionNode)) {
      return { hofCallNode: expressionNode };
    }
    return null;
  }

  private processStatement(
    statement: Parser.SyntaxNode,
    exitId: string,
    loopContext?: LoopContext,
    finallyContext?: { finallyEntryId: string }
  ): ProcessResult {
    if (statement.type === "conditional_expression") {
      return this.processConditionalExpression(statement, exitId, loopContext, finallyContext);
    }

    switch (statement.type) {
      case "if_statement": return this.processIfStatement(statement, exitId, loopContext, finallyContext);
      case "for_statement": return this.processForStatement(statement, exitId, finallyContext);
      case "while_statement": return this.processWhileStatement(statement, exitId, finallyContext);
      case "try_statement": return this.processTryStatement(statement, exitId, loopContext, finallyContext);
      case "with_statement": return this.processWithStatement(statement, exitId, loopContext, finallyContext);
      case "return_statement": return this.processReturnStatement(statement, exitId, finallyContext);
      case "raise_statement": return this.processRaiseStatement(statement, exitId, finallyContext);
      case "assert_statement": return this.processAssertStatement(statement, exitId, loopContext, finallyContext);
      case "break_statement": return loopContext ? this.processBreakStatement(statement, loopContext) : this.processDefaultStatement(statement);
      case "continue_statement": return loopContext ? this.processContinueStatement(statement, loopContext) : this.processDefaultStatement(statement);
      case "match_statement": return this.processMatchStatement(statement, exitId, loopContext, finallyContext);
      case "pass_statement": return { nodes: [], edges: [], entryNodeId: undefined, exitPoints: [], nodesConnectedToExit: new Set<string>() };
      default: {
        let expressionNode: Parser.SyntaxNode | undefined;
        let assignmentTargetNode: Parser.SyntaxNode | undefined;

        if (statement.type === "assignment") {
          expressionNode = statement.childForFieldName("right") ?? undefined;
          assignmentTargetNode = statement.childForFieldName("left") ?? undefined;
        } else if (statement.type === "expression_statement") {
          const child = statement.firstNamedChild;
          if (child?.type === "assignment") return this.processStatement(child, exitId, loopContext, finallyContext);
          expressionNode = child ?? undefined;
        }

        if (expressionNode) {
          if (expressionNode.type === "conditional_expression" && assignmentTargetNode) {
            const namedChildren = expressionNode.namedChildren;
            if (namedChildren.length < 3) return this.processDefaultStatement(statement);

            const targetText = this.escapeString(assignmentTargetNode.text);
            const [consequenceNode, conditionNode, alternativeNode] = namedChildren;
            const conditionId = this.generateNodeId("cond_expr");
            
            const nodes: FlowchartNode[] = [{
              id: conditionId,
              label: this.escapeString(conditionNode.text),
              shape: "diamond",
              style: this.nodeStyles.decision,
            }];
            const edges: FlowchartEdge[] = []; // FIX: Initialize edges array
            
            this.locationMap.push({ start: conditionNode.startIndex, end: conditionNode.endIndex, nodeId: conditionId });

            // True path
            const consequenceId = this.generateNodeId("ternary_true");
            nodes.push({
              id: consequenceId,
              label: `${targetText} = ${this.escapeString(consequenceNode.text)}`,
              shape: "rect",
              style: this.nodeStyles.process,
            });
            this.locationMap.push({ start: statement.startIndex, end: statement.endIndex, nodeId: consequenceId });
            edges.push({ from: conditionId, to: consequenceId, label: "True" });

            // False path
            const alternativeId = this.generateNodeId("ternary_false");
            nodes.push({
              id: alternativeId,
              label: `${targetText} = ${this.escapeString(alternativeNode.text)}`,
              shape: "rect",
              style: this.nodeStyles.process,
            });
            this.locationMap.push({ start: statement.startIndex, end: statement.endIndex, nodeId: alternativeId });
            edges.push({ from: conditionId, to: alternativeId, label: "False" });

            return {
              nodes,
              edges,
              entryNodeId: conditionId,
              exitPoints: [{ id: consequenceId }, { id: alternativeId }],
              nodesConnectedToExit: new Set<string>(),
            };
          }

          const hofInfo = this.findHofInExpression(expressionNode);
          if (hofInfo) {
            const hofResult = this.processHigherOrderFunctionCall(hofInfo.hofCallNode);
            if (hofResult) {
              let currentEntry = hofResult.entryNodeId;
              let currentExits = hofResult.exitPoints;
              const allNodes = [...hofResult.nodes];
              const allEdges = [...hofResult.edges];

              if (hofInfo.containerName) {
                const convertId = this.generateNodeId("convert");
                allNodes.push({
                  id: convertId,
                  label: `Convert to ${hofInfo.containerName}`,
                  shape: "rect",
                  style: this.nodeStyles.process,
                });
                currentExits.forEach(ep => allEdges.push({ from: ep.id, to: convertId, label: ep.label }));
                currentExits = [{ id: convertId }];
              }

              if (assignmentTargetNode) {
                const assignId = this.generateNodeId("assign_hof");
                allNodes.unshift({
                  id: assignId,
                  label: `${this.escapeString(assignmentTargetNode.text)} = ...`,
                  shape: "rect",
                  style: this.nodeStyles.process,
                });
                if (currentEntry) allEdges.unshift({ from: assignId, to: currentEntry });
                currentEntry = assignId;
              }

              return {
                nodes: allNodes,
                edges: allEdges,
                entryNodeId: currentEntry,
                exitPoints: currentExits,
                nodesConnectedToExit: new Set<string>(),
              };
            }
          }
        }

        return this.currentFunctionIsLambda
          ? this.processReturnStatementForExpression(statement, exitId, finallyContext)
          : this.processDefaultStatement(statement);
      }
    }
  }

  private processDefaultStatement(statement: Parser.SyntaxNode): ProcessResult {
    const nodeId = this.generateNodeId("stmt");
    const nodeText = this.escapeString(statement.text);
    const node: FlowchartNode = {
      id: nodeId,
      label: nodeText,
      shape: "rect",
      style: this.nodeStyles.process,
    };
    this.locationMap.push({ start: statement.startIndex, end: statement.endIndex, nodeId });
    return {
      nodes: [node],
      edges: [],
      entryNodeId: nodeId,
      exitPoints: [{ id: nodeId }],
      nodesConnectedToExit: new Set<string>(),
    };
  }

  private processReturnStatementForExpression(
    exprNode: Parser.SyntaxNode,
    exitId: string,
    finallyContext?: { finallyEntryId: string }
  ): ProcessResult {
    const nodeId = this.generateNodeId("return");
    const labelText = `return ${this.escapeString(exprNode.text)}`;
    const node: FlowchartNode = {
      id: nodeId,
      label: labelText,
      shape: "stadium",
      style: this.nodeStyles.special,
    };
    const edges: FlowchartEdge[] = [{
      from: nodeId,
      to: finallyContext ? finallyContext.finallyEntryId : exitId
    }];
    this.locationMap.push({ start: exprNode.startIndex, end: exprNode.endIndex, nodeId });
    return {
      nodes: [node],
      edges,
      entryNodeId: nodeId,
      exitPoints: [],
      nodesConnectedToExit: new Set<string>([nodeId]),
    };
  }

  private processConditionalExpression(
    condExprNode: Parser.SyntaxNode,
    exitId: string,
    loopContext?: LoopContext,
    finallyContext?: { finallyEntryId: string }
  ): ProcessResult {
    const namedChildren = condExprNode.namedChildren;
    if (namedChildren.length < 3) return this.processDefaultStatement(condExprNode);

    const [consequenceNode, conditionNode, alternativeNode] = namedChildren;
    const conditionId = this.generateNodeId("cond_expr");
    const nodes: FlowchartNode[] = [{
      id: conditionId,
      label: this.escapeString(conditionNode.text),
      shape: "diamond",
      style: this.nodeStyles.decision,
    }];
    this.locationMap.push({ start: conditionNode.startIndex, end: conditionNode.endIndex, nodeId: conditionId });

    const consequenceResult = this.processStatement(consequenceNode, exitId, loopContext, finallyContext);
    const alternativeResult = this.processStatement(alternativeNode, exitId, loopContext, finallyContext);

    nodes.push(...consequenceResult.nodes, ...alternativeResult.nodes);
    const edges: FlowchartEdge[] = [...consequenceResult.edges, ...alternativeResult.edges];
    const nodesConnectedToExit = new Set<string>([...consequenceResult.nodesConnectedToExit, ...alternativeResult.nodesConnectedToExit]);

    if (consequenceResult.entryNodeId) {
      edges.push({ from: conditionId, to: consequenceResult.entryNodeId, label: "True" });
    }
    if (alternativeResult.entryNodeId) {
      edges.push({ from: conditionId, to: alternativeResult.entryNodeId, label: "False" });
    }

    return {
      nodes,
      edges,
      entryNodeId: conditionId,
      exitPoints: this.currentFunctionIsLambda ? [] : [...consequenceResult.exitPoints, ...alternativeResult.exitPoints],
      nodesConnectedToExit,
    };
  }

  private processIfStatement(
    ifNode: Parser.SyntaxNode,
    exitId: string,
    loopContext?: LoopContext,
    finallyContext?: { finallyEntryId: string }
  ): ProcessResult {
    const ifConditionNode = ifNode.childForFieldName("condition");
    const ifConsequenceNode = ifNode.childForFieldName("consequence");
    if (!ifConditionNode || !ifConsequenceNode) return { nodes: [], edges: [], entryNodeId: undefined, exitPoints: [], nodesConnectedToExit: new Set<string>() };

    const ifConditionId = this.generateNodeId("cond");
    const nodes: FlowchartNode[] = [{
      id: ifConditionId,
      label: this.escapeString(ifConditionNode.text),
      shape: "diamond",
      style: this.nodeStyles.decision,
    }];
    this.locationMap.push({ start: ifConditionNode.startIndex, end: ifConditionNode.endIndex, nodeId: ifConditionId });

    const ifConsequenceResult = this.processBlock(ifConsequenceNode, exitId, loopContext, finallyContext);
    nodes.push(...ifConsequenceResult.nodes);
    const edges: FlowchartEdge[] = [...ifConsequenceResult.edges];
    const nodesConnectedToExit = new Set<string>(ifConsequenceResult.nodesConnectedToExit);
    const allExitPoints: { id: string; label?: string }[] = [...ifConsequenceResult.exitPoints];

    if (ifConsequenceResult.entryNodeId) {
      edges.push({ from: ifConditionId, to: ifConsequenceResult.entryNodeId, label: "True" });
    } else {
      allExitPoints.push({ id: ifConditionId, label: "True" });
    }

    let lastConditionId = ifConditionId;
    const alternatives = ifNode.childrenForFieldName("alternative");
    let elseClause: Parser.SyntaxNode | null = null;

    for (const clause of alternatives) {
      if (clause.type === "elif_clause") {
        const elifConditionNode = clause.childForFieldName("condition");
        const elifConsequenceNode = clause.childForFieldName("consequence");
        if (!elifConditionNode || !elifConsequenceNode) continue;

        const elifConditionId = this.generateNodeId("cond");
        nodes.push({
          id: elifConditionId,
          label: this.escapeString(elifConditionNode.text),
          shape: "diamond",
          style: this.nodeStyles.decision,
        });
        this.locationMap.push({ start: elifConditionNode.startIndex, end: elifConditionNode.endIndex, nodeId: elifConditionId });

        edges.push({ from: lastConditionId, to: elifConditionId, label: "False" });
        lastConditionId = elifConditionId;

        const elifConsequenceResult = this.processBlock(elifConsequenceNode, exitId, loopContext, finallyContext);
        nodes.push(...elifConsequenceResult.nodes);
        edges.push(...elifConsequenceResult.edges);
        elifConsequenceResult.nodesConnectedToExit.forEach(n => nodesConnectedToExit.add(n));

        if (elifConsequenceResult.entryNodeId) {
          edges.push({ from: elifConditionId, to: elifConsequenceResult.entryNodeId, label: "True" });
        } else {
          allExitPoints.push({ id: elifConditionId, label: "True" });
        }
        allExitPoints.push(...elifConsequenceResult.exitPoints);
      } else if (clause.type === "else_clause") {
        elseClause = clause;
        break;
      }
    }

    if (elseClause) {
      const elseResult = this.processBlock(elseClause.childForFieldName("body"), exitId, loopContext, finallyContext);
      nodes.push(...elseResult.nodes);
      edges.push(...elseResult.edges);
      elseResult.nodesConnectedToExit.forEach(n => nodesConnectedToExit.add(n));

      if (elseResult.entryNodeId) {
        edges.push({ from: lastConditionId, to: elseResult.entryNodeId, label: "False" });
      } else {
        allExitPoints.push({ id: lastConditionId, label: "False" });
      }
      allExitPoints.push(...elseResult.exitPoints);
    } else {
      allExitPoints.push({ id: lastConditionId, label: "False" });
    }

    return {
      nodes,
      edges,
      entryNodeId: ifConditionId,
      exitPoints: allExitPoints,
      nodesConnectedToExit,
    };
  }

  private processForStatement(
    forNode: Parser.SyntaxNode,
    exitId: string,
    finallyContext?: { finallyEntryId: string }
  ): ProcessResult {
    const left = forNode.childForFieldName("left")!.text;
    const right = forNode.childForFieldName("right")!.text;
    const headerId = this.generateNodeId("for_header");
    const loopExitId = this.generateNodeId("for_exit");

    const nodes: FlowchartNode[] = [
      {
        id: headerId,
        label: this.escapeString(`for ${left} in ${right}`),
        shape: "diamond",
        style: this.nodeStyles.decision,
      },
      { id: loopExitId, label: "end loop", shape: "stadium" }
    ];
    this.locationMap.push({ start: forNode.startIndex, end: forNode.endIndex, nodeId: headerId });

    const loopContext: LoopContext = { breakTargetId: loopExitId, continueTargetId: headerId };
    const bodyResult = this.processBlock(forNode.childForFieldName("body")!, exitId, loopContext, finallyContext);
    nodes.push(...bodyResult.nodes);
    const edges: FlowchartEdge[] = [...bodyResult.edges];
    const nodesConnectedToExit = new Set<string>(bodyResult.nodesConnectedToExit);

    if (bodyResult.entryNodeId) {
      edges.push({ from: headerId, to: bodyResult.entryNodeId, label: "Loop" });
    } else {
      edges.push({ from: headerId, to: headerId, label: "Loop" });
    }

    bodyResult.exitPoints.forEach(ep => edges.push({ from: ep.id, to: headerId }));
    edges.push({ from: headerId, to: loopExitId, label: "End Loop" });

    return {
      nodes,
      edges,
      entryNodeId: headerId,
      exitPoints: [{ id: loopExitId }],
      nodesConnectedToExit,
    };
  }

  private processWhileStatement(
    whileNode: Parser.SyntaxNode,
    exitId: string,
    finallyContext?: { finallyEntryId: string }
  ): ProcessResult {
    const conditionText = this.escapeString(whileNode.childForFieldName("condition")!.text);
    const conditionId = this.generateNodeId("while_cond");
    const loopExitId = this.generateNodeId("while_exit");

    const nodes: FlowchartNode[] = [
      {
        id: conditionId,
        label: conditionText,
        shape: "diamond",
        style: this.nodeStyles.decision,
      },
      { id: loopExitId, label: "end loop", shape: "stadium" }
    ];
    this.locationMap.push({ start: whileNode.startIndex, end: whileNode.endIndex, nodeId: conditionId });

    const loopContext: LoopContext = { breakTargetId: loopExitId, continueTargetId: conditionId };
    const bodyResult = this.processBlock(whileNode.childForFieldName("body")!, exitId, loopContext, finallyContext);
    nodes.push(...bodyResult.nodes);
    const edges: FlowchartEdge[] = [...bodyResult.edges];
    const nodesConnectedToExit = new Set<string>(bodyResult.nodesConnectedToExit);

    if (bodyResult.entryNodeId) {
      edges.push({ from: conditionId, to: bodyResult.entryNodeId, label: "True" });
    } else {
      edges.push({ from: conditionId, to: conditionId, label: "True" });
    }

    bodyResult.exitPoints.forEach(ep => edges.push({ from: ep.id, to: conditionId }));
    edges.push({ from: conditionId, to: loopExitId, label: "False" });

    return {
      nodes,
      edges,
      entryNodeId: conditionId,
      exitPoints: [{ id: loopExitId }],
      nodesConnectedToExit,
    };
  }

  private processReturnStatement(
    returnNode: Parser.SyntaxNode,
    exitId: string,
    finallyContext?: { finallyEntryId: string }
  ): ProcessResult {
    const valueNode = returnNode.namedChild(0);
    if (valueNode) {
      const hofInfo = this.findHofInExpression(valueNode);
      if (hofInfo) {
        const hofResult = this.processHigherOrderFunctionCall(hofInfo.hofCallNode);
        if (hofResult) {
          const allNodes = [...hofResult.nodes];
          const allEdges = [...hofResult.edges];
          let currentExits = hofResult.exitPoints;

          if (hofInfo.containerName) {
            const convertId = this.generateNodeId("convert");
            allNodes.push({
              id: convertId,
              label: `Convert to ${hofInfo.containerName}`,
              shape: "rect",
              style: this.nodeStyles.process,
            });
            currentExits.forEach(ep => allEdges.push({ from: ep.id, to: convertId, label: ep.label }));
            currentExits = [{ id: convertId }];
          }

          const returnId = this.generateNodeId("return_hof");
          allNodes.push({
            id: returnId,
            label: "return result",
            shape: "stadium",
            style: this.nodeStyles.special,
          });
          this.locationMap.push({ start: returnNode.startIndex, end: returnNode.endIndex, nodeId: returnId });

          currentExits.forEach(ep => allEdges.push({ from: ep.id, to: returnId, label: ep.label }));
          allEdges.push({ from: returnId, to: finallyContext ? finallyContext.finallyEntryId : exitId });

          return {
            nodes: allNodes,
            edges: allEdges,
            entryNodeId: hofResult.entryNodeId,
            exitPoints: [],
            nodesConnectedToExit: new Set<string>([returnId]),
          };
        }
      }
    }

    const nodeId = this.generateNodeId("return");
    const labelText = valueNode ? `return ${this.escapeString(valueNode.text)}` : "return";
    const node: FlowchartNode = {
      id: nodeId,
      label: labelText,
      shape: "stadium",
      style: this.nodeStyles.special,
    };
    const edges: FlowchartEdge[] = [{
      from: nodeId,
      to: finallyContext ? finallyContext.finallyEntryId : exitId
    }];
    this.locationMap.push({ start: returnNode.startIndex, end: returnNode.endIndex, nodeId });

    return {
      nodes: [node],
      edges,
      entryNodeId: nodeId,
      exitPoints: [],
      nodesConnectedToExit: new Set<string>([nodeId]),
    };
  }

  private processRaiseStatement(
    raiseNode: Parser.SyntaxNode,
    exitId: string,
    finallyContext?: { finallyEntryId: string }
  ): ProcessResult {
    const nodeId = this.generateNodeId("raise");
    const valueNodes = raiseNode.namedChildren;
    const labelText = valueNodes.length > 0 
      ? `raise ${this.escapeString(valueNodes.map(n => n.text).join(", "))}` 
      : "raise";

    const node: FlowchartNode = {
      id: nodeId,
      label: labelText,
      shape: "stadium",
      style: this.nodeStyles.special,
    };
    const edges: FlowchartEdge[] = [{
      from: nodeId,
      to: finallyContext ? finallyContext.finallyEntryId : exitId
    }];
    this.locationMap.push({ start: raiseNode.startIndex, end: raiseNode.endIndex, nodeId });

    return {
      nodes: [node],
      edges,
      entryNodeId: nodeId,
      exitPoints: [],
      nodesConnectedToExit: new Set<string>([nodeId]),
    };
  }

  private processBreakStatement(breakNode: Parser.SyntaxNode, loopContext: LoopContext): ProcessResult {
    const nodeId = this.generateNodeId("break");
    const node: FlowchartNode = {
      id: nodeId,
      label: "break",
      shape: "stadium",
      style: this.nodeStyles.break,
    };
    const edges: FlowchartEdge[] = [{ from: nodeId, to: loopContext.breakTargetId }];
    this.locationMap.push({ start: breakNode.startIndex, end: breakNode.endIndex, nodeId });

    return {
      nodes: [node],
      edges,
      entryNodeId: nodeId,
      exitPoints: [],
      nodesConnectedToExit: new Set<string>([nodeId]),
    };
  }

  private processContinueStatement(continueNode: Parser.SyntaxNode, loopContext: LoopContext): ProcessResult {
    const nodeId = this.generateNodeId("continue");
    const node: FlowchartNode = {
      id: nodeId,
      label: "continue",
      shape: "stadium",
      style: this.nodeStyles.break,
    };
    const edges: FlowchartEdge[] = [{ from: nodeId, to: loopContext.continueTargetId }];
    this.locationMap.push({ start: continueNode.startIndex, end: continueNode.endIndex, nodeId });

    return {
      nodes: [node],
      edges,
      entryNodeId: nodeId,
      exitPoints: [],
      nodesConnectedToExit: new Set<string>([nodeId]),
    };
  }

  private processMatchStatement(
    matchNode: Parser.SyntaxNode,
    exitId: string,
    loopContext?: LoopContext,
    finallyContext?: { finallyEntryId: string }
  ): ProcessResult {
    const subjectNode = matchNode.childForFieldName("subject");
    if (!subjectNode) return this.processDefaultStatement(matchNode);

    const subjectId = this.generateNodeId("match_subject");
    const nodes: FlowchartNode[] = [{
      id: subjectId,
      label: `match ${this.escapeString(subjectNode.text)}`,
      shape: "rect",
      style: this.nodeStyles.process,
    }];
    this.locationMap.push({ start: subjectNode.startIndex, end: subjectNode.endIndex, nodeId: subjectId });

    const edges: FlowchartEdge[] = [];
    const nodesConnectedToExit = new Set<string>();
    const allExitPoints: { id: string; label?: string }[] = [];
    let lastConditionExit: { id: string; label?: string } = { id: subjectId };

    const blockNode = matchNode.children.find(child => child.type === "block");
    const caseClauses = blockNode?.children.filter(child => child.type === "case_clause") || [];

    for (const clause of caseClauses) {
      const casePatternNode = clause.children.find(c => c.type === "case_pattern");
      const guardNode = clause.childForFieldName("guard");
      const bodyNode = clause.children.find(c => c.type === "block");
      if (!casePatternNode || !bodyNode) continue;

      let caseLabel = `case ${this.escapeString(casePatternNode.text)}`;
      if (guardNode) caseLabel += ` if ${this.escapeString(guardNode.text)}`;

      const caseConditionId = this.generateNodeId("case");
      nodes.push({
        id: caseConditionId,
        label: caseLabel,
        shape: "diamond",
        style: this.nodeStyles.decision,
      });
      this.locationMap.push({ start: clause.startIndex, end: clause.endIndex, nodeId: caseConditionId });

      edges.push({ from: lastConditionExit.id, to: caseConditionId, label: lastConditionExit.label });

      const bodyResult = this.processBlock(bodyNode, exitId, loopContext, finallyContext);
      nodes.push(...bodyResult.nodes);
      edges.push(...bodyResult.edges);
      bodyResult.nodesConnectedToExit.forEach(n => nodesConnectedToExit.add(n));

      if (bodyResult.entryNodeId) {
        edges.push({ from: caseConditionId, to: bodyResult.entryNodeId, label: "True" });
      } else {
        allExitPoints.push({ id: caseConditionId, label: "True" });
      }
      allExitPoints.push(...bodyResult.exitPoints);

      lastConditionExit = { id: caseConditionId, label: "False" };
    }

    allExitPoints.push(lastConditionExit);

    return {
      nodes,
      edges,
      entryNodeId: subjectId,
      exitPoints: allExitPoints,
      nodesConnectedToExit,
    };
  }

  private processTryStatement(
    tryNode: Parser.SyntaxNode,
    exitId: string,
    loopContext?: LoopContext,
    finallyContext?: { finallyEntryId: string }
  ): ProcessResult {
    const entryId = this.generateNodeId("try_entry");
    const nodes: FlowchartNode[] = [{ id: entryId, label: "try", shape: "stadium" }];
    this.locationMap.push({ start: tryNode.startIndex, end: tryNode.endIndex, nodeId: entryId });

    const edges: FlowchartEdge[] = [];
    const nodesConnectedToExit = new Set<string>();
    let allExitPoints: { id: string; label?: string }[] = [];

    let newFinallyContext: { finallyEntryId: string } | undefined;
    let finallyResult: ProcessResult | null = null;
    const finallyClause = tryNode.children.find(c => c.type === "finally_clause");

    if (finallyClause) {
      const finallyBody = finallyClause.namedChildren.find(c => c.type === "block");
      finallyResult = this.processBlock(finallyBody!, exitId, loopContext, finallyContext);
      if (finallyResult.entryNodeId) {
        nodes.push(...finallyResult.nodes);
        edges.push(...finallyResult.edges);
        finallyResult.nodesConnectedToExit.forEach(n => nodesConnectedToExit.add(n));
        newFinallyContext = { finallyEntryId: finallyResult.entryNodeId };
      }
    }

    const tryBody = tryNode.namedChildren.find(c => c.type === "block");
    const tryResult = this.processBlock(tryBody!, exitId, loopContext, newFinallyContext || finallyContext);
    nodes.push(...tryResult.nodes);
    edges.push(...tryResult.edges);
    tryResult.nodesConnectedToExit.forEach(n => nodesConnectedToExit.add(n));

    if (tryResult.entryNodeId) {
      edges.push({ from: entryId, to: tryResult.entryNodeId });
    } else if (finallyResult?.entryNodeId) {
      edges.push({ from: entryId, to: finallyResult.entryNodeId });
    } else {
      allExitPoints.push({ id: entryId });
    }

    tryResult.exitPoints.forEach(ep => {
      if (finallyResult?.entryNodeId) {
        edges.push({ from: ep.id, to: finallyResult.entryNodeId, label: ep.label });
      } else {
        allExitPoints.push(ep);
      }
    });

    const exceptClauses = tryNode.children.filter(c => c.type === "except_clause");
    for (const clause of exceptClauses) {
      const exceptBody = clause.namedChildren.find(c => c.type === "block");
      const exceptTypeNode = clause.namedChildren.find(c => c.type !== "block");
      const exceptType = exceptTypeNode ? this.escapeString(exceptTypeNode.text) : "exception";

      const exceptResult = this.processBlock(exceptBody!, exitId, loopContext, newFinallyContext || finallyContext);
      nodes.push(...exceptResult.nodes);
      edges.push(...exceptResult.edges);
      exceptResult.nodesConnectedToExit.forEach(n => nodesConnectedToExit.add(n));

      if (exceptResult.entryNodeId) {
        edges.push({ from: entryId, to: exceptResult.entryNodeId, label: `on ${exceptType}` });
        exceptResult.exitPoints.forEach(ep => {
          if (finallyResult?.entryNodeId) {
            edges.push({ from: ep.id, to: finallyResult.entryNodeId, label: ep.label });
          } else {
            allExitPoints.push(ep);
          }
        });
      }
    }

    if (finallyResult) allExitPoints.push(...finallyResult.exitPoints);

    return {
      nodes,
      edges,
      entryNodeId: entryId,
      exitPoints: allExitPoints,
      nodesConnectedToExit,
    };
  }

  private processWithStatement(
    withNode: Parser.SyntaxNode,
    exitId: string,
    loopContext?: LoopContext,
    finallyContext?: { finallyEntryId: string }
  ): ProcessResult {
    const withClauseNode = withNode.children.find((c: Parser.SyntaxNode) => c.type === "with_clause");
    const withEntryId = this.generateNodeId("with");
    const nodes: FlowchartNode[] = [{
      id: withEntryId,
      label: this.escapeString(withClauseNode?.text || "with ..."),
      shape: "rect",
      style: this.nodeStyles.special,
    }];
    this.locationMap.push({ start: withNode.startIndex, end: withNode.endIndex, nodeId: withEntryId });

    const edges: FlowchartEdge[] = [];
    const body = withNode.childForFieldName("body");
    if (body) {
      const bodyResult = this.processBlock(body, exitId, loopContext, finallyContext);
      nodes.push(...bodyResult.nodes);
      edges.push(...bodyResult.edges);

      if (bodyResult.entryNodeId) edges.push({ from: withEntryId, to: bodyResult.entryNodeId });

      return {
        nodes,
        edges,
        entryNodeId: withEntryId,
        exitPoints: bodyResult.exitPoints.length > 0 ? bodyResult.exitPoints : [{ id: withEntryId }],
        nodesConnectedToExit: bodyResult.nodesConnectedToExit,
      };
    }

    return {
      nodes,
      edges,
      entryNodeId: withEntryId,
      exitPoints: [{ id: withEntryId }],
      nodesConnectedToExit: new Set<string>(),
    };
  }

  private processAssertStatement(
    assertNode: Parser.SyntaxNode,
    exitId: string,
    loopContext?: LoopContext,
    finallyContext?: { finallyEntryId: string }
  ): ProcessResult {
    const conditionNode = assertNode.namedChildren[0];
    if (!conditionNode) return this.processDefaultStatement(assertNode);

    const conditionId = this.generateNodeId("assert_cond");
    const nodes: FlowchartNode[] = [{
      id: conditionId,
      label: `assert ${this.escapeString(conditionNode.text)}`,
      shape: "diamond",
      style: this.nodeStyles.decision,
    }];
    this.locationMap.push({ start: assertNode.startIndex, end: assertNode.endIndex, nodeId: conditionId });

    const raiseNodeId = this.generateNodeId("raise_assert");
    let label = "raise AssertionError";
    if (assertNode.namedChildren.length > 1) {
      label += `: ${this.escapeString(assertNode.namedChildren[1].text)}`;
    }
    nodes.push({
      id: raiseNodeId,
      label,
      shape: "stadium",
      style: this.nodeStyles.special,
    });

    const edges: FlowchartEdge[] = [
      { from: conditionId, to: raiseNodeId, label: "False" },
      { from: raiseNodeId, to: finallyContext ? finallyContext.finallyEntryId : exitId }
    ];

    return {
      nodes,
      edges,
      entryNodeId: conditionId,
      exitPoints: [{ id: conditionId, label: "True" }],
      nodesConnectedToExit: new Set<string>([raiseNodeId]),
    };
  }

  private processArgument(argNode: Parser.SyntaxNode): ProcessResult {
    if (this.isHofCall(argNode)) {
      return this.processHigherOrderFunctionCall(argNode)!;
    } else {
      const nodeId = this.generateNodeId("input");
      const node: FlowchartNode = {
        id: nodeId,
        label: `Input: ${this.escapeString(argNode.text)}`,
        shape: "rect",
        style: this.nodeStyles.special,
      };
      this.locationMap.push({ start: argNode.startIndex, end: argNode.endIndex, nodeId });
      return {
        nodes: [node],
        edges: [],
        entryNodeId: nodeId,
        exitPoints: [{ id: nodeId }],
        nodesConnectedToExit: new Set<string>(),
      };
    }
  }

  private processHigherOrderFunctionCall(callNode: Parser.SyntaxNode): ProcessResult | null {
    const functionName = callNode.childForFieldName("function")?.text.split(".").pop();
    switch (functionName) {
      case "map": return this.processMap(callNode);
      case "filter": return this.processFilter(callNode);
      case "reduce": return this.processReduce(callNode);
      default: return null;
    }
  }

  private processMap(callNode: Parser.SyntaxNode): ProcessResult {
    const args = callNode.childForFieldName("arguments")?.namedChildren || [];
    if (args.length < 2) return this.processDefaultStatement(callNode);

    const [functionArg, iterableArgNode] = args;
    const functionText = this.escapeString(functionArg.text);
    const lambdaBodyText = functionArg.type === "lambda"
      ? this.escapeString(functionArg.childForFieldName("body")!.text)
      : `${functionText}(item)`;

    const iterableResult = this.processArgument(iterableArgNode);
    const nodes: FlowchartNode[] = [...iterableResult.nodes];
    const edges: FlowchartEdge[] = [...iterableResult.edges];

    const mapId = this.generateNodeId("map_call");
    nodes.push({
      id: mapId,
      label: `map()`,
      shape: "rect",
      style: this.nodeStyles.hof,
    });
    iterableResult.exitPoints.forEach(ep => edges.push({ from: ep.id, to: mapId, label: ep.label }));

    const applyId = this.generateNodeId("map_apply");
    nodes.push({
      id: applyId,
      label: `Apply lambda to each element: new_item = ${lambdaBodyText}`,
      shape: "rect",
      style: this.nodeStyles.process,
    });
    this.locationMap.push({ start: functionArg.startIndex, end: functionArg.endIndex, nodeId: applyId });
    edges.push({ from: mapId, to: applyId, label: "Next item" });

    const collectId = this.generateNodeId("map_collect");
    nodes.push({
      id: collectId,
      label: "Collect transformed element",
      shape: "rect",
      style: this.nodeStyles.process,
    });
    edges.push({ from: applyId, to: collectId });
    edges.push({ from: collectId, to: mapId });

    const resultId = this.generateNodeId("map_result");
    nodes.push({
      id: resultId,
      label: "Collected results",
      shape: "rect",
      style: this.nodeStyles.special,
    });
    edges.push({ from: mapId, to: resultId, label: "End of list" });

    return {
      nodes,
      edges,
      entryNodeId: iterableResult.entryNodeId,
      exitPoints: [{ id: resultId }],
      nodesConnectedToExit: new Set<string>(),
    };
  }

  private processFilter(callNode: Parser.SyntaxNode): ProcessResult {
    const args = callNode.childForFieldName("arguments")?.namedChildren || [];
    if (args.length < 2) return this.processDefaultStatement(callNode);

    const [functionArg, iterableArgNode] = args;
    const iterableResult = this.processArgument(iterableArgNode);
    const nodes: FlowchartNode[] = [...iterableResult.nodes];
    const edges: FlowchartEdge[] = [...iterableResult.edges];

    const filterId = this.generateNodeId("filter_call");
    nodes.push({
      id: filterId,
      label: `filter()`,
      shape: "rect",
      style: this.nodeStyles.hof,
    });
    iterableResult.exitPoints.forEach(ep => edges.push({ from: ep.id, to: filterId, label: ep.label }));

    const applyId = this.generateNodeId("filter_apply");
    nodes.push({
      id: applyId,
      label: `Apply lambda to each element`,
      shape: "rect",
      style: this.nodeStyles.process,
    });
    this.locationMap.push({ start: functionArg.startIndex, end: functionArg.endIndex, nodeId: applyId });
    edges.push({ from: filterId, to: applyId, label: "Next item" });

    const decisionId = this.generateNodeId("filter_decision");
    nodes.push({
      id: decisionId,
      label: `lambda returns True?`,
      shape: "diamond",
      style: this.nodeStyles.decision,
    });
    edges.push({ from: applyId, to: decisionId });

    const keepId = this.generateNodeId("filter_keep");
    nodes.push({
      id: keepId,
      label: "Keep element",
      shape: "rect",
      style: this.nodeStyles.process,
    });
    edges.push({ from: decisionId, to: keepId, label: "Yes" });
    edges.push({ from: keepId, to: filterId });

    const discardId = this.generateNodeId("filter_discard");
    nodes.push({
      id: discardId,
      label: "Discard element",
      shape: "rect",
      style: this.nodeStyles.break,
    });
    edges.push({ from: decisionId, to: discardId, label: "No" });
    edges.push({ from: discardId, to: filterId });

    const collectedId = this.generateNodeId("filter_collected");
    nodes.push({
      id: collectedId,
      label: "Collected results",
      shape: "rect",
      style: this.nodeStyles.special,
    });
    edges.push({ from: filterId, to: collectedId, label: "End of list" });

    return {
      nodes,
      edges,
      entryNodeId: iterableResult.entryNodeId,
      exitPoints: [{ id: collectedId }],
      nodesConnectedToExit: new Set<string>(),
    };
  }

  private processReduce(callNode: Parser.SyntaxNode): ProcessResult {
    const args = callNode.childForFieldName("arguments")?.namedChildren || [];
    if (args.length < 2) return this.processDefaultStatement(callNode);

    const [functionArg, iterableArgNode] = args;
    const hasInitializer = args.length > 2;
    const initializerArgNode = hasInitializer ? args[2] : null;
    const initializerText = initializerArgNode
      ? this.escapeString(initializerArgNode.text)
      : `first item from input`;

    const iterableResult = this.processArgument(iterableArgNode);
    const nodes: FlowchartNode[] = [...iterableResult.nodes];
    const edges: FlowchartEdge[] = [...iterableResult.edges];

    const initId = this.generateNodeId("reduce_init");
    nodes.push({
      id: initId,
      label: `accumulator = ${initializerText}`,
      shape: "rect",
      style: this.nodeStyles.process,
    });
    if (initializerArgNode) {
      this.locationMap.push({ start: initializerArgNode.startIndex, end: initializerArgNode.endIndex, nodeId: initId });
    }
    iterableResult.exitPoints.forEach(ep => edges.push({ from: ep.id, to: initId, label: ep.label }));

    const headerId = this.generateNodeId("reduce_header");
    nodes.push({
      id: headerId,
      label: hasInitializer ? `For each item` : `For each remaining item`,
      shape: "rect",
      style: this.nodeStyles.hof,
    });
    edges.push({ from: initId, to: headerId });

    const applyId = this.generateNodeId("reduce_apply");
    nodes.push({
      id: applyId,
      label: `accumulator = ${this.escapeString(functionArg.text)}(accumulator, item)`,
      shape: "rect",
      style: this.nodeStyles.process,
    });
    this.locationMap.push({ start: functionArg.startIndex, end: functionArg.endIndex, nodeId: applyId });
    edges.push({ from: headerId, to: applyId, label: "Next" });
    edges.push({ from: applyId, to: headerId });

    const resultId = this.generateNodeId("reduce_result");
    nodes.push({
      id: resultId,
      label: "Return final accumulator value",
      shape: "rect",
      style: this.nodeStyles.special,
    });
    edges.push({ from: headerId, to: resultId, label: "End" });

    return {
      nodes,
      edges,
      entryNodeId: iterableResult.entryNodeId,
      exitPoints: [{ id: resultId }],
      nodesConnectedToExit: new Set<string>(),
    };
  }
}
