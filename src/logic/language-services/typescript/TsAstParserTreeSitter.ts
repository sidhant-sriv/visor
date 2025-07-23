import Parser from "tree-sitter";
import Typescript from "tree-sitter-typescript";
import {
  FlowchartIR,
  FlowchartNode,
  FlowchartEdge,
  LocationMapEntry,
} from "../../../ir/ir";
import { AbstractParser } from "../../common/AbstractParser";
import { ProcessResult, LoopContext } from "../../common/AstParserTypes";

type TypescriptLanguage = Parser.Language;

export class TsAstParserTreeSitter extends AbstractParser {
  private currentFunctionIsArrowFunction = false;

  protected log(message: string, ...args: any[]) {
    if (this.debug) console.log(`[TsAstParser] ${message}`, ...args);
  }

  public listFunctions(sourceCode: string): string[] {
    const parser = new Parser();
    parser.setLanguage(Typescript.typescript as TypescriptLanguage);
    const tree = parser.parse(sourceCode);

    // Get function declarations
    const funcNames = tree.rootNode
      .descendantsOfType("function_declaration")
      .map(
        (f: Parser.SyntaxNode) =>
          f.childForFieldName("name")?.text || "[anonymous]"
      );

    // Get function expressions
    const funcExprNames = tree.rootNode
      .descendantsOfType("function_expression")
      .map(
        (f: Parser.SyntaxNode) =>
          f.childForFieldName("name")?.text || "[function expression]"
      );

    // Get arrow functions assigned to variables
    const arrowFuncNames = tree.rootNode
      .descendantsOfType("variable_declarator")
      .filter((vd) => vd.childForFieldName("value")?.type === "arrow_function")
      .map((vd) => vd.childForFieldName("name")?.text || "[arrow function]");

    // Get method definitions in classes
    const methodNames = tree.rootNode
      .descendantsOfType("method_definition")
      .map(
        (m: Parser.SyntaxNode) =>
          m.childForFieldName("name")?.text || "[method]"
      );

    return [...funcNames, ...funcExprNames, ...arrowFuncNames, ...methodNames];
  }

  public findFunctionAtPosition(
    sourceCode: string,
    position: number
  ): string | undefined {
    const parser = new Parser();
    parser.setLanguage(Typescript.typescript as TypescriptLanguage);
    const tree = parser.parse(sourceCode);

    // Find function declarations
    const func = tree.rootNode
      .descendantsOfType("function_declaration")
      .find((f) => position >= f.startIndex && position <= f.endIndex);
    if (func) return func.childForFieldName("name")?.text || "[anonymous]";

    // Find function expressions
    const funcExpr = tree.rootNode
      .descendantsOfType("function_expression")
      .find((f) => position >= f.startIndex && position <= f.endIndex);
    if (funcExpr)
      return (
        funcExpr.childForFieldName("name")?.text || "[function expression]"
      );

    // Find arrow functions
    const arrowFunc = tree.rootNode
      .descendantsOfType("variable_declarator")
      .find(
        (vd) =>
          position >= vd.startIndex &&
          position <= vd.endIndex &&
          vd.childForFieldName("value")?.type === "arrow_function"
      );
    if (arrowFunc)
      return arrowFunc.childForFieldName("name")?.text || "[arrow function]";

    // Find methods
    const method = tree.rootNode
      .descendantsOfType("method_definition")
      .find((m) => position >= m.startIndex && position <= m.endIndex);
    return method?.childForFieldName("name")?.text || "[method]";
  }

  private isHofCall(node: Parser.SyntaxNode | null | undefined): boolean {
    if (!node || node.type !== "call_expression") return false;
    const functionNode = node.childForFieldName("function");
    if (!functionNode) return false;

    const functionName = functionNode.text?.split(".").pop();
    if (!functionName) return false;

    return [
      "map",
      "filter",
      "reduce",
      "forEach",
      "find",
      "some",
      "every",
    ].includes(functionName);
  }

  private generateHofFlowchart(
    statementNode: Parser.SyntaxNode,
    hofCallNode: Parser.SyntaxNode,
    containerName?: string
  ): FlowchartIR {
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

    if (
      ["assignment_expression", "expression_statement"].includes(
        statementNode.type
      )
    ) {
      const assignment =
        statementNode.type === "assignment_expression"
          ? statementNode
          : statementNode.namedChild(0);

      if (assignment && assignment.type === "assignment_expression") {
        const leftNode = assignment.childForFieldName("left");
        if (leftNode) {
          const assignId = this.generateNodeId("assign_hof");
          const leftText = this.escapeString(leftNode.text);
          nodes.unshift({
            id: assignId,
            label: `${leftText} = ...`,
            shape: "rect",
            style: this.nodeStyles.process,
          });
          if (entryPointId) edges.unshift({ from: assignId, to: entryPointId });
          entryPointId = assignId;
          this.locationMap.push({
            start: leftNode.startIndex,
            end: leftNode.endIndex,
            nodeId: assignId,
          });
        }
      }
    }

    if (containerName) {
      const convertId = this.generateNodeId("convert");
      nodes.push({
        id: convertId,
        label: `Convert to ${containerName}`,
        shape: "rect",
        style: this.nodeStyles.process,
      });
      finalExitPoints.forEach((ep) =>
        edges.push({ from: ep.id, to: convertId, label: ep.label })
      );
      finalExitPoints = [{ id: convertId }];
    }

    const startId = this.generateNodeId("start");
    const endId = this.generateNodeId("end");
    nodes.unshift({
      id: startId,
      label: "Start",
      shape: "round",
      style: this.nodeStyles.terminator,
    });
    nodes.push({
      id: endId,
      label: "End",
      shape: "round",
      style: this.nodeStyles.terminator,
    });

    edges.unshift(
      entryPointId
        ? { from: startId, to: entryPointId }
        : { from: startId, to: endId }
    );
    finalExitPoints.forEach((ep) =>
      edges.push({ from: ep.id, to: endId, label: ep.label })
    );

    return {
      nodes,
      edges,
      locationMap: this.locationMap,
      functionRange: {
        start: statementNode.startIndex,
        end: statementNode.endIndex,
      },
      title: `Flowchart for: ${this.escapeString(statementNode.text)}`,
      entryNodeId: startId,
      exitNodeId: endId,
    };
  }

