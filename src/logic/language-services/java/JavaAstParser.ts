// import Parser from "tree-sitter";
// import Java from "tree-sitter-java";
// import {
//   FlowchartIR,
//   FlowchartNode,
//   FlowchartEdge,
//   LocationMapEntry,
// } from "../../../ir/ir";
// import { AbstractParser } from "../../common/AbstractParser";
// import { ProcessResult, LoopContext } from "../../common/AstParserTypes";

// interface TreeSitterLanguage {
//   name: string;
//   language: unknown;
//   nodeTypeInfo?: unknown;
// }

// type JavaLanguage = TreeSitterLanguage;

// export class JavaAstParser extends AbstractParser {
//   protected log(message: string, ...args: any[]) {
//     if (this.debug) console.log(`[JavaAstParser] ${message}`, ...args);
//   }

//   protected getParser(): Parser {
//     return this.getCachedParser("java", () => {
//       const parser = new Parser();
//       parser.setLanguage(Java as JavaLanguage);
//       return parser;
//     });
//   }

//   public listFunctions(sourceCode: string): string[] {
//     return this.measurePerformance("listFunctions", () => {
//       const parser = this.getParser();
//       const tree = parser.parse(sourceCode);

//       // Find method declarations
//       const methodNames = tree.rootNode
//         .descendantsOfType("method_declaration")
//         .map((method: Parser.SyntaxNode) => {
//           const identifier = method.childForFieldName("name");
//           return identifier?.text || "[anonymous]";
//         });

//       // Find constructor declarations
//       const constructorNames = tree.rootNode
//         .descendantsOfType("constructor_declaration")
//         .map((constructor: Parser.SyntaxNode) => {
//           const identifier = constructor.childForFieldName("name");
//           return `${identifier?.text || "[anonymous]"}()`;
//         });

//       return [...methodNames, ...constructorNames];
//     });
//   }

//   public findFunctionAtPosition(
//     sourceCode: string,
//     position: number
//   ): string | undefined {
//     const parser = this.getParser();
//     const tree = parser.parse(sourceCode);

//     // Check for method declaration
//     const method = tree.rootNode
//       .descendantsOfType("method_declaration")
//       .find((m) => position >= m.startIndex && position <= m.endIndex);
//     if (method) {
//       const identifier = method.childForFieldName("name");
//       return identifier?.text || "[anonymous]";
//     }

//     // Check for constructor declaration
//     const constructor = tree.rootNode
//       .descendantsOfType("constructor_declaration")
//       .find((c) => position >= c.startIndex && position <= c.endIndex);
//     if (constructor) {
//       const identifier = constructor.childForFieldName("name");
//       return `${identifier?.text || "[anonymous]"}()`;
//     }

//     return undefined;
//   }

//   public generateFlowchart(
//     sourceCode: string,
//     functionName?: string,
//     position?: number
//   ): FlowchartIR {
//     return this.measurePerformance("generateFlowchart", () => {
//       this.resetState();
//       const parser = this.getParser();
//       const tree = parser.parse(sourceCode);

//       let targetFunction: Parser.SyntaxNode | undefined;

//       if (position !== undefined) {
//         // Find function at position
//         targetFunction = this.findFunctionNodeAtPosition(
//           tree.rootNode,
//           position
//         );
//       } else if (functionName) {
//         // Find function by name
//         targetFunction = this.findFunctionByName(tree.rootNode, functionName);
//       }

//       if (!targetFunction) {
//         this.log("No function found, analyzing entire code");
//         const result = this.processBlock(tree.rootNode, "END");
//         return {
//           nodes: result.nodes,
//           edges: result.edges,
//           locationMap: this.locationMap,
//         };
//       }

//       this.log(`Processing function: ${functionName || "at position"}`);
//       const body = targetFunction.childForFieldName("body");
//       const result = this.processBlock(body, "END");

