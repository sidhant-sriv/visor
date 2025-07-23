import Parser from "tree-sitter";
import Cpp from "tree-sitter-cpp";
import {
  FlowchartIR,
  FlowchartNode,
  FlowchartEdge,
  LocationMapEntry,
} from "../../../ir/ir";
import { AbstractParser } from "../../common/AbstractParser";
import { ProcessResult, LoopContext } from "../../common/AstParserTypes";

interface TreeSitterLanguage {
  name: string;
  language: unknown;
  nodeTypeInfo?: unknown;
}

type CppLanguage = TreeSitterLanguage;

export class CppAstParser extends AbstractParser {
  protected log(message: string, ...args: any[]) {
    if (this.debug) console.log(`[CppAstParser] ${message}`, ...args);
  }

  protected getParser(): Parser {
    return this.getCachedParser("cpp", () => {
      const parser = new Parser();
      parser.setLanguage(Cpp as CppLanguage);
      return parser;
    });
  }

  public listFunctions(sourceCode: string): string[] {
    return this.measurePerformance("listFunctions", () => {
      const parser = this.getParser();
      const tree = parser.parse(sourceCode);

      // Find function definitions
      const functionNames = tree.rootNode
        .descendantsOfType("function_definition")
        .map((func: Parser.SyntaxNode) => {
          const declarator = func.childForFieldName("declarator");
          if (declarator) {
            const identifier = this.extractFunctionName(declarator);
            return identifier || "[anonymous]";
          }
          return "[anonymous]";
        });

      // Find method definitions (inside classes)
      const methodNames = tree.rootNode
        .descendantsOfType("function_definition")
        .filter((func: Parser.SyntaxNode) => {
          // Check if this function is inside a class
          let parent = func.parent;
          while (parent) {
            if (
              parent.type === "class_specifier" ||
              parent.type === "struct_specifier"
            ) {
              return true;
            }
            parent = parent.parent;
          }
          return false;
        })
        .map((method: Parser.SyntaxNode) => {
          const declarator = method.childForFieldName("declarator");
          if (declarator) {
            const identifier = this.extractFunctionName(declarator);
            return identifier ? `${identifier}()` : "[anonymous method]";
          }
          return "[anonymous method]";
        });

      // Find constructor definitions
      const constructorNames = tree.rootNode
        .descendantsOfType("function_definition")
        .filter((func: Parser.SyntaxNode) => {
          const declarator = func.childForFieldName("declarator");
          if (declarator) {
            const name = this.extractFunctionName(declarator);
            // Check if this is a constructor (function name matches class name)
            let parent = func.parent;
            while (parent) {
              if (parent.type === "class_specifier") {
                const className = parent.childForFieldName("name")?.text;
                return name === className;
              }
              parent = parent.parent;
            }
          }
          return false;
        })
        .map((constructor: Parser.SyntaxNode) => {
          const declarator = constructor.childForFieldName("declarator");
          if (declarator) {
            const identifier = this.extractFunctionName(declarator);
            return identifier ? `${identifier}()` : "[anonymous constructor]";
          }
          return "[anonymous constructor]";
        });

      return [...functionNames, ...methodNames, ...constructorNames];
    });
  }

  private extractFunctionName(
    declarator: Parser.SyntaxNode
  ): string | undefined {
    // Handle different types of declarators
    if (declarator.type === "function_declarator") {
      const declaratorChild = declarator.childForFieldName("declarator");
      if (declaratorChild) {
        return this.extractFunctionName(declaratorChild);
      }
    } else if (declarator.type === "identifier") {
      return declarator.text;
    } else if (declarator.type === "qualified_identifier") {
      const name = declarator.childForFieldName("name");
      return name?.text;
    } else if (declarator.type === "destructor_name") {
      return declarator.text;
    }

    // For other complex declarators, try to find an identifier
    const identifier = declarator.descendantsOfType("identifier")[0];
    return identifier?.text;
  }

  public findFunctionAtPosition(
    sourceCode: string,
    position: number
  ): string | undefined {
    const parser = this.getParser();
    const tree = parser.parse(sourceCode);

    // Check for function definition
    const func = tree.rootNode
      .descendantsOfType("function_definition")
      .find((f) => position >= f.startIndex && position <= f.endIndex);

    if (func) {
      const declarator = func.childForFieldName("declarator");
      if (declarator) {
        return this.extractFunctionName(declarator) || "[anonymous]";
      }
    }

    return undefined;
  }