  public generateFlowchart(
    sourceCode: string,
    functionName?: string,
    position?: number
  ): FlowchartIR {
    const parser = new Parser();
    parser.setLanguage(Typescript.typescript as TypescriptLanguage);
    const tree = parser.parse(sourceCode);

    if (position !== undefined) {
      const statements = tree.rootNode.descendantsOfType([
        "assignment_expression",
        "expression_statement",
        "return_statement",
      ]);
      const smallestStatement = statements.reduce<
        Parser.SyntaxNode | undefined
      >((smallest, stmt) => {
        if (
          position >= stmt.startIndex &&
          position <= stmt.endIndex &&
          (!smallest ||
            stmt.endIndex - stmt.startIndex <
              smallest.endIndex - smallest.startIndex)
        ) {
          return stmt;
        }
        return smallest;
      }, undefined);

      if (smallestStatement) {
        let potentialCallNode: Parser.SyntaxNode | null | undefined;
        let baseStatement = smallestStatement;

        if (smallestStatement.type === "assignment_expression") {
          potentialCallNode = smallestStatement.childForFieldName("right");
        } else if (smallestStatement.type === "expression_statement") {
          const child = smallestStatement.namedChild(0);
          if (child?.type === "assignment_expression") {
            potentialCallNode = child.childForFieldName("right");
            baseStatement = child;
          } else {
            potentialCallNode = child;
          }
        } else if (smallestStatement.type === "return_statement") {
          potentialCallNode = smallestStatement.namedChild(0);
        }

        if (potentialCallNode?.type === "call_expression") {
          const funcNode = potentialCallNode.childForFieldName("function");
          const funcName = funcNode?.text;
          const args =
            potentialCallNode.childForFieldName("arguments")?.namedChildren ||
            [];

          // Check for array constructor with HOF call
          if (
            ["Array"].includes(funcName!) &&
            args.length === 1 &&
            args[0].type === "call_expression" &&
            this.isHofCall(args[0])
          ) {
            return this.generateHofFlowchart(baseStatement, args[0], funcName);
          } else if (this.isHofCall(potentialCallNode)) {
            return this.generateHofFlowchart(baseStatement, potentialCallNode);
          }
        }
      }
    }

    let targetNode: Parser.SyntaxNode | undefined;
    let isArrowFunction = false;

    if (position !== undefined) {
      // Find function declarations
      targetNode = tree.rootNode
        .descendantsOfType("function_declaration")
        .find((f) => position >= f.startIndex && position <= f.endIndex);

      if (!targetNode) {
        // Find function expressions
        targetNode = tree.rootNode
          .descendantsOfType("function_expression")
          .find((f) => position >= f.startIndex && position <= f.endIndex);
      }

      if (!targetNode) {
        // Find arrow functions in variable declarations
        targetNode = tree.rootNode
          .descendantsOfType("variable_declarator")
          .find(
            (vd) =>
              position >= vd.startIndex &&
              position <= vd.endIndex &&
              vd.childForFieldName("value")?.type === "arrow_function"
          );
        isArrowFunction = !!targetNode;
      }

      if (!targetNode) {
        // Find method definitions
        targetNode = tree.rootNode
          .descendantsOfType("method_definition")
          .find((m) => position >= m.startIndex && position <= m.endIndex);
      }
    } else if (functionName) {
      // Find by function name
      targetNode = tree.rootNode
        .descendantsOfType("function_declaration")
        .find((f) => f.childForFieldName("name")?.text === functionName);

      if (!targetNode) {
        targetNode = tree.rootNode
          .descendantsOfType("function_expression")
          .find((f) => f.childForFieldName("name")?.text === functionName);
      }

      if (!targetNode) {
        targetNode = tree.rootNode
          .descendantsOfType("variable_declarator")
          .find(
            (vd) =>
              vd.childForFieldName("name")?.text === functionName &&
              vd.childForFieldName("value")?.type === "arrow_function"
          );
        isArrowFunction = !!targetNode;
      }

      if (!targetNode) {
        targetNode = tree.rootNode
          .descendantsOfType("method_definition")
          .find((m) => m.childForFieldName("name")?.text === functionName);
      }
    } else {
      // Get first function found
      targetNode =
        tree.rootNode.descendantsOfType("function_declaration")[0] ||
        tree.rootNode.descendantsOfType("function_expression")[0] ||
        tree.rootNode.descendantsOfType("method_definition")[0];
    }

    if (!targetNode) {
      return {
        nodes: [
          {
            id: "A",
            label:
              "Place cursor inside a function or statement to generate a flowchart.",
            shape: "rect",
          },
        ],
        edges: [],
        locationMap: [],
      };
    }

    this.nodeIdCounter = 0;
    this.locationMap = [];
    this.currentFunctionIsArrowFunction = isArrowFunction;

    let bodyToProcess: Parser.SyntaxNode | null | undefined;

    if (isArrowFunction) {
      // For arrow functions, get the body from the variable declarator's value
      const arrowFunc = targetNode.childForFieldName("value");
      bodyToProcess = arrowFunc?.childForFieldName("body");
    } else if (
      targetNode.type === "method_definition" ||
      targetNode.type === "function_declaration" ||
      targetNode.type === "function_expression"
    ) {
      bodyToProcess = targetNode.childForFieldName("body");
    }

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

    nodes.push({
      id: entryId,
      label: `Start`,
      shape: "round",
      style: this.nodeStyles.terminator,
    });
    nodes.push({
      id: exitId,
      label: "End",
      shape: "round",
      style: this.nodeStyles.terminator,
    });

    // For arrow functions with expression body, process as single statement
    // For all others (including arrow functions with block body), process as block
    const bodyResult =
      isArrowFunction && bodyToProcess.type !== "statement_block"
        ? this.processStatement(bodyToProcess, exitId)
        : this.processBlock(bodyToProcess, exitId);

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

    const actualFunctionName = this.getFunctionName(
      targetNode,
      isArrowFunction
    );

    return {
      nodes,
      edges: validEdges,
      locationMap: this.locationMap,
      functionRange: { start: targetNode.startIndex, end: targetNode.endIndex },
      title: `Flowchart for ${
        isArrowFunction ? "arrow function" : "function"
      }: ${this.escapeString(actualFunctionName || "[anonymous]")}`,
      entryNodeId: entryId,
      exitNodeId: exitId,
    };
  }