//       // Add start and end nodes
//       const startNode: FlowchartNode = {
//         id: "START",
//         label: "START",
//         shape: "stadium",
//         style: this.nodeStyles.terminator,
//       };

//       const endNode: FlowchartNode = {
//         id: "END",
//         label: "END",
//         shape: "stadium",
//         style: this.nodeStyles.terminator,
//       };

//       const nodes = [startNode, ...result.nodes, endNode];
//       const edges = [...result.edges];

//       // Connect start to entry
//       if (result.entryNodeId) {
//         edges.push({ from: "START", to: result.entryNodeId });
//       } else {
//         edges.push({ from: "START", to: "END" });
//       }

//       // Connect exit points to end
//       for (const exitPoint of result.exitPoints) {
//         edges.push({
//           from: exitPoint.id,
//           to: "END",
//           label: exitPoint.label,
//         });
//       }

//       return {
//         nodes,
//         edges,
//         locationMap: this.locationMap,
//       };
//     });
//   }

//   private findFunctionNodeAtPosition(
//     node: Parser.SyntaxNode,
//     position: number
//   ): Parser.SyntaxNode | undefined {
//     // Check for method declaration
//     const method = node
//       .descendantsOfType("method_declaration")
//       .find((m) => position >= m.startIndex && position <= m.endIndex);
//     if (method) return method;

//     // Check for constructor declaration
//     const constructor = node
//       .descendantsOfType("constructor_declaration")
//       .find((c) => position >= c.startIndex && position <= c.endIndex);
//     if (constructor) return constructor;

//     return undefined;
//   }

//   private findFunctionByName(
//     node: Parser.SyntaxNode,
//     functionName: string
//   ): Parser.SyntaxNode | undefined {
//     // Check methods
//     const method = node.descendantsOfType("method_declaration").find((m) => {
//       const identifier = m.childForFieldName("name");
//       return identifier?.text === functionName;
//     });
//     if (method) return method;

//     // Check constructors (remove parentheses from function name if present)
//     const constructorName = functionName.replace(/\(\)$/, "");
//     const constructor = node
//       .descendantsOfType("constructor_declaration")
//       .find((c) => {
//         const identifier = c.childForFieldName("name");
//         return identifier?.text === constructorName;
//       });
//     if (constructor) return constructor;

//     return undefined;
//   }

//   protected processStatement(
//     statement: Parser.SyntaxNode,
//     exitId: string,
//     loopContext?: LoopContext,
//     finallyContext?: { finallyEntryId: string }
//   ): ProcessResult {
//     this.log(`Processing statement: ${statement.type}`);

//     switch (statement.type) {
//       case "if_statement":
//         return this.processIfStatement(
//           statement,
//           exitId,
//           loopContext,
//           finallyContext
//         );
//       case "while_statement":
//         return this.processWhileStatement(
//           statement,
//           exitId,
//           loopContext,
//           finallyContext
//         );
//       case "for_statement":
//       case "enhanced_for_statement":
//         return this.processForStatement(
//           statement,
//           exitId,
//           loopContext,
//           finallyContext
//         );
//       case "do_statement":
//         return this.processDoWhileStatement(
//           statement,
//           exitId,
//           loopContext,
//           finallyContext
//         );
//       case "switch_expression":
//       case "switch_statement":
//         return this.processSwitchStatement(
//           statement,
//           exitId,
//           loopContext,
//           finallyContext
//         );
//       case "try_statement":
//         return this.processTryStatement(
//           statement,
//           exitId,
//           loopContext,
//           finallyContext
//         );
//       case "break_statement":
//         return this.processBreakStatement(statement, loopContext);
//       case "continue_statement":
//         return this.processContinueStatement(statement, loopContext);
//       case "return_statement":
//         return this.processReturnStatement(statement, exitId);
//       case "throw_statement":
//         return this.processThrowStatement(statement, exitId);
//       case "block":
//         return this.processBlock(
//           statement,
//           exitId,
//           loopContext,
//           finallyContext
//         );
//       case "expression_statement":
//       case "local_variable_declaration":
//       case "assignment_expression":
//       default:
//         return this.processDefaultStatement(statement);
//     }
//   }