  public generateFlowchart(
    sourceCode: string,
    functionName?: string,
    position?: number
  ): FlowchartIR {
    return this.measurePerformance("generateFlowchart", () => {
      this.resetState();
      const parser = this.getParser();
      const tree = parser.parse(sourceCode);

      let targetFunction: Parser.SyntaxNode | undefined;

      if (position !== undefined) {
        // Find function at position
        targetFunction = this.findFunctionNodeAtPosition(
          tree.rootNode,
          position
        );
      } else if (functionName) {
        // Find function by name
        targetFunction = this.findFunctionByName(tree.rootNode, functionName);
      }

      if (!targetFunction) {
        this.log("No function found, analyzing entire code");
        const result = this.processBlock(tree.rootNode, "END");
        return {
          nodes: result.nodes,
          edges: result.edges,
          locationMap: this.locationMap,
        };
      }

      this.log(`Processing function: ${functionName || "at position"}`);
      const body = targetFunction.childForFieldName("body");
      const result = this.processBlock(body, "END");

      // Add start and end nodes
      const startNode: FlowchartNode = {
        id: "START",
        label: "START",
        shape: "stadium",
        style: this.nodeStyles.terminator,
      };

      const endNode: FlowchartNode = {
        id: "END",
        label: "END",
        shape: "stadium",
        style: this.nodeStyles.terminator,
      };

      const nodes = [startNode, ...result.nodes, endNode];
      const edges = [...result.edges];

      // Connect start to entry
      if (result.entryNodeId) {
        edges.push({ from: "START", to: result.entryNodeId });
      } else {
        edges.push({ from: "START", to: "END" });
      }

      // Connect exit points to end
      for (const exitPoint of result.exitPoints) {
        edges.push({
          from: exitPoint.id,
          to: "END",
          label: exitPoint.label,
        });
      }

      return {
        nodes,
        edges,
        locationMap: this.locationMap,
      };
    });
  }

  private findFunctionNodeAtPosition(
    node: Parser.SyntaxNode,
    position: number
  ): Parser.SyntaxNode | undefined {
    const func = node
      .descendantsOfType("function_definition")
      .find((f) => position >= f.startIndex && position <= f.endIndex);

    return func;
  }

  private findFunctionByName(
    node: Parser.SyntaxNode,
    functionName: string
  ): Parser.SyntaxNode | undefined {
    // Remove parentheses from function name if present
    const cleanFunctionName = functionName.replace(/\(\)$/, "");

    const func = node.descendantsOfType("function_definition").find((f) => {
      const declarator = f.childForFieldName("declarator");
      if (declarator) {
        const extractedName = this.extractFunctionName(declarator);
        return extractedName === cleanFunctionName;
      }
      return false;
    });

    return func;
  }

  protected processStatement(
    statement: Parser.SyntaxNode,
    exitId: string,
    loopContext?: LoopContext
  ): ProcessResult {
    this.log(`Processing statement: ${statement.type}`);

    switch (statement.type) {
      case "if_statement":
        return this.processIfStatement(statement, exitId, loopContext);
      case "while_statement":
        return this.processWhileStatement(statement, exitId, loopContext);
      case "for_statement":
      case "for_range_loop":
      case "range_based_for_statement":
        return this.processForStatement(statement, exitId, loopContext);
      case "do_statement":
        return this.processDoWhileStatement(statement, exitId, loopContext);
      case "switch_statement":
        return this.processSwitchStatement(statement, exitId, loopContext);
      case "try_statement":
        return this.processTryStatement(statement, exitId, loopContext);
      case "break_statement":
        return this.processBreakStatement(statement, loopContext);
      case "continue_statement":
        return this.processContinueStatement(statement, loopContext);
      case "return_statement":
        return this.processReturnStatement(statement, exitId);
      case "throw_statement":
        return this.processThrowStatement(statement, exitId);
      case "compound_statement":
        return this.processBlock(statement, exitId, loopContext);
      case "expression_statement":
      case "declaration":
      case "assignment_expression":
      // C++ specific declaration types that can be statements
      case "simple_declaration":
      case "init_declarator":
      case "type_definition":
      case "alias_declaration":
      case "using_declaration":
      case "namespace_definition":
      case "linkage_specification":
      case "static_assert_declaration":
      case "template_declaration":
      case "template_instantiation":
      case "function_definition":
      case "constructor_definition":
      case "destructor_definition":
      case "friend_declaration":
      // C++ specific statement types
      case "labeled_statement":
      case "goto_statement":
      case "co_return_statement":
      case "co_yield_statement":
      case "co_await_expression":
      // Expression types that can be statements
      case "call_expression":
      case "update_expression":
      case "unary_expression":
      case "binary_expression":
      case "conditional_expression":
      case "cast_expression":
      case "new_expression":
      case "delete_expression":
      case "lambda_expression":
      case "subscript_expression":
      case "field_expression":
      case "pointer_expression":
      case "sizeof_expression":
      case "alignof_expression":
      case "offsetof_expression":
      case "typeid_expression":
      // Other statement types
      case "empty_statement":
      case "asm_statement":
      // Modern C++ statements
      case "if_statement_with_initializer":
      case "switch_statement_with_initializer":
      case "structured_binding_declaration":
      case "decomposition_declaration":
      case "co_yield_expression":
      default:
        return this.processDefaultStatement(statement);
    }
  }