  private getFunctionName(
    targetNode: Parser.SyntaxNode,
    isArrowFunction: boolean
  ): string {
    if (isArrowFunction) {
      return targetNode.childForFieldName("name")?.text || "[arrow function]";
    } else if (targetNode.type === "method_definition") {
      return targetNode.childForFieldName("name")?.text || "[method]";
    } else {
      return targetNode.childForFieldName("name")?.text || "[anonymous]";
    }
  }

  private findHofInExpression(
    expressionNode: Parser.SyntaxNode
  ): { hofCallNode: Parser.SyntaxNode; containerName?: string } | null {
    if (expressionNode?.type !== "call_expression") return null;

    const funcNode = expressionNode.childForFieldName("function");
    const funcName = funcNode?.text;
    const args =
      expressionNode.childForFieldName("arguments")?.namedChildren || [];

    if (
      funcName &&
      ["Array"].includes(funcName) &&
      args.length === 1 &&
      this.isHofCall(args[0])
    ) {
      return { hofCallNode: args[0], containerName: funcName };
    } else if (this.isHofCall(expressionNode)) {
      return { hofCallNode: expressionNode };
    }
    return null;
  }

  protected processStatement(
    statement: Parser.SyntaxNode,
    exitId: string,
    loopContext?: LoopContext,
    finallyContext?: { finallyEntryId: string }
  ): ProcessResult {
    if (statement.type === "ternary_expression") {
      return this.processConditionalExpression(
        statement,
        exitId,
        loopContext,
        finallyContext
      );
    }

    switch (statement.type) {
      case "if_statement":
        return this.processIfStatement(
          statement,
          exitId,
          loopContext,
          finallyContext
        );
      case "for_statement":
        return this.processForStatement(statement, exitId, finallyContext);
      // case "for_in_statement": return this.processForInStatement(statement, exitId, finallyContext);
      case "while_statement":
        return this.processWhileStatement(statement, exitId, finallyContext);
      // case "do_statement": return this.processDoWhileStatement(statement, exitId, finallyContext);
      case "try_statement":
        return this.processTryStatement(
          statement,
          exitId,
          loopContext,
          finallyContext
        );
      case "with_statement":
        return this.processWithStatement(
          statement,
          exitId,
          loopContext,
          finallyContext
        );
      case "return_statement":
        return this.processReturnStatement(statement, exitId, finallyContext);
      case "throw_statement":
        return this.processRaiseStatement(statement, exitId, finallyContext); // Reuse raise handler
      case "break_statement":
        return loopContext
          ? this.processBreakStatement(statement, loopContext)
          : this.processDefaultStatement(statement);
      case "continue_statement":
        return loopContext
          ? this.processContinueStatement(statement, loopContext)
          : this.processDefaultStatement(statement);
      case "switch_statement":
        return this.processSwitchStatement(
          statement,
          exitId,
          loopContext,
          finallyContext
        );
      case "debugger_statement":
        return this.processDebuggerStatement(statement);
      case "for_in_statement":
        return this.processForInStatement(statement, exitId, finallyContext);
      case "do_statement":
        return this.processDoWhileStatement(statement, exitId, finallyContext);
      case "empty_statement":
        return {
          nodes: [],
          edges: [],
          entryNodeId: undefined,
          exitPoints: [],
          nodesConnectedToExit: new Set<string>(),
        };
      default: {
        let expressionNode: Parser.SyntaxNode | undefined;
        let assignmentTargetNode: Parser.SyntaxNode | undefined;

        if (statement.type === "assignment_expression") {
          expressionNode = statement.childForFieldName("right") ?? undefined;
          assignmentTargetNode =
            statement.childForFieldName("left") ?? undefined;
        } else if (statement.type === "expression_statement") {
          const child = statement.firstNamedChild;
          if (child?.type === "assignment_expression")
            return this.processStatement(
              child,
              exitId,
              loopContext,
              finallyContext
            );
          expressionNode = child ?? undefined;
        }

        if (expressionNode) {
          if (
            expressionNode.type === "ternary_expression" &&
            assignmentTargetNode
          ) {
            const namedChildren = expressionNode.namedChildren;
            if (namedChildren.length < 3)
              return this.processDefaultStatement(statement);

            const targetText = this.escapeString(assignmentTargetNode.text);
            const [consequenceNode, conditionNode, alternativeNode] =
              namedChildren;
            const conditionId = this.generateNodeId("cond_expr");

            const nodes: FlowchartNode[] = [
              {
                id: conditionId,
                label: this.escapeString(conditionNode.text),
                shape: "diamond",
                style: this.nodeStyles.decision,
              },
            ];
            const edges: FlowchartEdge[] = []; // FIX: Initialize edges array

            this.locationMap.push({
              start: conditionNode.startIndex,
              end: conditionNode.endIndex,
              nodeId: conditionId,
            });

            // True path
            const consequenceId = this.generateNodeId("ternary_true");
            nodes.push({
              id: consequenceId,
              label: `${targetText} = ${this.escapeString(
                consequenceNode.text
              )}`,
              shape: "rect",
              style: this.nodeStyles.process,
            });
            this.locationMap.push({
              start: statement.startIndex,
              end: statement.endIndex,
              nodeId: consequenceId,
            });
            edges.push({ from: conditionId, to: consequenceId, label: "True" });

            // False path
            const alternativeId = this.generateNodeId("ternary_false");
            nodes.push({
              id: alternativeId,
              label: `${targetText} = ${this.escapeString(
                alternativeNode.text
              )}`,
              shape: "rect",
              style: this.nodeStyles.process,
            });
            this.locationMap.push({
              start: statement.startIndex,
              end: statement.endIndex,
              nodeId: alternativeId,
            });
            edges.push({
              from: conditionId,
              to: alternativeId,
              label: "False",
            });

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
            const hofResult = this.processHigherOrderFunctionCall(
              hofInfo.hofCallNode
            );
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
                currentExits.forEach((ep) =>
                  allEdges.push({ from: ep.id, to: convertId, label: ep.label })
                );
                currentExits = [{ id: convertId }];
              }

              if (assignmentTargetNode) {
                const assignId = this.generateNodeId("assign_hof");
                allNodes.unshift({
                  id: assignId,
                  label: `${this.escapeString(
                    assignmentTargetNode.text
                  )} = ...`,
                  shape: "rect",
                  style: this.nodeStyles.process,
                });
                if (currentEntry)
                  allEdges.unshift({ from: assignId, to: currentEntry });
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

        return this.currentFunctionIsArrowFunction
          ? this.processReturnStatementForExpression(
              statement,
              exitId,
              finallyContext
            )
          : this.processDefaultStatement(statement);
      }
    }
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
    const edges: FlowchartEdge[] = [
      {
        from: nodeId,
        to: finallyContext ? finallyContext.finallyEntryId : exitId,
      },
    ];
    this.locationMap.push({
      start: exprNode.startIndex,
      end: exprNode.endIndex,
      nodeId,
    });
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
    if (namedChildren.length < 3)
      return this.processDefaultStatement(condExprNode);

    const [consequenceNode, conditionNode, alternativeNode] = namedChildren;
    const conditionId = this.generateNodeId("cond_expr");
    const nodes: FlowchartNode[] = [
      {
        id: conditionId,
        label: this.escapeString(conditionNode.text),
        shape: "diamond",
        style: this.nodeStyles.decision,
      },
    ];
    this.locationMap.push({
      start: conditionNode.startIndex,
      end: conditionNode.endIndex,
      nodeId: conditionId,
    });

    const consequenceResult = this.processStatement(
      consequenceNode,
      exitId,
      loopContext,
      finallyContext
    );
    const alternativeResult = this.processStatement(
      alternativeNode,
      exitId,
      loopContext,
      finallyContext
    );

    nodes.push(...consequenceResult.nodes, ...alternativeResult.nodes);
    const edges: FlowchartEdge[] = [
      ...consequenceResult.edges,
      ...alternativeResult.edges,
    ];
    const nodesConnectedToExit = new Set<string>([
      ...consequenceResult.nodesConnectedToExit,
      ...alternativeResult.nodesConnectedToExit,
    ]);

    if (consequenceResult.entryNodeId) {
      edges.push({
        from: conditionId,
        to: consequenceResult.entryNodeId,
        label: "True",
      });
    }
    if (alternativeResult.entryNodeId) {
      edges.push({
        from: conditionId,
        to: alternativeResult.entryNodeId,
        label: "False",
      });
    }

    return {
      nodes,
      edges,
      entryNodeId: conditionId,
      exitPoints: this.currentFunctionIsArrowFunction
        ? []
        : [...consequenceResult.exitPoints, ...alternativeResult.exitPoints],
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
    if (!ifConditionNode || !ifConsequenceNode)
      return {
        nodes: [],
        edges: [],
        entryNodeId: undefined,
        exitPoints: [],
        nodesConnectedToExit: new Set<string>(),
      };

    const ifConditionId = this.generateNodeId("cond");
    const nodes: FlowchartNode[] = [
      {
        id: ifConditionId,
        label: this.escapeString(ifConditionNode.text),
        shape: "diamond",
        style: this.nodeStyles.decision,
      },
    ];
    this.locationMap.push({
      start: ifConditionNode.startIndex,
      end: ifConditionNode.endIndex,
      nodeId: ifConditionId,
    });

    const ifConsequenceResult = this.processBlock(
      ifConsequenceNode,
      exitId,
      loopContext,
      finallyContext
    );
    nodes.push(...ifConsequenceResult.nodes);
    const edges: FlowchartEdge[] = [...ifConsequenceResult.edges];
    const nodesConnectedToExit = new Set<string>(
      ifConsequenceResult.nodesConnectedToExit
    );
    const allExitPoints: { id: string; label?: string }[] = [
      ...ifConsequenceResult.exitPoints,
    ];

    if (ifConsequenceResult.entryNodeId) {
      edges.push({
        from: ifConditionId,
        to: ifConsequenceResult.entryNodeId,
        label: "True",
      });
    } else {
      allExitPoints.push({ id: ifConditionId, label: "True" });
    }

    const alternativeNode = ifNode.childForFieldName("alternative");

    if (alternativeNode) {
      // Handle 'else if' by treating it as a nested if statement
      if (alternativeNode.type === "if_statement") {
        const elseIfResult = this.processIfStatement(
          alternativeNode,
          exitId,
          loopContext,
          finallyContext
        );
        nodes.push(...elseIfResult.nodes);
        edges.push(...elseIfResult.edges);
        elseIfResult.nodesConnectedToExit.forEach((n) =>
          nodesConnectedToExit.add(n)
        );

        if (elseIfResult.entryNodeId) {
          edges.push({
            from: ifConditionId,
            to: elseIfResult.entryNodeId,
            label: "False",
          });
        }
        allExitPoints.push(...elseIfResult.exitPoints);
      } else {
        // Handle 'else'
        const elseResult = this.processBlock(
          alternativeNode,
          exitId,
          loopContext,
          finallyContext
        );
        nodes.push(...elseResult.nodes);
        edges.push(...elseResult.edges);
        elseResult.nodesConnectedToExit.forEach((n) =>
          nodesConnectedToExit.add(n)
        );

        if (elseResult.entryNodeId) {
          edges.push({
            from: ifConditionId,
            to: elseResult.entryNodeId,
            label: "False",
          });
        } else {
          allExitPoints.push({ id: ifConditionId, label: "False" });
        }
        allExitPoints.push(...elseResult.exitPoints);
      }
    } else {
      allExitPoints.push({ id: ifConditionId, label: "False" });
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
    // TypeScript for statement: for (init; condition; update)
    const initNode = forNode.childForFieldName("initializer");
    const conditionNode = forNode.childForFieldName("condition");
    const updateNode = forNode.childForFieldName("update");
    const bodyNode = forNode.childForFieldName("body");

    // Handle both C-style and for-in style loops
    if (!bodyNode) {
      return this.processDefaultStatement(forNode);
    }

    let loopLabel = "for loop";
    if (initNode && conditionNode && updateNode) {
      // C-style for loop
      loopLabel = `for (${initNode.text}; ${conditionNode.text}; ${updateNode.text})`;
    } else {
      // Try for-in style
      const leftNode = forNode.childForFieldName("left");
      const rightNode = forNode.childForFieldName("right");
      if (leftNode && rightNode) {
        loopLabel = `for ${leftNode.text} in ${rightNode.text}`;
      }
    }

    const headerId = this.generateNodeId("for_header");
    const loopExitId = this.generateNodeId("for_exit");

    const nodes: FlowchartNode[] = [
      {
        id: headerId,
        label: this.escapeString(loopLabel),
        shape: "diamond",
        style: this.nodeStyles.decision,
      },
      { id: loopExitId, label: "end loop", shape: "stadium" },
    ];
    this.locationMap.push({
      start: forNode.startIndex,
      end: forNode.endIndex,
      nodeId: headerId,
    });

    const loopContext: LoopContext = {
      breakTargetId: loopExitId,
      continueTargetId: headerId,
    };
    const bodyResult = this.processBlock(
      bodyNode,
      exitId,
      loopContext,
      finallyContext
    );
    nodes.push(...bodyResult.nodes);
    const edges: FlowchartEdge[] = [...bodyResult.edges];
    const nodesConnectedToExit = new Set<string>(
      bodyResult.nodesConnectedToExit
    );

    if (bodyResult.entryNodeId) {
      edges.push({ from: headerId, to: bodyResult.entryNodeId, label: "Loop" });
    } else {
      edges.push({ from: headerId, to: headerId, label: "Loop" });
    }

    bodyResult.exitPoints.forEach((ep) =>
      edges.push({ from: ep.id, to: headerId })
    );
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
    const conditionNode = whileNode.childForFieldName("condition");
    const bodyNode = whileNode.childForFieldName("body");

    if (!conditionNode || !bodyNode) {
      return this.processDefaultStatement(whileNode);
    }

    const conditionText = this.escapeString(conditionNode.text);
    const conditionId = this.generateNodeId("while_cond");
    const loopExitId = this.generateNodeId("while_exit");

    const nodes: FlowchartNode[] = [
      {
        id: conditionId,
        label: conditionText,
        shape: "diamond",
        style: this.nodeStyles.decision,
      },
      { id: loopExitId, label: "end loop", shape: "stadium" },
    ];
    this.locationMap.push({
      start: whileNode.startIndex,
      end: whileNode.endIndex,
      nodeId: conditionId,
    });

    const loopContext: LoopContext = {
      breakTargetId: loopExitId,
      continueTargetId: conditionId,
    };
    const bodyResult = this.processBlock(
      bodyNode,
      exitId,
      loopContext,
      finallyContext
    );
    nodes.push(...bodyResult.nodes);
    const edges: FlowchartEdge[] = [...bodyResult.edges];
    const nodesConnectedToExit = new Set<string>(
      bodyResult.nodesConnectedToExit
    );

    if (bodyResult.entryNodeId) {
      edges.push({
        from: conditionId,
        to: bodyResult.entryNodeId,
        label: "True",
      });
    } else {
      edges.push({ from: conditionId, to: conditionId, label: "True" });
    }

    bodyResult.exitPoints.forEach((ep) =>
      edges.push({ from: ep.id, to: conditionId })
    );
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
        const hofResult = this.processHigherOrderFunctionCall(
          hofInfo.hofCallNode
        );
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
            currentExits.forEach((ep) =>
              allEdges.push({ from: ep.id, to: convertId, label: ep.label })
            );
            currentExits = [{ id: convertId }];
          }

          const returnId = this.generateNodeId("return_hof");
          allNodes.push({
            id: returnId,
            label: "return result",
            shape: "stadium",
            style: this.nodeStyles.special,
          });
          this.locationMap.push({
            start: returnNode.startIndex,
            end: returnNode.endIndex,
            nodeId: returnId,
          });

          currentExits.forEach((ep) =>
            allEdges.push({ from: ep.id, to: returnId, label: ep.label })
          );
          allEdges.push({
            from: returnId,
            to: finallyContext ? finallyContext.finallyEntryId : exitId,
          });

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
    const labelText = valueNode
      ? `return ${this.escapeString(valueNode.text)}`
      : "return";
    const node: FlowchartNode = {
      id: nodeId,
      label: labelText,
      shape: "stadium",
      style: this.nodeStyles.special,
    };
    const edges: FlowchartEdge[] = [
      {
        from: nodeId,
        to: finallyContext ? finallyContext.finallyEntryId : exitId,
      },
    ];
    this.locationMap.push({
      start: returnNode.startIndex,
      end: returnNode.endIndex,
      nodeId,
    });

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
    const labelText =
      valueNodes.length > 0
        ? `raise ${this.escapeString(valueNodes.map((n) => n.text).join(", "))}`
        : "raise";

    const node: FlowchartNode = {
      id: nodeId,
      label: labelText,
      shape: "stadium",
      style: this.nodeStyles.special,
    };
    const edges: FlowchartEdge[] = [
      {
        from: nodeId,
        to: finallyContext ? finallyContext.finallyEntryId : exitId,
      },
    ];
    this.locationMap.push({
      start: raiseNode.startIndex,
      end: raiseNode.endIndex,
      nodeId,
    });

    return {
      nodes: [node],
      edges,
      entryNodeId: nodeId,
      exitPoints: [],
      nodesConnectedToExit: new Set<string>([nodeId]),
    };
  }

  private processBreakStatement(
    breakNode: Parser.SyntaxNode,
    loopContext: LoopContext
  ): ProcessResult {
    const nodeId = this.generateNodeId("break");
    const node: FlowchartNode = {
      id: nodeId,
      label: "break",
      shape: "stadium",
      style: this.nodeStyles.break,
    };
    const edges: FlowchartEdge[] = [
      { from: nodeId, to: loopContext.breakTargetId },
    ];
    this.locationMap.push({
      start: breakNode.startIndex,
      end: breakNode.endIndex,
      nodeId,
    });

    return {
      nodes: [node],
      edges,
      entryNodeId: nodeId,
      exitPoints: [],
      nodesConnectedToExit: new Set<string>([nodeId]),
    };
  }

  private processContinueStatement(
    continueNode: Parser.SyntaxNode,
    loopContext: LoopContext
  ): ProcessResult {
    const nodeId = this.generateNodeId("continue");
    const node: FlowchartNode = {
      id: nodeId,
      label: "continue",
      shape: "stadium",
      style: this.nodeStyles.break,
    };
    const edges: FlowchartEdge[] = [
      { from: nodeId, to: loopContext.continueTargetId },
    ];
    this.locationMap.push({
      start: continueNode.startIndex,
      end: continueNode.endIndex,
      nodeId,
    });

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
    const nodes: FlowchartNode[] = [
      {
        id: subjectId,
        label: `match ${this.escapeString(subjectNode.text)}`,
        shape: "rect",
        style: this.nodeStyles.process,
      },
    ];
    this.locationMap.push({
      start: subjectNode.startIndex,
      end: subjectNode.endIndex,
      nodeId: subjectId,
    });

    const edges: FlowchartEdge[] = [];
    const nodesConnectedToExit = new Set<string>();
    const allExitPoints: { id: string; label?: string }[] = [];
    let lastConditionExit: { id: string; label?: string } = { id: subjectId };

    const blockNode = matchNode.children.find(
      (child) => child.type === "block"
    );
    const caseClauses =
      blockNode?.children.filter((child) => child.type === "case_clause") || [];

    for (const clause of caseClauses) {
      const casePatternNode = clause.children.find(
        (c) => c.type === "case_pattern"
      );
      const guardNode = clause.childForFieldName("guard");
      const bodyNode = clause.children.find((c) => c.type === "block");
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
      this.locationMap.push({
        start: clause.startIndex,
        end: clause.endIndex,
        nodeId: caseConditionId,
      });

      edges.push({
        from: lastConditionExit.id,
        to: caseConditionId,
        label: lastConditionExit.label,
      });

      const bodyResult = this.processBlock(
        bodyNode,
        exitId,
        loopContext,
        finallyContext
      );
      nodes.push(...bodyResult.nodes);
      edges.push(...bodyResult.edges);
      bodyResult.nodesConnectedToExit.forEach((n) =>
        nodesConnectedToExit.add(n)
      );

      if (bodyResult.entryNodeId) {
        edges.push({
          from: caseConditionId,
          to: bodyResult.entryNodeId,
          label: "True",
        });
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

  private processSwitchStatement(
    switchNode: Parser.SyntaxNode,
    exitId: string,
    loopContext?: LoopContext,
    finallyContext?: { finallyEntryId: string }
  ): ProcessResult {
    const discriminantNode = switchNode.childForFieldName("value");
    if (!discriminantNode) return this.processDefaultStatement(switchNode);

    const switchHeaderId = this.generateNodeId("switch_header");
    const nodes: FlowchartNode[] = [
      {
        id: switchHeaderId,
        label: `switch (${this.escapeString(discriminantNode.text)})`,
        shape: "rect",
        style: this.nodeStyles.process,
      },
    ];
    this.locationMap.push({
      start: discriminantNode.startIndex,
      end: discriminantNode.endIndex,
      nodeId: switchHeaderId,
    });

    const edges: FlowchartEdge[] = [];
    const nodesConnectedToExit = new Set<string>();
    const allExitPoints: { id: string; label?: string }[] = [];
    let lastConditionExit: { id: string; label?: string } = {
      id: switchHeaderId,
    };

    const bodyNode = switchNode.childForFieldName("body");
    const caseClauses =
      bodyNode?.children.filter(
        (child) =>
          child.type === "switch_case" || child.type === "switch_default"
      ) || [];

    let hasDefault = false;

    for (const clause of caseClauses) {
      if (clause.type === "switch_default") {
        hasDefault = true;
        const bodyStatements = clause.children.filter((c) => c.type !== ":");
        if (bodyStatements.length > 0) {
          const bodyResult = this.processBlock(
            {
              type: "statement_block",
              children: bodyStatements,
              namedChildren: bodyStatements,
            } as Parser.SyntaxNode,
            exitId,
            loopContext,
            finallyContext
          );
          nodes.push(...bodyResult.nodes);
          edges.push(...bodyResult.edges);
          bodyResult.nodesConnectedToExit.forEach((n) =>
            nodesConnectedToExit.add(n)
          );

          if (bodyResult.entryNodeId) {
            edges.push({
              from: lastConditionExit.id,
              to: bodyResult.entryNodeId,
              label: lastConditionExit.label || "default",
            });
          } else {
            allExitPoints.push({ id: lastConditionExit.id, label: "default" });
          }
          allExitPoints.push(...bodyResult.exitPoints);
        }
      } else if (clause.type === "switch_case") {
        const valueNode = clause.childForFieldName("value");
        if (!valueNode) continue;

        const caseConditionId = this.generateNodeId("case");
        const caseLabel = `case ${this.escapeString(valueNode.text)}`;
        nodes.push({
          id: caseConditionId,
          label: caseLabel,
          shape: "diamond",
          style: this.nodeStyles.decision,
        });
        this.locationMap.push({
          start: clause.startIndex,
          end: clause.endIndex,
          nodeId: caseConditionId,
        });

        edges.push({
          from: lastConditionExit.id,
          to: caseConditionId,
          label: lastConditionExit.label,
        });

        const bodyStatements = clause.children.filter(
          (c) => c.type !== "case" && c.type !== ":" && c !== valueNode
        );

        if (bodyStatements.length > 0) {
          const bodyResult = this.processBlock(
            {
              type: "statement_block",
              children: bodyStatements,
              namedChildren: bodyStatements,
            } as Parser.SyntaxNode,
            exitId,
            loopContext,
            finallyContext
          );
          nodes.push(...bodyResult.nodes);
          edges.push(...bodyResult.edges);
          bodyResult.nodesConnectedToExit.forEach((n) =>
            nodesConnectedToExit.add(n)
          );

          if (bodyResult.entryNodeId) {
            edges.push({
              from: caseConditionId,
              to: bodyResult.entryNodeId,
              label: "match",
            });
          } else {
            allExitPoints.push({ id: caseConditionId, label: "match" });
          }
          allExitPoints.push(...bodyResult.exitPoints);
        }

        lastConditionExit = { id: caseConditionId, label: "no match" };
      }
    }

    if (!hasDefault) {
      allExitPoints.push(lastConditionExit);
    }

    return {
      nodes,
      edges,
      entryNodeId: switchHeaderId,
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
    const nodes: FlowchartNode[] = [
      { id: entryId, label: "try", shape: "stadium" },
    ];
    this.locationMap.push({
      start: tryNode.startIndex,
      end: tryNode.endIndex,
      nodeId: entryId,
    });

    const edges: FlowchartEdge[] = [];
    const nodesConnectedToExit = new Set<string>();
    let allExitPoints: { id: string; label?: string }[] = [];

    let newFinallyContext: { finallyEntryId: string } | undefined;
    let finallyResult: ProcessResult | null = null;
    const finallyClause = tryNode.children.find(
      (c) => c.type === "finally_clause"
    );

    if (finallyClause) {
      const finallyBody = finallyClause.namedChildren.find(
        (c) => c.type === "block"
      );
      finallyResult = this.processBlock(
        finallyBody!,
        exitId,
        loopContext,
        finallyContext
      );
      if (finallyResult.entryNodeId) {
        nodes.push(...finallyResult.nodes);
        edges.push(...finallyResult.edges);
        finallyResult.nodesConnectedToExit.forEach((n) =>
          nodesConnectedToExit.add(n)
        );
        newFinallyContext = { finallyEntryId: finallyResult.entryNodeId };
      }
    }

    const tryBody = tryNode.namedChildren.find((c) => c.type === "block");
    const tryResult = this.processBlock(
      tryBody!,
      exitId,
      loopContext,
      newFinallyContext || finallyContext
    );
    nodes.push(...tryResult.nodes);
    edges.push(...tryResult.edges);
    tryResult.nodesConnectedToExit.forEach((n) => nodesConnectedToExit.add(n));

    if (tryResult.entryNodeId) {
      edges.push({ from: entryId, to: tryResult.entryNodeId });
    } else if (finallyResult?.entryNodeId) {
      edges.push({ from: entryId, to: finallyResult.entryNodeId });
    } else {
      allExitPoints.push({ id: entryId });
    }

    tryResult.exitPoints.forEach((ep) => {
      if (finallyResult?.entryNodeId) {
        edges.push({
          from: ep.id,
          to: finallyResult.entryNodeId,
          label: ep.label,
        });
      } else {
        allExitPoints.push(ep);
      }
    });

    const exceptClauses = tryNode.children.filter(
      (c) => c.type === "except_clause"
    );
    for (const clause of exceptClauses) {
      const exceptBody = clause.namedChildren.find((c) => c.type === "block");
      const exceptTypeNode = clause.namedChildren.find(
        (c) => c.type !== "block"
      );
      const exceptType = exceptTypeNode
        ? this.escapeString(exceptTypeNode.text)
        : "exception";

      const exceptResult = this.processBlock(
        exceptBody!,
        exitId,
        loopContext,
        newFinallyContext || finallyContext
      );
      nodes.push(...exceptResult.nodes);
      edges.push(...exceptResult.edges);
      exceptResult.nodesConnectedToExit.forEach((n) =>
        nodesConnectedToExit.add(n)
      );

      if (exceptResult.entryNodeId) {
        edges.push({
          from: entryId,
          to: exceptResult.entryNodeId,
          label: `on ${exceptType}`,
        });
        exceptResult.exitPoints.forEach((ep) => {
          if (finallyResult?.entryNodeId) {
            edges.push({
              from: ep.id,
              to: finallyResult.entryNodeId,
              label: ep.label,
            });
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
    const withClauseNode = withNode.children.find(
      (c: Parser.SyntaxNode) => c.type === "with_clause"
    );
    const withEntryId = this.generateNodeId("with");
    const nodes: FlowchartNode[] = [
      {
        id: withEntryId,
        label: this.escapeString(withClauseNode?.text || "with ..."),
        shape: "rect",
        style: this.nodeStyles.special,
      },
    ];
    this.locationMap.push({
      start: withNode.startIndex,
      end: withNode.endIndex,
      nodeId: withEntryId,
    });

    const edges: FlowchartEdge[] = [];
    const body = withNode.childForFieldName("body");
    if (body) {
      const bodyResult = this.processBlock(
        body,
        exitId,
        loopContext,
        finallyContext
      );
      nodes.push(...bodyResult.nodes);
      edges.push(...bodyResult.edges);

      if (bodyResult.entryNodeId)
        edges.push({ from: withEntryId, to: bodyResult.entryNodeId });

      return {
        nodes,
        edges,
        entryNodeId: withEntryId,
        exitPoints:
          bodyResult.exitPoints.length > 0
            ? bodyResult.exitPoints
            : [{ id: withEntryId }],
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
    const nodes: FlowchartNode[] = [
      {
        id: conditionId,
        label: `assert ${this.escapeString(conditionNode.text)}`,
        shape: "diamond",
        style: this.nodeStyles.decision,
      },
    ];
    this.locationMap.push({
      start: assertNode.startIndex,
      end: assertNode.endIndex,
      nodeId: conditionId,
    });

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
      {
        from: raiseNodeId,
        to: finallyContext ? finallyContext.finallyEntryId : exitId,
      },
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
      const result = this.processHigherOrderFunctionCall(argNode);
      if (result) return result;
    }

    const nodeId = this.generateNodeId("input");
    const node: FlowchartNode = {
      id: nodeId,
      label: `Input: ${this.escapeString(argNode.text)}`,
      shape: "rect",
      style: this.nodeStyles.special,
    };
    this.locationMap.push({
      start: argNode.startIndex,
      end: argNode.endIndex,
      nodeId,
    });
    return {
      nodes: [node],
      edges: [],
      entryNodeId: nodeId,
      exitPoints: [{ id: nodeId }],
      nodesConnectedToExit: new Set<string>(),
    };
  }

  private processHigherOrderFunctionCall(
    callNode: Parser.SyntaxNode
  ): ProcessResult | null {
    const functionNode = callNode.childForFieldName("function");
    if (!functionNode) return null;

    const functionName = functionNode.text?.split(".").pop();
    if (!functionName) return null;

    switch (functionName) {
      case "map":
        return this.processMap(callNode);
      case "filter":
        return this.processFilter(callNode);
      case "reduce":
        return this.processReduce(callNode);
      default:
        return null;
    }
  }

  private processMap(callNode: Parser.SyntaxNode): ProcessResult {
    const args = callNode.childForFieldName("arguments")?.namedChildren || [];
    if (args.length < 2) return this.processDefaultStatement(callNode);

    const [functionArg, iterableArgNode] = args;
    const functionText = this.escapeString(functionArg.text);
    let lambdaBodyText = `${functionText}(item)`;

    if (functionArg.type === "lambda") {
      const bodyNode = functionArg.childForFieldName("body");
      if (bodyNode) {
        lambdaBodyText = this.escapeString(bodyNode.text);
      }
    }

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
    iterableResult.exitPoints.forEach((ep) =>
      edges.push({ from: ep.id, to: mapId, label: ep.label })
    );

    const applyId = this.generateNodeId("map_apply");
    nodes.push({
      id: applyId,
      label: `Apply lambda to each element: new_item = ${lambdaBodyText}`,
      shape: "rect",
      style: this.nodeStyles.process,
    });
    this.locationMap.push({
      start: functionArg.startIndex,
      end: functionArg.endIndex,
      nodeId: applyId,
    });
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
    iterableResult.exitPoints.forEach((ep) =>
      edges.push({ from: ep.id, to: filterId, label: ep.label })
    );

    const applyId = this.generateNodeId("filter_apply");
    nodes.push({
      id: applyId,
      label: `Apply lambda to each element`,
      shape: "rect",
      style: this.nodeStyles.process,
    });
    this.locationMap.push({
      start: functionArg.startIndex,
      end: functionArg.endIndex,
      nodeId: applyId,
    });
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
      this.locationMap.push({
        start: initializerArgNode.startIndex,
        end: initializerArgNode.endIndex,
        nodeId: initId,
      });
    }
    iterableResult.exitPoints.forEach((ep) =>
      edges.push({ from: ep.id, to: initId, label: ep.label })
    );

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
      label: `accumulator = ${this.escapeString(
        functionArg.text
      )}(accumulator, item)`,
      shape: "rect",
      style: this.nodeStyles.process,
    });
    this.locationMap.push({
      start: functionArg.startIndex,
      end: functionArg.endIndex,
      nodeId: applyId,
    });
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

  private processDebuggerStatement(
    statement: Parser.SyntaxNode
  ): ProcessResult {
    const nodeId = this.generateNodeId("debugger");
    const node: FlowchartNode = {
      id: nodeId,
      label: "debugger",
      shape: "rect",
      style: this.nodeStyles.special,
    };
    this.locationMap.push({
      start: statement.startIndex,
      end: statement.endIndex,
      nodeId,
    });
    return {
      nodes: [node],
      edges: [],
      entryNodeId: nodeId,
      exitPoints: [{ id: nodeId }],
      nodesConnectedToExit: new Set<string>(),
    };
  }

  private processForInStatement(
    forNode: Parser.SyntaxNode,
    exitId: string,
    finallyContext?: { finallyEntryId: string }
  ): ProcessResult {
    const leftNode = forNode.childForFieldName("left");
    const rightNode = forNode.childForFieldName("right");
    const bodyNode = forNode.childForFieldName("body");

    if (!leftNode || !rightNode || !bodyNode) {
      return this.processDefaultStatement(forNode);
    }

    const left = leftNode.text;
    const right = rightNode.text;
    const headerId = this.generateNodeId("for_in_header");
    const loopExitId = this.generateNodeId("for_in_exit");

    const nodes: FlowchartNode[] = [
      {
        id: headerId,
        label: this.escapeString(`for (${left} in ${right})`),
        shape: "diamond",
        style: this.nodeStyles.decision,
      },
      { id: loopExitId, label: "end loop", shape: "stadium" },
    ];
    this.locationMap.push({
      start: forNode.startIndex,
      end: forNode.endIndex,
      nodeId: headerId,
    });

    const loopContext: LoopContext = {
      breakTargetId: loopExitId,
      continueTargetId: headerId,
    };
    const bodyResult = this.processBlock(
      bodyNode,
      exitId,
      loopContext,
      finallyContext
    );
    nodes.push(...bodyResult.nodes);
    const edges: FlowchartEdge[] = [...bodyResult.edges];
    const nodesConnectedToExit = new Set<string>(
      bodyResult.nodesConnectedToExit
    );

    if (bodyResult.entryNodeId) {
      edges.push({ from: headerId, to: bodyResult.entryNodeId, label: "Loop" });
    } else {
      edges.push({ from: headerId, to: headerId, label: "Loop" });
    }

    bodyResult.exitPoints.forEach((ep) =>
      edges.push({ from: ep.id, to: headerId })
    );
    edges.push({ from: headerId, to: loopExitId, label: "End Loop" });

    return {
      nodes,
      edges,
      entryNodeId: headerId,
      exitPoints: [{ id: loopExitId }],
      nodesConnectedToExit,
    };
  }

  private processDoWhileStatement(
    doNode: Parser.SyntaxNode,
    exitId: string,
    finallyContext?: { finallyEntryId: string }
  ): ProcessResult {
    const bodyNode = doNode.childForFieldName("body");
    const conditionNode = doNode.childForFieldName("condition");

    if (!bodyNode || !conditionNode) {
      return this.processDefaultStatement(doNode);
    }

    const entryId = this.generateNodeId("do_entry");
    const conditionId = this.generateNodeId("do_condition");
    const loopExitId = this.generateNodeId("do_exit");

    const nodes: FlowchartNode[] = [
      {
        id: entryId,
        label: "do",
        shape: "rect",
        style: this.nodeStyles.process,
      },
      {
        id: conditionId,
        label: this.escapeString(conditionNode.text),
        shape: "diamond",
        style: this.nodeStyles.decision,
      },
      { id: loopExitId, label: "end loop", shape: "stadium" },
    ];
    this.locationMap.push({
      start: doNode.startIndex,
      end: doNode.endIndex,
      nodeId: entryId,
    });

    const loopContext: LoopContext = {
      breakTargetId: loopExitId,
      continueTargetId: conditionId,
    };
    const bodyResult = this.processBlock(
      bodyNode,
      exitId,
      loopContext,
      finallyContext
    );
    nodes.push(...bodyResult.nodes);
    const edges: FlowchartEdge[] = [...bodyResult.edges];
    const nodesConnectedToExit = new Set<string>(
      bodyResult.nodesConnectedToExit
    );

    if (bodyResult.entryNodeId) {
      edges.push({ from: entryId, to: bodyResult.entryNodeId });
    } else {
      edges.push({ from: entryId, to: conditionId });
    }

    bodyResult.exitPoints.forEach((ep) =>
      edges.push({ from: ep.id, to: conditionId })
    );
    edges.push({ from: conditionId, to: entryId, label: "True" });
    edges.push({ from: conditionId, to: loopExitId, label: "False" });

    return {
      nodes,
      edges,
      entryNodeId: entryId,
      exitPoints: [{ id: loopExitId }],
      nodesConnectedToExit,
    };
  }
}