//   private processIfStatement(
//     statement: Parser.SyntaxNode,
//     exitId: string,
//     loopContext?: LoopContext,
//     finallyContext?: { finallyEntryId: string }
//   ): ProcessResult {
//     const conditionNode = statement.childForFieldName("condition");
//     const conditionText = conditionNode?.text || "condition";

//     const decisionNodeId = this.generateNodeId("if");
//     const decisionNode: FlowchartNode = {
//       id: decisionNodeId,
//       label: `if (${this.escapeString(conditionText)})`,
//       shape: "diamond",
//       style: this.nodeStyles.decision,
//     };

//     this.locationMap.push({
//       start: statement.startIndex,
//       end: statement.endIndex,
//       nodeId: decisionNodeId,
//     });

//     const nodes: FlowchartNode[] = [decisionNode];
//     const edges: FlowchartEdge[] = [];

//     // Process then branch
//     const thenStatement = statement.childForFieldName("consequence");
//     const thenResult = thenStatement
//       ? this.processStatement(
//           thenStatement,
//           exitId,
//           loopContext,
//           finallyContext
//         )
//       : this.createProcessResult();

//     nodes.push(...thenResult.nodes);
//     edges.push(...thenResult.edges);

//     // Connect decision to then branch
//     if (thenResult.entryNodeId) {
//       edges.push({
//         from: decisionNodeId,
//         to: thenResult.entryNodeId,
//         label: "true",
//       });
//     }

//     let exitPoints: { id: string; label?: string }[] = [
//       ...thenResult.exitPoints,
//     ];

//     // Process else branch
//     const elseStatement = statement.childForFieldName("alternative");
//     if (elseStatement) {
//       const elseResult = this.processStatement(
//         elseStatement,
//         exitId,
//         loopContext,
//         finallyContext
//       );
//       nodes.push(...elseResult.nodes);
//       edges.push(...elseResult.edges);

//       if (elseResult.entryNodeId) {
//         edges.push({
//           from: decisionNodeId,
//           to: elseResult.entryNodeId,
//           label: "false",
//         });
//       }

//       exitPoints.push(...elseResult.exitPoints);
//     } else {
//       // No else branch - decision node connects directly to exit
//       exitPoints.push({ id: decisionNodeId, label: "false" });
//     }

//     return this.createProcessResult(
//       nodes,
//       edges,
//       decisionNodeId,
//       exitPoints,
//       new Set([...thenResult.nodesConnectedToExit])
//     );
//   }

//   private processWhileStatement(
//     statement: Parser.SyntaxNode,
//     exitId: string,
//     loopContext?: LoopContext,
//     finallyContext?: { finallyEntryId: string }
//   ): ProcessResult {
//     const conditionNode = statement.childForFieldName("condition");
//     const conditionText = conditionNode?.text || "condition";

//     const loopNodeId = this.generateNodeId("while");
//     const loopNode: FlowchartNode = {
//       id: loopNodeId,
//       label: `while (${this.escapeString(conditionText)})`,
//       shape: "diamond",
//       style: this.nodeStyles.decision,
//     };

//     this.locationMap.push({
//       start: statement.startIndex,
//       end: statement.endIndex,
//       nodeId: loopNodeId,
//     });

//     const newLoopContext: LoopContext = {
//       continueTargetId: loopNodeId,
//       breakTargetId: exitId,
//     };

//     const bodyStatement = statement.childForFieldName("body");
//     const bodyResult = bodyStatement
//       ? this.processStatement(
//           bodyStatement,
//           loopNodeId,
//           newLoopContext,
//           finallyContext
//         )
//       : this.createProcessResult();

//     const nodes = [loopNode, ...bodyResult.nodes];
//     const edges = [...bodyResult.edges];