  private processIfStatement(
    statement: Parser.SyntaxNode,
    exitId: string,
    loopContext?: LoopContext
  ): ProcessResult {
    const conditionNode = statement.childForFieldName("condition");
    const conditionText = conditionNode?.text || "condition";

    const decisionNodeId = this.generateNodeId("if");
    const decisionNode: FlowchartNode = {
      id: decisionNodeId,
      label: `if (${this.escapeString(conditionText)})`,
      shape: "diamond",
      style: this.nodeStyles.decision,
    };

    this.locationMap.push({
      start: statement.startIndex,
      end: statement.endIndex,
      nodeId: decisionNodeId,
    });

    const nodes: FlowchartNode[] = [decisionNode];
    const edges: FlowchartEdge[] = [];

    // Process then branch
    const thenStatement = statement.childForFieldName("consequence");
    const thenResult = thenStatement
      ? this.processStatement(thenStatement, exitId, loopContext)
      : this.createProcessResult();

    nodes.push(...thenResult.nodes);
    edges.push(...thenResult.edges);

    // Connect decision to then branch
    if (thenResult.entryNodeId) {
      edges.push({
        from: decisionNodeId,
        to: thenResult.entryNodeId,
        label: "true",
      });
    }

    let exitPoints: { id: string; label?: string }[] = [
      ...thenResult.exitPoints,
    ];

    // Process else branch
    const elseStatement = statement.childForFieldName("alternative");
    if (elseStatement) {
      const elseResult = this.processStatement(
        elseStatement,
        exitId,
        loopContext
      );
      nodes.push(...elseResult.nodes);
      edges.push(...elseResult.edges);

      if (elseResult.entryNodeId) {
        edges.push({
          from: decisionNodeId,
          to: elseResult.entryNodeId,
          label: "false",
        });
      }

      exitPoints.push(...elseResult.exitPoints);
    } else {
      // No else branch - decision node connects directly to exit
      exitPoints.push({ id: decisionNodeId, label: "false" });
    }

    return this.createProcessResult(
      nodes,
      edges,
      decisionNodeId,
      exitPoints,
      new Set([...thenResult.nodesConnectedToExit])
    );
  }