//     // Connect loop condition to body
//     if (bodyResult.entryNodeId) {
//       edges.push({
//         from: loopNodeId,
//         to: bodyResult.entryNodeId,
//         label: "true",
//       });
//     }

//     // Connect body exit points back to loop condition
//     for (const exitPoint of bodyResult.exitPoints) {
//       edges.push({
//         from: exitPoint.id,
//         to: loopNodeId,
//         label: exitPoint.label,
//       });
//     }

//     // Loop exits when condition is false
//     return this.createProcessResult(
//       nodes,
//       edges,
//       loopNodeId,
//       [{ id: loopNodeId, label: "false" }],
//       bodyResult.nodesConnectedToExit
//     );
//   }

//   private processForStatement(
//     statement: Parser.SyntaxNode,
//     exitId: string,
//     loopContext?: LoopContext,
//     finallyContext?: { finallyEntryId: string }
//   ): ProcessResult {
//     let loopText = "for";

//     if (statement.type === "enhanced_for_statement") {
//       // Enhanced for loop (for-each)
//       const variable = statement.childForFieldName("name");
//       const iterable = statement.childForFieldName("value");
//       loopText = `for (${variable?.text || "item"} : ${
//         iterable?.text || "collection"
//       })`;
//     } else {
//       // Traditional for loop
//       const init = statement.childForFieldName("init");
//       const condition = statement.childForFieldName("condition");
//       const update = statement.childForFieldName("update");

//       loopText = `for (${init?.text || ""}; ${condition?.text || ""}; ${
//         update?.text || ""
//       })`;
//     }

//     const loopNodeId = this.generateNodeId("for");
//     const loopNode: FlowchartNode = {
//       id: loopNodeId,
//       label: this.escapeString(loopText),
//       shape: "diamond",
//       style: this.nodeStyles.decision,
//     };

//     this.locationMap.push({
//       start: statement.startIndex,
//       end: statement.endIndex,
//       nodeId: loopNodeId,
//     });

//     const newLoopContext: LoopContext = {
//       continueTargetId: loopNodeId,
//       breakTargetId: exitId,
//     };

//     const bodyStatement = statement.childForFieldName("body");
//     const bodyResult = bodyStatement
//       ? this.processStatement(
//           bodyStatement,
//           loopNodeId,
//           newLoopContext,
//           finallyContext
//         )
//       : this.createProcessResult();

//     const nodes = [loopNode, ...bodyResult.nodes];
//     const edges = [...bodyResult.edges];

//     // Connect loop to body
//     if (bodyResult.entryNodeId) {
//       edges.push({
//         from: loopNodeId,
//         to: bodyResult.entryNodeId,
//         label: "true",
//       });
//     }

//     // Connect body back to loop
//     for (const exitPoint of bodyResult.exitPoints) {
//       edges.push({
//         from: exitPoint.id,
//         to: loopNodeId,
//         label: exitPoint.label,
//       });
//     }

//     return this.createProcessResult(
//       nodes,
//       edges,
//       loopNodeId,
//       [{ id: loopNodeId, label: "false" }],
//       bodyResult.nodesConnectedToExit
//     );
//   }

//   private processDoWhileStatement(
//     statement: Parser.SyntaxNode,
//     exitId: string,
//     loopContext?: LoopContext,
//     finallyContext?: { finallyEntryId: string }
//   ): ProcessResult {
//     const conditionNode = statement.childForFieldName("condition");
//     const conditionText = conditionNode?.text || "condition";

//     const loopNodeId = this.generateNodeId("dowhile");
//     const loopNode: FlowchartNode = {
//       id: loopNodeId,
//       label: `while (${this.escapeString(conditionText)})`,
//       shape: "diamond",
//       style: this.nodeStyles.decision,
//     };

//     const newLoopContext: LoopContext = {
//       continueTargetId: loopNodeId,
//       breakTargetId: exitId,
//     };