  private processWhileStatement(
    statement: Parser.SyntaxNode,
    exitId: string,
    loopContext?: LoopContext
  ): ProcessResult {
    const conditionNode = statement.childForFieldName("condition");
    const conditionText = conditionNode?.text || "condition";

    const loopNodeId = this.generateNodeId("while");
    const loopNode: FlowchartNode = {
      id: loopNodeId,
      label: `while (${this.escapeString(conditionText)})`,
      shape: "diamond",
      style: this.nodeStyles.decision,
    };

    this.locationMap.push({
      start: statement.startIndex,
      end: statement.endIndex,
      nodeId: loopNodeId,
    });

    const newLoopContext: LoopContext = {
      continueTargetId: loopNodeId,
      breakTargetId: exitId,
    };

    const bodyStatement = statement.childForFieldName("body");
    const bodyResult = bodyStatement
      ? this.processStatement(bodyStatement, loopNodeId, newLoopContext)
      : this.createProcessResult();

    const nodes = [loopNode, ...bodyResult.nodes];
    const edges = [...bodyResult.edges];

    // Connect loop condition to body
    if (bodyResult.entryNodeId) {
      edges.push({
        from: loopNodeId,
        to: bodyResult.entryNodeId,
        label: "true",
      });
    }

    // Connect body exit points back to loop condition
    for (const exitPoint of bodyResult.exitPoints) {
      edges.push({
        from: exitPoint.id,
        to: loopNodeId,
        label: exitPoint.label,
      });
    }

    // Loop exits when condition is false
    return this.createProcessResult(
      nodes,
      edges,
      loopNodeId,
      [{ id: loopNodeId, label: "false" }],
      bodyResult.nodesConnectedToExit
    );
  }

  private processForStatement(
    statement: Parser.SyntaxNode,
    exitId: string,
    loopContext?: LoopContext
  ): ProcessResult {
    let loopText = "for";

    if (
      statement.type === "for_range_loop" ||
      statement.type === "range_based_for_statement"
    ) {
      // Range-based for loop (C++11)
      const declarator = statement.childForFieldName("declarator");
      const right = statement.childForFieldName("right");
      loopText = `for (${declarator?.text || "item"} : ${
        right?.text || "range"
      })`;
    } else {
      // Traditional for loop
      const initializer = statement.childForFieldName("initializer");
      const condition = statement.childForFieldName("condition");
      const update = statement.childForFieldName("update");

      loopText = `for (${initializer?.text || ""}; ${condition?.text || ""}; ${
        update?.text || ""
      })`;
    }

    const loopNodeId = this.generateNodeId("for");
    const loopNode: FlowchartNode = {
      id: loopNodeId,
      label: this.escapeString(loopText),
      shape: "diamond",
      style: this.nodeStyles.decision,
    };

    this.locationMap.push({
      start: statement.startIndex,
      end: statement.endIndex,
      nodeId: loopNodeId,
    });

    const newLoopContext: LoopContext = {
      continueTargetId: loopNodeId,
      breakTargetId: exitId,
    };

    const bodyStatement = statement.childForFieldName("body");
    const bodyResult = bodyStatement
      ? this.processStatement(bodyStatement, loopNodeId, newLoopContext)
      : this.createProcessResult();

    const nodes = [loopNode, ...bodyResult.nodes];
    const edges = [...bodyResult.edges];

    // Connect loop to body
    if (bodyResult.entryNodeId) {
      edges.push({
        from: loopNodeId,
        to: bodyResult.entryNodeId,
        label: "true",
      });
    }

    // Connect body back to loop
    for (const exitPoint of bodyResult.exitPoints) {
      edges.push({
        from: exitPoint.id,
        to: loopNodeId,
        label: exitPoint.label,
      });
    }

    return this.createProcessResult(
      nodes,
      edges,
      loopNodeId,
      [{ id: loopNodeId, label: "false" }],
      bodyResult.nodesConnectedToExit
    );
  }

  private processDoWhileStatement(
    statement: Parser.SyntaxNode,
    exitId: string,
    loopContext?: LoopContext
  ): ProcessResult {
    const conditionNode = statement.childForFieldName("condition");
    const conditionText = conditionNode?.text || "condition";

    const loopNodeId = this.generateNodeId("dowhile");
    const loopNode: FlowchartNode = {
      id: loopNodeId,
      label: `while (${this.escapeString(conditionText)})`,
      shape: "diamond",
      style: this.nodeStyles.decision,
    };

    const newLoopContext: LoopContext = {
      continueTargetId: loopNodeId,
      breakTargetId: exitId,
    };

    const bodyStatement = statement.childForFieldName("body");
    const bodyResult = bodyStatement
      ? this.processStatement(bodyStatement, loopNodeId, newLoopContext)
      : this.createProcessResult();

    const nodes = [...bodyResult.nodes, loopNode];
    const edges = [...bodyResult.edges];

    this.locationMap.push({
      start: statement.startIndex,
      end: statement.endIndex,
      nodeId: loopNodeId,
    });

    // Connect body to condition check
    for (const exitPoint of bodyResult.exitPoints) {
      edges.push({
        from: exitPoint.id,
        to: loopNodeId,
        label: exitPoint.label,
      });
    }

    // Loop back to body if condition is true
    if (bodyResult.entryNodeId) {
      edges.push({
        from: loopNodeId,
        to: bodyResult.entryNodeId,
        label: "true",
      });
    }

    return this.createProcessResult(
      nodes,
      edges,
      bodyResult.entryNodeId,
      [{ id: loopNodeId, label: "false" }],
      bodyResult.nodesConnectedToExit
    );
  }

  private processSwitchStatement(
    statement: Parser.SyntaxNode,
    exitId: string,
    loopContext?: LoopContext
  ): ProcessResult {
    const conditionNode = statement.childForFieldName("condition");
    const conditionText = conditionNode?.text || "condition";

    const switchNodeId = this.generateNodeId("switch");
    const switchNode: FlowchartNode = {
      id: switchNodeId,
      label: `switch (${this.escapeString(conditionText)})`,
      shape: "diamond",
      style: this.nodeStyles.decision,
    };

    this.locationMap.push({
      start: statement.startIndex,
      end: statement.endIndex,
      nodeId: switchNodeId,
    });

    const nodes: FlowchartNode[] = [switchNode];
    const edges: FlowchartEdge[] = [];
    const exitPoints: { id: string; label?: string }[] = [];

    // Process switch body
    const body = statement.childForFieldName("body");
    if (body) {
      const cases = body.namedChildren.filter(
        (child) =>
          child.type === "case_statement" || child.type === "default_statement"
      );

      for (const caseNode of cases) {
        if (caseNode.type === "case_statement") {
          const value = caseNode.childForFieldName("value");
          const caseText = `case ${value?.text || "value"}`;

          const caseResult = this.processBlock(caseNode, exitId, loopContext);
          nodes.push(...caseResult.nodes);
          edges.push(...caseResult.edges);

          if (caseResult.entryNodeId) {
            edges.push({
              from: switchNodeId,
              to: caseResult.entryNodeId,
              label: caseText,
            });
            exitPoints.push(...caseResult.exitPoints);
          }
        } else if (caseNode.type === "default_statement") {
          const caseResult = this.processBlock(caseNode, exitId, loopContext);
          nodes.push(...caseResult.nodes);
          edges.push(...caseResult.edges);

          if (caseResult.entryNodeId) {
            edges.push({
              from: switchNodeId,
              to: caseResult.entryNodeId,
              label: "default",
            });
            exitPoints.push(...caseResult.exitPoints);
          }
        }
      }
    }

    // If no cases processed anything, switch goes directly to exit
    if (exitPoints.length === 0) {
      exitPoints.push({ id: switchNodeId });
    }

    return this.createProcessResult(
      nodes,
      edges,
      switchNodeId,
      exitPoints,
      new Set()
    );
  }