//     const bodyStatement = statement.childForFieldName("body");
//     const bodyResult = bodyStatement
//       ? this.processStatement(
//           bodyStatement,
//           loopNodeId,
//           newLoopContext,
//           finallyContext
//         )
//       : this.createProcessResult();

//     const nodes = [...bodyResult.nodes, loopNode];
//     const edges = [...bodyResult.edges];

//     this.locationMap.push({
//       start: statement.startIndex,
//       end: statement.endIndex,
//       nodeId: loopNodeId,
//     });

//     // Connect body to condition check
//     for (const exitPoint of bodyResult.exitPoints) {
//       edges.push({
//         from: exitPoint.id,
//         to: loopNodeId,
//         label: exitPoint.label,
//       });
//     }

//     // Loop back to body if condition is true
//     if (bodyResult.entryNodeId) {
//       edges.push({
//         from: loopNodeId,
//         to: bodyResult.entryNodeId,
//         label: "true",
//       });
//     }

//     return this.createProcessResult(
//       nodes,
//       edges,
//       bodyResult.entryNodeId,
//       [{ id: loopNodeId, label: "false" }],
//       bodyResult.nodesConnectedToExit
//     );
//   }

//   private processSwitchStatement(
//     statement: Parser.SyntaxNode,
//     exitId: string,
//     loopContext?: LoopContext,
//     finallyContext?: { finallyEntryId: string }
//   ): ProcessResult {
//     const expressionNode =
//       statement.childForFieldName("condition") ||
//       statement.childForFieldName("value");
//     const expressionText = expressionNode?.text || "expression";

//     const switchNodeId = this.generateNodeId("switch");
//     const switchNode: FlowchartNode = {
//       id: switchNodeId,
//       label: `switch (${this.escapeString(expressionText)})`,
//       shape: "diamond",
//       style: this.nodeStyles.decision,
//     };

//     this.locationMap.push({
//       start: statement.startIndex,
//       end: statement.endIndex,
//       nodeId: switchNodeId,
//     });

//     const nodes: FlowchartNode[] = [switchNode];
//     const edges: FlowchartEdge[] = [];
//     const exitPoints: { id: string; label?: string }[] = [];

//     // Process switch body
//     const body = statement.childForFieldName("body");
//     if (body) {
//       const cases = body.namedChildren.filter(
//         (child) =>
//           child.type === "switch_label" ||
//           child.type === "switch_block_statement_group"
//       );

//       for (const caseNode of cases) {
//         if (caseNode.type === "switch_label") {
//           const label = caseNode.namedChildren[0];
//           const caseText =
//             label?.type === "default"
//               ? "default"
//               : `case ${label?.text || "value"}`;

//           const caseResult = this.createProcessResult();

//           // Connect switch to case
//           edges.push({
//             from: switchNodeId,
//             to: exitId, // Cases typically fall through or break to exit
//             label: caseText,
//           });
//         } else if (caseNode.type === "switch_block_statement_group") {
//           // Process statements in the case group
//           const caseResult = this.processBlock(
//             caseNode,
//             exitId,
//             loopContext,
//             finallyContext
//           );
//           nodes.push(...caseResult.nodes);
//           edges.push(...caseResult.edges);

//           if (caseResult.entryNodeId) {
//             // This would need proper case label handling
//             exitPoints.push(...caseResult.exitPoints);
//           }
//         }
//       }
//     }

//     // If no cases processed anything, switch goes directly to exit
//     if (exitPoints.length === 0) {
//       exitPoints.push({ id: switchNodeId });
//     }

//     return this.createProcessResult(
//       nodes,
//       edges,
//       switchNodeId,
//       exitPoints,
//       new Set()
//     );
//   }

//   private processTryStatement(
//     statement: Parser.SyntaxNode,
//     exitId: string,
//     loopContext?: LoopContext,
//     finallyContext?: { finallyEntryId: string }
//   ): ProcessResult {
//     const entryId = this.generateNodeId("try_entry");
//     const entryNode: FlowchartNode = {
//       id: entryId,
//       label: "try",
//       shape: "stadium",
//       style: this.nodeStyles.special,
//     };