  private processTryStatement(
    statement: Parser.SyntaxNode,
    exitId: string,
    loopContext?: LoopContext
  ): ProcessResult {
    const entryId = this.generateNodeId("try_entry");
    const entryNode: FlowchartNode = {
      id: entryId,
      label: "try",
      shape: "stadium",
      style: this.nodeStyles.special,
    };

    this.locationMap.push({
      start: statement.startIndex,
      end: statement.endIndex,
      nodeId: entryId,
    });

    const nodes: FlowchartNode[] = [entryNode];
    const edges: FlowchartEdge[] = [];
    const nodesConnectedToExit = new Set<string>();
    let allExitPoints: { id: string; label?: string }[] = [];

    // Process try block
    const tryBodyNode = statement.childForFieldName("body");
    const tryResult = tryBodyNode
      ? this.processStatement(tryBodyNode, exitId, loopContext)
      : this.createProcessResult();

    nodes.push(...tryResult.nodes);
    edges.push(...tryResult.edges);
    tryResult.nodesConnectedToExit.forEach((n) => nodesConnectedToExit.add(n));

    // Connect entry to try block
    if (tryResult.entryNodeId) {
      edges.push({ from: entryId, to: tryResult.entryNodeId });
    } else {
      allExitPoints.push({ id: entryId });
    }

    // Normal exit points from try block (no exception)
    allExitPoints.push(...tryResult.exitPoints);

    // Process catch clauses
    const catchClauses = statement.namedChildren.filter(
      (child) => child.type === "catch_clause"
    );

    for (const catchClause of catchClauses) {
      const catchBody = catchClause.childForFieldName("body");
      const parameter = catchClause.childForFieldName("parameter");

      // Extract exception type from parameter
      let exceptionType = "...";
      if (parameter) {
        // Try different ways to extract the type from C++ catch parameter
        const typeNode = parameter.namedChildren.find(
          (child) =>
            child.type === "type_identifier" ||
            child.type === "primitive_type" ||
            child.type === "qualified_identifier" ||
            child.type === "parameter_declaration"
        );

        if (typeNode) {
          if (typeNode.type === "parameter_declaration") {
            // For parameter_declaration, look for the type within it
            const innerType = typeNode.namedChildren.find(
              (child) =>
                child.type === "type_identifier" ||
                child.type === "primitive_type" ||
                child.type === "qualified_identifier"
            );
            exceptionType = innerType ? innerType.text : typeNode.text;
          } else {
            exceptionType = typeNode.text;
          }
        } else {
          // Fallback: try to get a meaningful name from the parameter text
          const paramText = parameter.text;
          // Extract type from patterns like "const std::exception& e" or "int x"
          const typeMatch = paramText.match(
            /(?:const\s+)?([a-zA-Z_:][a-zA-Z0-9_:]*)/
          );
          if (typeMatch) {
            exceptionType = typeMatch[1];
          }
        }
      }

      // Create a dedicated catch entry node
      const catchEntryId = this.generateNodeId("catch_entry");
      const catchEntryNode: FlowchartNode = {
        id: catchEntryId,
        label: `catch (${exceptionType})`,
        shape: "stadium",
        style: this.nodeStyles.special,
      };

      if (catchBody) {
        const catchBodyResult = this.processStatement(
          catchBody,
          exitId,
          loopContext
        );

        // Combine catch entry with catch body
        nodes.push(catchEntryNode, ...catchBodyResult.nodes);
        edges.push(...catchBodyResult.edges);
        catchBodyResult.nodesConnectedToExit.forEach((n) =>
          nodesConnectedToExit.add(n)
        );

        // Connect try entry to catch entry node (represents exception path from try block)
        edges.push({
          from: entryId,
          to: catchEntryId,
          label: `on ${exceptionType}`,
        });

        // Connect catch entry to catch body
        if (catchBodyResult.entryNodeId) {
          edges.push({
            from: catchEntryId,
            to: catchBodyResult.entryNodeId,
          });
        }

        allExitPoints.push(...catchBodyResult.exitPoints);
      }
    }

    return this.createProcessResult(
      nodes,
      edges,
      entryId,
      allExitPoints,
      nodesConnectedToExit
    );
  }

  private processBreakStatement(
    statement: Parser.SyntaxNode,
    loopContext?: LoopContext
  ): ProcessResult {
    const nodeId = this.generateNodeId("break");
    const node: FlowchartNode = {
      id: nodeId,
      label: "break",
      shape: "rect",
      style: this.nodeStyles.break,
    };

    this.locationMap.push({
      start: statement.startIndex,
      end: statement.endIndex,
      nodeId,
    });

    const edges: FlowchartEdge[] = [];
    if (loopContext) {
      edges.push({ from: nodeId, to: loopContext.breakTargetId });
    }

    return this.createProcessResult(
      [node],
      edges,
      nodeId,
      [], // Break doesn't have normal exit points
      new Set([nodeId])
    );
  }

  private processContinueStatement(
    statement: Parser.SyntaxNode,
    loopContext?: LoopContext
  ): ProcessResult {
    const nodeId = this.generateNodeId("continue");
    const node: FlowchartNode = {
      id: nodeId,
      label: "continue",
      shape: "rect",
      style: this.nodeStyles.break,
    };

    this.locationMap.push({
      start: statement.startIndex,
      end: statement.endIndex,
      nodeId,
    });

    const edges: FlowchartEdge[] = [];
    if (loopContext) {
      edges.push({ from: nodeId, to: loopContext.continueTargetId });
    }

    return this.createProcessResult(
      [node],
      edges,
      nodeId,
      [], // Continue doesn't have normal exit points
      new Set([nodeId])
    );
  }