//     this.locationMap.push({
//       start: statement.startIndex,
//       end: statement.endIndex,
//       nodeId: entryId,
//     });

//     const nodes: FlowchartNode[] = [entryNode];
//     const edges: FlowchartEdge[] = [];
//     const nodesConnectedToExit = new Set<string>();
//     let allExitPoints: { id: string; label?: string }[] = [];

//     // Process finally block first to establish context
//     let newFinallyContext: { finallyEntryId: string } | undefined;
//     let finallyResult: ProcessResult | null = null;

//     const finallyClause = statement.namedChildren.find(
//       (child) => child.type === "finally_clause"
//     );

//     if (finallyClause) {
//       // Create a dedicated finally entry node to show the "finally" keyword
//       const finallyEntryId = this.generateNodeId("finally_entry");
//       const finallyEntryNode: FlowchartNode = {
//         id: finallyEntryId,
//         label: "finally",
//         shape: "stadium",
//         style: this.nodeStyles.special,
//       };

//       // Add location mapping for the finally keyword specifically
//       const finallyKeyword = finallyClause.children.find(
//         (child) => child.type === "finally"
//       );
//       if (finallyKeyword) {
//         this.locationMap.push({
//           start: finallyKeyword.startIndex,
//           end: finallyKeyword.endIndex,
//           nodeId: finallyEntryId,
//         });
//       }

//       const finallyBody = finallyClause.childForFieldName("body");
//       if (finallyBody) {
//         const finallyBodyResult = this.processBlock(
//           finallyBody,
//           exitId,
//           loopContext,
//           finallyContext
//         );

//         // Combine finally entry node with finally body processing
//         finallyResult = this.createProcessResult(
//           [finallyEntryNode, ...finallyBodyResult.nodes],
//           finallyBodyResult.edges,
//           finallyEntryId,
//           finallyBodyResult.exitPoints,
//           finallyBodyResult.nodesConnectedToExit
//         );

//         // Connect finally entry to finally body
//         if (finallyBodyResult.entryNodeId) {
//           finallyResult.edges.push({
//             from: finallyEntryId,
//             to: finallyBodyResult.entryNodeId,
//           });
//         }

//         nodes.push(...finallyResult.nodes);
//         edges.push(...finallyResult.edges);
//         finallyResult.nodesConnectedToExit.forEach((n) =>
//           nodesConnectedToExit.add(n)
//         );
//         newFinallyContext = { finallyEntryId: finallyEntryId };
//       }
//     }

//     // Process try block
//     const tryBodyNode = statement.childForFieldName("body");
//     const tryResult = tryBodyNode
//       ? this.processBlock(
//           tryBodyNode,
//           exitId,
//           loopContext,
//           newFinallyContext || finallyContext
//         )
//       : this.createProcessResult();

//     nodes.push(...tryResult.nodes);
//     edges.push(...tryResult.edges);
//     tryResult.nodesConnectedToExit.forEach((n) => nodesConnectedToExit.add(n));

//     // Connect entry to try block
//     if (tryResult.entryNodeId) {
//       edges.push({ from: entryId, to: tryResult.entryNodeId });
//     } else if (finallyResult?.entryNodeId) {
//       edges.push({ from: entryId, to: finallyResult.entryNodeId });
//     } else {
//       allExitPoints.push({ id: entryId });
//     }

//     // Route try block exits through finally if it exists
//     tryResult.exitPoints.forEach((ep) => {
//       if (finallyResult?.entryNodeId) {
//         edges.push({
//           from: ep.id,
//           to: finallyResult.entryNodeId,
//           label: ep.label,
//         });
//       } else {
//         allExitPoints.push(ep);
//       }
//     });

//     // Process catch clauses
//     const catchClauses = statement.namedChildren.filter(
//       (child) => child.type === "catch_clause"
//     );

//     for (const catchClause of catchClauses) {
//       const catchBody = catchClause.childForFieldName("body");
//       const parameter = catchClause.childForFieldName("parameter");

//       // Extract exception type from parameter
//       let exceptionType = "Exception";
//       let variableName = "e";
//       if (parameter) {
//         const typeNode = parameter.childForFieldName("type");
//         const nameNode = parameter.childForFieldName("name");
//         if (typeNode) {
//           exceptionType = typeNode.text;
//         }
//         if (nameNode) {
//           variableName = nameNode.text;
//         }
//       }

//       // Create a dedicated catch entry node
//       const catchEntryId = this.generateNodeId("catch_entry");
//       const catchEntryNode: FlowchartNode = {
//         id: catchEntryId,
//         label: `catch (${exceptionType} ${variableName})`,
//         shape: "stadium",
//         style: this.nodeStyles.special,
//       };

//       // Add location mapping for the catch clause
//       const catchKeyword = catchClause.children.find(
//         (child) => child.type === "catch"
//       );
//       if (catchKeyword) {
//         this.locationMap.push({
//           start: catchKeyword.startIndex,
//           end: parameter ? parameter.endIndex : catchKeyword.endIndex,
//           nodeId: catchEntryId,
//         });
//       }

//       if (catchBody) {
//         const catchBodyResult = this.processBlock(
//           catchBody,
//           exitId,
//           loopContext,
//           newFinallyContext || finallyContext
//         );

//         // Combine catch entry with catch body
//         nodes.push(catchEntryNode, ...catchBodyResult.nodes);
//         edges.push(...catchBodyResult.edges);
//         catchBodyResult.nodesConnectedToExit.forEach((n) =>
//           nodesConnectedToExit.add(n)
//         );

//         // Connect entry to catch entry node (represents exception path)
//         edges.push({
//           from: entryId,
//           to: catchEntryId,
//           label: `on ${exceptionType}`,
//         });

//         // Connect catch entry to catch body
//         if (catchBodyResult.entryNodeId) {
//           edges.push({
//             from: catchEntryId,
//             to: catchBodyResult.entryNodeId,
//           });
//         }

//         // Route catch block exits through finally if it exists
//         catchBodyResult.exitPoints.forEach((ep) => {
//           if (finallyResult?.entryNodeId) {
//             edges.push({
//               from: ep.id,
//               to: finallyResult.entryNodeId,
//               label: ep.label,
//             });
//           } else {
//             allExitPoints.push(ep);
//           }
//         });
//       }
//     }

//     // Add finally exits to overall exit points
//     if (finallyResult) {
//       allExitPoints.push(...finallyResult.exitPoints);
//     }

//     return this.createProcessResult(
//       nodes,
//       edges,
//       entryId,
//       allExitPoints,
//       nodesConnectedToExit
//     );
//   }

//   private processBreakStatement(
//     statement: Parser.SyntaxNode,
//     loopContext?: LoopContext
//   ): ProcessResult {
//     const nodeId = this.generateNodeId("break");
//     const node: FlowchartNode = {
//       id: nodeId,
//       label: "break",
//       shape: "rect",
//       style: this.nodeStyles.break,
//     };

//     this.locationMap.push({
//       start: statement.startIndex,
//       end: statement.endIndex,
//       nodeId,
//     });

//     const edges: FlowchartEdge[] = [];
//     if (loopContext) {
//       edges.push({ from: nodeId, to: loopContext.breakTargetId });
//     }

//     return this.createProcessResult(
//       [node],
//       edges,
//       nodeId,
//       [], // Break doesn't have normal exit points
//       new Set([nodeId])
//     );
//   }

//   private processContinueStatement(
//     statement: Parser.SyntaxNode,
//     loopContext?: LoopContext
//   ): ProcessResult {
//     const nodeId = this.generateNodeId("continue");
//     const node: FlowchartNode = {
//       id: nodeId,
//       label: "continue",
//       shape: "rect",
//       style: this.nodeStyles.break,
//     };