  private processReturnStatement(
    statement: Parser.SyntaxNode,
    exitId: string
  ): ProcessResult {
    const valueNode = statement.namedChildren[0];
    const returnText = valueNode ? `return ${valueNode.text}` : "return";

    const nodeId = this.generateNodeId("return");
    const node: FlowchartNode = {
      id: nodeId,
      label: this.escapeString(returnText),
      shape: "rect",
      style: this.nodeStyles.special,
    };

    this.locationMap.push({
      start: statement.startIndex,
      end: statement.endIndex,
      nodeId,
    });

    return this.createProcessResult(
      [node],
      [{ from: nodeId, to: exitId }],
      nodeId,
      [], // Return goes directly to exit
      new Set([nodeId])
    );
  }

  private processThrowStatement(
    statement: Parser.SyntaxNode,
    exitId: string
  ): ProcessResult {
    const exceptionNode = statement.namedChildren[0];
    const throwText = exceptionNode ? `throw ${exceptionNode.text}` : "throw";

    const nodeId = this.generateNodeId("throw");
    const node: FlowchartNode = {
      id: nodeId,
      label: this.escapeString(throwText),
      shape: "rect",
      style: this.nodeStyles.special,
    };

    this.locationMap.push({
      start: statement.startIndex,
      end: statement.endIndex,
      nodeId,
    });

    return this.createProcessResult(
      [node],
      [{ from: nodeId, to: exitId }],
      nodeId,
      [], // Throw goes directly to exit (or catch handler)
      new Set([nodeId])
    );
  }

  protected processBlock(
    blockNode: Parser.SyntaxNode | null,
    exitId: string,
    loopContext?: LoopContext
  ): ProcessResult {
    if (!blockNode) {
      return this.createProcessResult();
    }

    // Filter out comments, preprocessor directives, and non-executable constructs for C++
    const statements = blockNode.namedChildren.filter(
      (s) =>
        ![
          "comment",
          "preproc_include",
          "preproc_define",
          "preproc_ifdef",
          "preproc_ifndef",
          "preproc_if",
          "preproc_endif",
          "preproc_else",
          "preproc_elif",
          "preproc_undef",
          "preproc_function_def",
          "preproc_call",
          // C++ specific non-executable constructs
          "access_specifier", // public:, private:, protected:
          "field_declaration", // class member declarations
          "type_definition", // typedef
          "alias_declaration", // using alias = type;
          "using_declaration", // using namespace std;
          "namespace_definition", // namespace blocks
          "template_declaration", // template<...> declarations
          "static_assert_declaration", // static_assert(...)
          "friend_declaration", // friend class/function declarations
          "linkage_specification", // extern "C" blocks
          "}", // closing braces
          "{", // opening braces
          ";", // empty statements
          // Additional modern C++ constructs to filter out
          "template_parameter_list",
          "template_argument_list",
          "concept_definition",
          "requires_clause",
          "requires_expression",
          "constraint_logical_and",
          "constraint_logical_or",
          "type_constraint",
          "placeholder_type_specifier",
          "attribute_declaration",
          "ms_declspec_modifier",
          "storage_class_specifier",
          "type_qualifier",
          "function_specifier",
          "virtual_specifier",
          "explicit_function_specifier",
          "class_specifier",
          "struct_specifier",
          "union_specifier",
          "enum_specifier",
          "scoped_enum_specifier",
          "base_class_clause",
          "virtual_function_specifier",
          "pure_virtual_clause",
          "member_initializer_list",
          "member_initializer",
          "field_declaration_list",
          "bitfield_clause",
          "operator_name",
          "destructor_name",
          "qualified_operator_cast_identifier",
          "operator_cast",
          // Additional non-executable elements
          "pragma",
          "asm_statement", // inline assembly - could be executable but complex
          "empty_statement",
          // Template and generic constructs
          "template_instantiation",
          "template_type",
          "auto",
          "decltype",
          // Modern C++ specifiers
          "override",
          "final",
          "noexcept",
          "constexpr",
          "consteval",
          "constinit",
          "inline",
          "thread_local",
          // Filter out type identifiers that are part of declarations
          "type_identifier",
          "primitive_type",
          "qualified_identifier",
          "this",
          "nullptr",
          "true",
          "false",
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

    for (const statement of statements) {
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
}