//     this.locationMap.push({
//       start: statement.startIndex,
//       end: statement.endIndex,
//       nodeId,
//     });

//     const edges: FlowchartEdge[] = [];
//     if (loopContext) {
//       edges.push({ from: nodeId, to: loopContext.continueTargetId });
//     }

//     return this.createProcessResult(
//       [node],
//       edges,
//       nodeId,
//       [], // Continue doesn't have normal exit points
//       new Set([nodeId])
//     );
//   }

//   private processReturnStatement(
//     statement: Parser.SyntaxNode,
//     exitId: string
//   ): ProcessResult {
//     const valueNode = statement.namedChildren[0];
//     const returnText = valueNode ? `return ${valueNode.text}` : "return";

//     const nodeId = this.generateNodeId("return");
//     const node: FlowchartNode = {
//       id: nodeId,
//       label: this.escapeString(returnText),
//       shape: "rect",
//       style: this.nodeStyles.special,
//     };

//     this.locationMap.push({
//       start: statement.startIndex,
//       end: statement.endIndex,
//       nodeId,
//     });

//     return this.createProcessResult(
//       [node],
//       [{ from: nodeId, to: exitId }],
//       nodeId,
//       [], // Return goes directly to exit
//       new Set([nodeId])
//     );
//   }

//   private processThrowStatement(
//     statement: Parser.SyntaxNode,
//     exitId: string
//   ): ProcessResult {
//     const exceptionNode = statement.namedChildren[0];
//     const throwText = exceptionNode ? `throw ${exceptionNode.text}` : "throw";

//     const nodeId = this.generateNodeId("throw");
//     const node: FlowchartNode = {
//       id: nodeId,
//       label: this.escapeString(throwText),
//       shape: "rect",
//       style: this.nodeStyles.special,
//     };

//     this.locationMap.push({
//       start: statement.startIndex,
//       end: statement.endIndex,
//       nodeId,
//     });

//     return this.createProcessResult(
//       [node],
//       [{ from: nodeId, to: exitId }],
//       nodeId,
//       [], // Throw goes directly to exit (or catch handler)
//       new Set([nodeId])
//     );
//   }

//   protected processBlock(
//     blockNode: Parser.SyntaxNode | null,
//     exitId: string,
//     loopContext?: LoopContext,
//     finallyContext?: { finallyEntryId: string }
//   ): ProcessResult {
//     if (!blockNode) {
//       return this.createProcessResult();
//     }

//     // Filter out comments and empty statements for Java
//     const statements = blockNode.namedChildren.filter(
//       (s) =>
//         !["line_comment", "block_comment", "empty_statement"].includes(s.type)
//     );

//     if (statements.length === 0) {
//       return this.createProcessResult();
//     }

//     const nodes: FlowchartNode[] = [];
//     const edges: FlowchartEdge[] = [];
//     const nodesConnectedToExit = new Set<string>();
//     let entryNodeId: string | undefined;
//     let lastExitPoints: { id: string; label?: string }[] = [];

//     for (const statement of statements) {
//       const result = this.processStatement(
//         statement,
//         exitId,
//         loopContext,
//         finallyContext
//       );

//       nodes.push(...result.nodes);
//       edges.push(...result.edges);
//       result.nodesConnectedToExit.forEach((n) => nodesConnectedToExit.add(n));

//       if (!entryNodeId) entryNodeId = result.entryNodeId;
//       if (lastExitPoints.length > 0 && result.entryNodeId) {
//         for (const exitPoint of lastExitPoints) {
//           edges.push({
//             from: exitPoint.id,
//             to: result.entryNodeId,
//             label: exitPoint.label,
//           });
//         }
//       }
//       lastExitPoints = result.exitPoints;
//     }

//     return this.createProcessResult(
//       nodes,
//       edges,
//       entryNodeId,
//       lastExitPoints,
//       nodesConnectedToExit
//     );
//   }
// }
