"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TsAstParser = void 0;
const ts_morph_1 = require("ts-morph");
/**
 * The core class responsible for analyzing the AST and generating the flowchart.
 */
class TsAstParser {
    nodeIdCounter = 0;
    locationMap = [];
    nodeStyles = {
        terminator: 'fill:#eee,stroke:#000,stroke-width:4px,color:#000;',
        decision: 'fill:#eee,stroke:#000,stroke-width:4px,color:#000;',
        process: 'fill:#eee,stroke:#000,stroke-width:1px,color:#000;',
        special: 'fill:#eee,stroke:#000,stroke-width:4px,color:#000',
        break: 'fill:#eee,stroke:#000,stroke-width:2px,color:#000',
    };
    generateNodeId(prefix) {
        return `${prefix}_${this.nodeIdCounter++}`;
    }
    escapeString(str) {
        if (!str) {
            return "";
        }
        const sanitized = str.replace(/"/g, "#quot;").replace(/\n/g, " ").trim();
        return sanitized.length > 60
            ? sanitized.substring(0, 57) + "..."
            : sanitized;
    }
    /**
     * Main public method to generate a flowchart from a ts-morph SourceFile object.
     * It finds the first function/method in the file and analyzes its body.
     */
    generateFlowchart(sourceFile, position) {
        this.nodeIdCounter = 0;
        this.locationMap = [];
        const descendant = sourceFile.getDescendantAtPos(position);
        if (!descendant) {
            return {
                nodes: [{ id: 'A', label: 'No code found at cursor position.', shape: 'rect' }],
                edges: [],
                locationMap: [],
            };
        }
        const isFunctionLike = (node) => ts_morph_1.Node.isFunctionDeclaration(node) ||
            ts_morph_1.Node.isMethodDeclaration(node) ||
            ts_morph_1.Node.isArrowFunction(node) ||
            ts_morph_1.Node.isFunctionExpression(node);
        let functionToAnalyze = isFunctionLike(descendant)
            ? descendant
            : descendant.getAncestors().find(isFunctionLike);
        if (!functionToAnalyze) {
            return {
                nodes: [{ id: 'A', label: 'Place cursor inside a function or method to generate a flowchart.', shape: 'rect' }],
                edges: [],
                locationMap: [],
            };
        }
        let functionName;
        if (ts_morph_1.Node.isFunctionDeclaration(functionToAnalyze) ||
            ts_morph_1.Node.isMethodDeclaration(functionToAnalyze) ||
            ts_morph_1.Node.isFunctionExpression(functionToAnalyze)) {
            functionName = functionToAnalyze.getName();
        }
        else if (ts_morph_1.Node.isArrowFunction(functionToAnalyze)) {
            const parent = functionToAnalyze.getParent();
            if (ts_morph_1.Node.isVariableDeclaration(parent)) {
                functionName = parent.getName();
            }
        }
        const finalFunctionName = functionName || "[anonymous]";
        const nodes = [];
        const edges = [];
        const entryId = this.generateNodeId("start");
        const exitId = this.generateNodeId("end");
        nodes.push({ id: entryId, label: `start: ${finalFunctionName}`, shape: 'round', style: this.nodeStyles.terminator });
        nodes.push({ id: exitId, label: 'end', shape: 'round', style: this.nodeStyles.terminator });
        const body = functionToAnalyze.getBody();
        if (body && ts_morph_1.Node.isBlock(body)) {
            const bodyResult = this.processBlock(body, exitId);
            nodes.push(...bodyResult.nodes);
            edges.push(...bodyResult.edges);
            if (bodyResult.entryNodeId) {
                edges.push({ from: entryId, to: bodyResult.entryNodeId });
            }
            else {
                edges.push({ from: entryId, to: exitId });
            }
            bodyResult.exitPoints.forEach((exitPoint) => {
                if (!bodyResult.nodesConnectedToExit.has(exitPoint.id)) {
                    edges.push({ from: exitPoint.id, to: exitId, label: exitPoint.label });
                }
            });
        }
        else {
            edges.push({ from: entryId, to: exitId });
        }
        return {
            nodes,
            edges,
            locationMap: this.locationMap,
            functionRange: {
                start: functionToAnalyze.getStart(),
                end: functionToAnalyze.getEnd(),
            },
            title: `Flowchart for ${finalFunctionName}`,
            entryNodeId: entryId,
            exitNodeId: exitId,
        };
    }
    /**
     * Processes a block of statements (e.g., the body of a function or a loop),
     * chaining the control flow from one statement to the next.
     */
    processBlock(blockNode, exitId, loopContext) {
        const nodes = [];
        const edges = [];
        let entryNodeId = "";
        const nodesConnectedToExit = new Set();
        let lastExitPoints = [];
        const statements = blockNode.getStatements();
        if (statements.length === 0) {
            return {
                nodes: [],
                edges: [],
                entryNodeId: "",
                exitPoints: [],
                nodesConnectedToExit,
            };
        }
        for (const statement of statements) {
            const result = this.processStatement(statement, exitId, loopContext);
            nodes.push(...result.nodes);
            edges.push(...result.edges);
            if (lastExitPoints.length > 0) {
                // Connect the exits of the previous statement to the entry of the current one.
                lastExitPoints.forEach((exitPoint) => {
                    if (result.entryNodeId) {
                        edges.push({ from: exitPoint.id, to: result.entryNodeId, label: exitPoint.label });
                    }
                });
            }
            else {
                // This is the first statement in the block, so it's the entry point.
                entryNodeId = result.entryNodeId || "";
            }
            lastExitPoints = result.exitPoints;
            result.nodesConnectedToExit.forEach((n) => nodesConnectedToExit.add(n));
        }
        return {
            nodes,
            edges,
            entryNodeId,
            exitPoints: lastExitPoints,
            nodesConnectedToExit,
        };
    }
    /**
     * Delegates a statement to the appropriate processing function based on its AST node type.
     */
    processStatement(statement, exitId, loopContext) {
        if (ts_morph_1.Node.isIfStatement(statement)) {
            return this.processIfStatement(statement, exitId, loopContext);
        }
        if (ts_morph_1.Node.isForOfStatement(statement)) {
            return this.processForOfStatement(statement, exitId);
        }
        if (ts_morph_1.Node.isForInStatement(statement)) {
            return this.processForInStatement(statement, exitId);
        }
        if (ts_morph_1.Node.isForStatement(statement)) {
            return this.processForStatement(statement, exitId);
        }
        if (ts_morph_1.Node.isWhileStatement(statement)) {
            return this.processWhileStatement(statement, exitId);
        }
        if (ts_morph_1.Node.isDoStatement(statement)) {
            return this.processDoWhileStatement(statement, exitId);
        }
        if (ts_morph_1.Node.isTryStatement(statement)) {
            return this.processTryStatement(statement, exitId, loopContext);
        }
        if (ts_morph_1.Node.isSwitchStatement(statement)) {
            return this.processSwitchStatement(statement, exitId, loopContext);
        }
        // Handle ternary operators in variable declarations or as expression statements.
        if (ts_morph_1.Node.isVariableStatement(statement)) {
            const declarations = statement.getDeclarationList().getDeclarations();
            for (const declaration of declarations) {
                const initializer = declaration.getInitializer();
                if (initializer && ts_morph_1.Node.isAwaitExpression(initializer)) {
                    return this.processAwaitExpression(statement);
                }
            }
            if (declarations.length === 1) {
                const declaration = declarations[0];
                const initializer = declaration.getInitializer();
                if (initializer && ts_morph_1.Node.isConditionalExpression(initializer)) {
                    const condExpr = initializer;
                    const name = declaration.getName();
                    const thenText = `${name} = ${condExpr.getWhenTrue().getText()}`;
                    const elseText = `${name} = ${condExpr.getWhenFalse().getText()}`;
                    return this.createTernaryGraph(condExpr, thenText, elseText);
                }
            }
        }
        if (ts_morph_1.Node.isExpressionStatement(statement)) {
            const expr = statement.getExpression();
            if (ts_morph_1.Node.isAwaitExpression(expr)) {
                return this.processAwaitExpression(statement);
            }
            if (ts_morph_1.Node.isConditionalExpression(expr)) {
                const thenText = expr.getWhenTrue().getText();
                const elseText = expr.getWhenFalse().getText();
                return this.createTernaryGraph(expr, thenText, elseText);
            }
            if (ts_morph_1.Node.isCallExpression(expr)) {
                return this.processCallExpression(expr, exitId);
            }
        }
        if (ts_morph_1.Node.isReturnStatement(statement)) {
            return this.processReturnStatement(statement, exitId);
        }
        if (ts_morph_1.Node.isBreakStatement(statement) && loopContext) {
            return this.processBreakStatement(statement, loopContext);
        }
        if (ts_morph_1.Node.isContinueStatement(statement) && loopContext) {
            return this.processContinueStatement(statement, loopContext);
        }
        if (ts_morph_1.Node.isBlock(statement)) {
            return this.processBlock(statement, exitId, loopContext);
        }
        return this.processDefaultStatement(statement);
    }
    processAwaitExpression(statement) {
        const nodeId = this.generateNodeId("await_stmt");
        const nodeText = this.escapeString(statement.getText());
        const nodes = [{ id: nodeId, label: nodeText, shape: 'stadium', style: this.nodeStyles.special }];
        const start = statement.getStart();
        const end = statement.getEnd();
        this.locationMap.push({ start, end, nodeId });
        return {
            nodes,
            edges: [],
            entryNodeId: nodeId,
            exitPoints: [{ id: nodeId }],
            nodesConnectedToExit: new Set(),
        };
    }
    processReturnStatement(returnStmt, exitId) {
        const nodeId = this.generateNodeId("return_stmt");
        const nodeText = this.escapeString(returnStmt.getText());
        const nodes = [{ id: nodeId, label: nodeText, shape: 'stadium', style: this.nodeStyles.special }];
        const edges = [{ from: nodeId, to: exitId }];
        const start = returnStmt.getStart();
        const end = returnStmt.getEnd();
        this.locationMap.push({ start, end, nodeId });
        return {
            nodes,
            edges,
            entryNodeId: nodeId,
            exitPoints: [],
            nodesConnectedToExit: new Set().add(nodeId),
        };
    }
    processBreakStatement(breakStmt, loopContext) {
        const nodeId = this.generateNodeId("break_stmt");
        const nodes = [{ id: nodeId, label: 'break', shape: 'stadium', style: this.nodeStyles.break }];
        const edges = [{ from: nodeId, to: loopContext.breakTargetId }];
        const start = breakStmt.getStart();
        const end = breakStmt.getEnd();
        this.locationMap.push({ start, end, nodeId });
        return {
            nodes,
            edges,
            entryNodeId: nodeId,
            exitPoints: [],
            nodesConnectedToExit: new Set().add(nodeId),
        };
    }
    processContinueStatement(continueStmt, loopContext) {
        const nodeId = this.generateNodeId("continue_stmt");
        const nodes = [{ id: nodeId, label: 'continue', shape: 'stadium', style: this.nodeStyles.break }];
        const edges = [{ from: nodeId, to: loopContext.continueTargetId }];
        const start = continueStmt.getStart();
        const end = continueStmt.getEnd();
        this.locationMap.push({ start, end, nodeId });
        return {
            nodes,
            edges,
            entryNodeId: nodeId,
            exitPoints: [],
            nodesConnectedToExit: new Set().add(nodeId),
        };
    }
    processDefaultStatement(statement) {
        const nodeId = this.generateNodeId("stmt");
        const nodeText = this.escapeString(statement.getText());
        const nodes = [{ id: nodeId, label: nodeText, shape: 'rect' }];
        const start = statement.getStart();
        const end = statement.getEnd();
        this.locationMap.push({ start, end, nodeId });
        return {
            nodes,
            edges: [],
            entryNodeId: nodeId,
            exitPoints: [{ id: nodeId }],
            nodesConnectedToExit: new Set(),
        };
    }
    processSwitchStatement(switchStmt, exitId, loopContext) {
        const nodes = [];
        const edges = [];
        const nodesConnectedToExit = new Set();
        const switchExitPoints = [];
        const exprText = this.escapeString(switchStmt.getExpression().getText());
        const switchEntryId = this.generateNodeId("switch");
        nodes.push({ id: switchEntryId, label: `switch (${exprText})`, shape: 'diamond', style: this.nodeStyles.decision });
        let lastCaseExitPoints = null;
        const caseClauses = switchStmt.getCaseBlock().getClauses();
        const defaultClause = caseClauses.find(ts_morph_1.Node.isDefaultClause);
        for (const caseClause of caseClauses) {
            if (ts_morph_1.Node.isDefaultClause(caseClause)) {
                continue;
            }
            if (ts_morph_1.Node.isCaseClause(caseClause)) {
                const caseExprText = this.escapeString(caseClause.getExpression()?.getText() || "");
                const caseEntryId = this.generateNodeId("case");
                nodes.push({ id: caseEntryId, label: `case ${caseExprText}`, shape: 'rect' });
                if (lastCaseExitPoints) {
                    lastCaseExitPoints.forEach((ep) => {
                        edges.push({ from: ep.id, to: caseEntryId });
                    });
                }
                else {
                    edges.push({ from: switchEntryId, to: caseEntryId });
                }
                const statements = caseClause.getStatements();
                if (statements.length > 0) {
                    const block = caseClause.getChildSyntaxListOrThrow();
                    const blockResult = this.processBlock(block, exitId, loopContext);
                    nodes.push(...blockResult.nodes);
                    edges.push(...blockResult.edges);
                    blockResult.nodesConnectedToExit.forEach((n) => nodesConnectedToExit.add(n));
                    if (blockResult.entryNodeId) {
                        edges.push({ from: caseEntryId, to: blockResult.entryNodeId });
                    }
                    lastCaseExitPoints = blockResult.exitPoints;
                }
                else {
                    lastCaseExitPoints = [{ id: caseEntryId }];
                }
            }
        }
        if (defaultClause) {
            const defaultEntryId = this.generateNodeId("default");
            nodes.push({ id: defaultEntryId, label: 'default', shape: 'rect' });
            if (lastCaseExitPoints) {
                lastCaseExitPoints.forEach((ep) => {
                    edges.push({ from: ep.id, to: defaultEntryId });
                });
            }
            edges.push({ from: switchEntryId, to: defaultEntryId, label: 'default' });
            const statements = defaultClause.getStatements();
            if (statements.length > 0) {
                const block = defaultClause.getChildSyntaxListOrThrow();
                const blockResult = this.processBlock(block, exitId, loopContext);
                nodes.push(...blockResult.nodes);
                edges.push(...blockResult.edges);
                blockResult.nodesConnectedToExit.forEach((n) => nodesConnectedToExit.add(n));
                if (blockResult.entryNodeId) {
                    edges.push({ from: defaultEntryId, to: blockResult.entryNodeId });
                }
                switchExitPoints.push(...blockResult.exitPoints);
            }
            else {
                switchExitPoints.push({ id: defaultEntryId });
            }
        }
        if (!defaultClause) {
            if (lastCaseExitPoints) {
                switchExitPoints.push(...lastCaseExitPoints);
            }
            switchExitPoints.push({ id: switchEntryId, label: " " });
        }
        return {
            nodes,
            edges,
            entryNodeId: switchEntryId,
            exitPoints: switchExitPoints,
            nodesConnectedToExit,
        };
    }
    processCallExpression(callExpr, exitId) {
        const expression = callExpr.getExpression();
        if (ts_morph_1.Node.isPropertyAccessExpression(expression)) {
            const methodName = expression.getName();
            const promiseMethods = ["then", "catch", "finally"];
            if (promiseMethods.includes(methodName)) {
                return this.processPromiseCallExpression(callExpr, exitId);
            }
            const commonHOFs = [
                "map",
                "filter",
                "forEach",
                "reduce",
                "find",
                "some",
                "every",
                "sort",
                "flatMap",
            ];
            if (commonHOFs.includes(methodName)) {
                const callback = callExpr.getArguments()[0];
                if (callback &&
                    (ts_morph_1.Node.isArrowFunction(callback) ||
                        ts_morph_1.Node.isFunctionExpression(callback))) {
                    let nodes = [];
                    let edges = [];
                    const loopId = this.generateNodeId(`hof_${methodName}`);
                    const collectionName = this.escapeString(expression.getExpression().getText());
                    const conditionText = `For each item in ${collectionName}`;
                    nodes.push({ id: loopId, label: conditionText, shape: 'diamond', style: this.nodeStyles.decision });
                    const bodyResult = this.processCallback(callback, exitId);
                    nodes.push(...bodyResult.nodes);
                    edges.push(...bodyResult.edges);
                    if (bodyResult.entryNodeId) {
                        edges.push({ from: loopId, to: bodyResult.entryNodeId, label: 'Loop Body' });
                        bodyResult.exitPoints.forEach((ep) => {
                            if (!bodyResult.nodesConnectedToExit.has(ep.id)) {
                                edges.push({ from: ep.id, to: loopId });
                            }
                        });
                    }
                    else {
                        edges.push({ from: loopId, to: loopId, label: 'Loop Body' });
                    }
                    const nodesConnectedToExit = new Set();
                    bodyResult.nodesConnectedToExit.forEach((n) => nodesConnectedToExit.add(n));
                    return {
                        nodes,
                        edges,
                        entryNodeId: loopId,
                        exitPoints: [{ id: loopId, label: "End Loop" }],
                        nodesConnectedToExit,
                    };
                }
            }
        }
        // Default behavior for all other calls
        const nodeId = this.generateNodeId("stmt");
        const text = this.escapeString(callExpr.getText());
        const nodes = [{ id: nodeId, label: text, shape: 'rect' }];
        return {
            nodes,
            edges: [],
            entryNodeId: nodeId,
            exitPoints: [{ id: nodeId }],
            nodesConnectedToExit: new Set(),
        };
    }
    processPromiseCallExpression(callExpr, exitId) {
        const expression = callExpr.getExpression();
        const methodName = expression.getName();
        const promiseSourceExpr = expression.getExpression();
        // Recursively process the promise chain
        let sourceResult;
        if (ts_morph_1.Node.isCallExpression(promiseSourceExpr)) {
            sourceResult = this.processCallExpression(promiseSourceExpr, exitId);
        }
        else {
            const nodeId = this.generateNodeId("expr");
            const nodeText = this.escapeString(promiseSourceExpr.getText());
            const nodes = [{ id: nodeId, label: nodeText, shape: 'rect' }];
            const edges = [{ from: nodeId, to: nodeId }];
            const start = promiseSourceExpr.getStart();
            const end = promiseSourceExpr.getEnd();
            this.locationMap.push({ start, end, nodeId });
            return {
                nodes,
                edges: [],
                entryNodeId: nodeId,
                exitPoints: [{ id: nodeId }],
                nodesConnectedToExit: new Set(),
            };
        }
        let nodes = [];
        let edges = [];
        const nodesConnectedToExit = new Set(sourceResult.nodesConnectedToExit);
        const newExitPoints = [];
        const callback = callExpr.getArguments()[0];
        if (callback &&
            (ts_morph_1.Node.isArrowFunction(callback) || ts_morph_1.Node.isFunctionExpression(callback))) {
            const callbackResult = this.processCallback(callback, exitId);
            nodes.push(...callbackResult.nodes);
            edges.push(...callbackResult.edges);
            callbackResult.nodesConnectedToExit.forEach((n) => nodesConnectedToExit.add(n));
            if (callbackResult.entryNodeId) {
                const edgeLabel = methodName === "catch" ? "rejected" : methodName;
                sourceResult.exitPoints.forEach((ep) => {
                    if (!sourceResult.nodesConnectedToExit.has(ep.id)) {
                        edges.push({ from: ep.id, to: callbackResult.entryNodeId, label: edgeLabel });
                    }
                });
            }
            newExitPoints.push(...callbackResult.exitPoints);
        }
        else {
            // No callback, so just pass through
            newExitPoints.push(...sourceResult.exitPoints);
        }
        // For `then` and `finally`, the original fulfilled/rejected path might continue
        // if the handler is not there or completes successfully.
        // This is a simplification that assumes the happy path if a handler exists.
        if (methodName === "then") {
            // Unhandled rejections from `sourceResult` pass through.
            // We assume `sourceResult.exitPoints` represents the fulfilled path if we connect it.
            // And we lose the rejection path. This is a simplification.
        }
        // if there's a second argument to .then (onRejected)
        const onRejected = methodName === "then" && callExpr.getArguments()[1];
        if (onRejected &&
            (ts_morph_1.Node.isArrowFunction(onRejected) || ts_morph_1.Node.isFunctionExpression(onRejected))) {
            const onRejectedResult = this.processCallback(onRejected, exitId);
            nodes.push(...onRejectedResult.nodes);
            edges.push(...onRejectedResult.edges);
            onRejectedResult.nodesConnectedToExit.forEach((n) => nodesConnectedToExit.add(n));
            if (onRejectedResult.entryNodeId) {
                sourceResult.exitPoints.forEach((ep) => {
                    if (!sourceResult.nodesConnectedToExit.has(ep.id)) {
                        edges.push({ from: ep.id, to: onRejectedResult.entryNodeId, label: 'rejected' });
                    }
                });
            }
            newExitPoints.push(...onRejectedResult.exitPoints);
        }
        return {
            nodes,
            edges,
            entryNodeId: sourceResult.entryNodeId,
            exitPoints: newExitPoints,
            nodesConnectedToExit,
        };
    }
    processCallback(callback, exitId, loopContext) {
        const body = callback.getBody();
        if (ts_morph_1.Node.isBlock(body)) {
            return this.processBlock(body, exitId, loopContext);
        }
        else {
            // Concise arrow function with an expression body.
            // We process it as a single statement.
            const expr = body;
            const nodeId = this.generateNodeId("expr_stmt");
            const text = this.escapeString(expr.getText());
            const nodes = [{ id: nodeId, label: text, shape: 'rect' }];
            const edges = [{ from: nodeId, to: nodeId }];
            const start = expr.getStart();
            const end = expr.getEnd();
            this.locationMap.push({ start, end, nodeId });
            return {
                nodes,
                edges: [],
                entryNodeId: nodeId,
                exitPoints: [{ id: nodeId }],
                nodesConnectedToExit: new Set(),
            };
        }
    }
    createTernaryGraph(condExpr, thenText, elseText) {
        const conditionId = this.generateNodeId("ternary_cond");
        const conditionText = this.escapeString(condExpr.getCondition().getText());
        const nodes = [];
        const edges = [];
        nodes.push({ id: conditionId, label: conditionText, shape: 'diamond', style: this.nodeStyles.decision });
        const start = condExpr.getStart();
        const end = condExpr.getEnd();
        this.locationMap.push({ start, end, nodeId: conditionId });
        const thenNodeId = this.generateNodeId("ternary_then");
        nodes.push({ id: thenNodeId, label: this.escapeString(thenText), shape: 'rect' });
        edges.push({ from: conditionId, to: thenNodeId, label: 'Yes' });
        const elseNodeId = this.generateNodeId("ternary_else");
        nodes.push({ id: elseNodeId, label: this.escapeString(elseText), shape: 'rect' });
        edges.push({ from: conditionId, to: elseNodeId, label: 'No' });
        const exitPoints = [{ id: thenNodeId }, { id: elseNodeId }];
        return {
            nodes,
            edges,
            entryNodeId: conditionId,
            exitPoints,
            nodesConnectedToExit: new Set(),
        };
    }
    /**
     * Processes an if-else statement, handling both `then` and `else` branches and their merge points.
     */
    processIfStatement(ifStmt, exitId, loopContext) {
        const condition = this.escapeString(ifStmt.getExpression().getText());
        const conditionId = this.generateNodeId("if_cond");
        const nodes = [];
        const edges = [];
        nodes.push({ id: conditionId, label: condition, shape: 'diamond', style: this.nodeStyles.decision });
        const start = ifStmt.getStart();
        const end = ifStmt.getEnd();
        this.locationMap.push({ start, end, nodeId: conditionId });
        let current = ifStmt;
        const exitPoints = [];
        const nodesConnectedToExit = new Set();
        // Process "then" branch.
        const thenResult = this.processStatement(ifStmt.getThenStatement(), exitId, loopContext);
        nodes.push(...thenResult.nodes);
        edges.push(...thenResult.edges);
        if (thenResult.entryNodeId) {
            edges.push({ from: conditionId, to: thenResult.entryNodeId, label: 'Yes' });
        }
        exitPoints.push(...thenResult.exitPoints);
        thenResult.nodesConnectedToExit.forEach((n) => nodesConnectedToExit.add(n));
        // Process "else" branch if it exists.
        const elseStatement = ifStmt.getElseStatement();
        if (elseStatement) {
            const elseResult = this.processStatement(elseStatement, exitId, loopContext);
            nodes.push(...elseResult.nodes);
            edges.push(...elseResult.edges);
            if (elseResult.entryNodeId) {
                edges.push({ from: conditionId, to: elseResult.entryNodeId, label: 'No' });
            }
            exitPoints.push(...elseResult.exitPoints);
            elseResult.nodesConnectedToExit.forEach((n) => nodesConnectedToExit.add(n));
        }
        else {
            // If no 'else', the "No" path from the condition is a valid exit from this structure.
            exitPoints.push({ id: conditionId, label: "No" });
        }
        return {
            nodes,
            edges,
            entryNodeId: conditionId,
            exitPoints,
            nodesConnectedToExit,
        };
    }
    /**
     * Processes a 'try-catch-finally' statement.
     */
    processTryStatement(tryStmt, exitId, loopContext) {
        const nodes = [];
        const edges = [];
        const nodesConnectedToExit = new Set();
        const tryBlock = tryStmt.getTryBlock();
        const catchClause = tryStmt.getCatchClause();
        const finallyBlock = tryStmt.getFinallyBlock();
        const entryNodeId = this.generateNodeId("try_entry");
        nodes.push({ id: entryNodeId, label: "Try", shape: "stadium", style: this.nodeStyles.special });
        const start = tryStmt.getStart();
        const end = tryStmt.getEnd();
        this.locationMap.push({ start, end, nodeId: entryNodeId });
        let lastExitPoints = [];
        const tryResult = this.processBlock(tryBlock, exitId, loopContext);
        nodes.push(...tryResult.nodes);
        edges.push(...tryResult.edges);
        tryResult.nodesConnectedToExit.forEach((n) => nodesConnectedToExit.add(n));
        if (tryResult.entryNodeId) {
            edges.push({ from: entryNodeId, to: tryResult.entryNodeId });
        }
        lastExitPoints.push(...tryResult.exitPoints);
        const catchResult = catchClause
            ? this.processBlock(catchClause.getBlock(), exitId, loopContext)
            : null;
        if (catchResult) {
            nodes.push(...catchResult.nodes);
            edges.push(...catchResult.edges);
            catchResult.nodesConnectedToExit.forEach((n) => nodesConnectedToExit.add(n));
            if (catchResult.entryNodeId) {
                edges.push({ from: entryNodeId, to: catchResult.entryNodeId, label: "error" });
            }
            lastExitPoints.push(...catchResult.exitPoints);
        }
        const finallyResult = finallyBlock
            ? this.processBlock(finallyBlock, exitId, loopContext)
            : null;
        if (finallyResult) {
            nodes.push(...finallyResult.nodes);
            edges.push(...finallyResult.edges);
            finallyResult.nodesConnectedToExit.forEach((n) => nodesConnectedToExit.add(n));
            if (finallyResult.entryNodeId) {
                lastExitPoints.forEach((ep) => {
                    if (!nodesConnectedToExit.has(ep.id)) {
                        edges.push({ from: ep.id, to: finallyResult.entryNodeId });
                    }
                });
            }
            lastExitPoints = finallyResult.exitPoints;
        }
        return {
            nodes,
            edges,
            entryNodeId: entryNodeId,
            exitPoints: lastExitPoints,
            nodesConnectedToExit,
        };
    }
    /**
     * Processes a 'for' loop, modeling the initializer, condition, body, and incrementor.
     */
    processForStatement(forStmt, exitId) {
        const nodes = [];
        const edges = [];
        const nodesConnectedToExit = new Set();
        const initializer = forStmt.getInitializer();
        const initText = initializer ? this.escapeString(initializer.getText()) : "";
        const initId = this.generateNodeId("for_init");
        nodes.push({ id: initId, label: initText, shape: 'rect' });
        const start = forStmt.getStart();
        const end = forStmt.getEnd();
        this.locationMap.push({ start, end, nodeId: initId });
        const condition = forStmt.getCondition();
        const condText = condition ? this.escapeString(condition.getText()) : "true";
        const condId = this.generateNodeId("for_cond");
        nodes.push({ id: condId, label: condText, shape: 'diamond', style: this.nodeStyles.decision });
        edges.push({ from: initId, to: condId });
        const incText = this.escapeString(forStmt.getIncrementor()?.getText() || "");
        const incId = this.generateNodeId("for_inc");
        nodes.push({ id: incId, label: incText || "increment", shape: 'rect' });
        const loopExitId = this.generateNodeId("for_exit");
        nodes.push({ id: loopExitId, label: '', shape: 'stadium' }); // Dummy node for break
        const loopContext = {
            breakTargetId: loopExitId,
            continueTargetId: incId,
        };
        const bodyResult = this.processStatement(forStmt.getStatement(), exitId, loopContext);
        nodes.push(...bodyResult.nodes);
        edges.push(...bodyResult.edges);
        if (bodyResult.entryNodeId) {
            edges.push({ from: condId, to: bodyResult.entryNodeId, label: 'Yes' });
        }
        bodyResult.nodesConnectedToExit.forEach((n) => nodesConnectedToExit.add(n));
        bodyResult.exitPoints.forEach((exitPoint) => {
            const label = exitPoint.label ? exitPoint.label : undefined;
            edges.push({ from: exitPoint.id, to: incId, label: label });
        });
        edges.push({ from: incId, to: condId }); // Loop back to condition.
        edges.push({ from: condId, to: loopExitId, label: 'No' });
        return {
            nodes,
            edges,
            entryNodeId: initId,
            exitPoints: [{ id: loopExitId }],
            nodesConnectedToExit,
        };
    }
    processForOfStatement(forOfStmt, exitId) {
        const nodes = [];
        const edges = [];
        const nodesConnectedToExit = new Set();
        const initializer = this.escapeString(forOfStmt.getInitializer().getText());
        const expression = this.escapeString(forOfStmt.getExpression().getText());
        const body = forOfStmt.getStatement();
        const loopHeaderId = this.generateNodeId("for_of_header");
        const loopHeaderText = this.escapeString(`for (${initializer} of ${expression})`);
        nodes.push({ id: loopHeaderId, label: loopHeaderText, shape: 'diamond', style: this.nodeStyles.decision });
        const start = forOfStmt.getStart();
        const end = forOfStmt.getEnd();
        this.locationMap.push({ start, end, nodeId: loopHeaderId });
        const exitLoopId = this.generateNodeId("for_of_exit");
        nodes.push({ id: exitLoopId, label: "end loop", shape: 'stadium' });
        const loopContext = {
            breakTargetId: exitLoopId,
            continueTargetId: loopHeaderId, // For..of continues to the next iteration directly.
        };
        const bodyResult = this.processBlock(body, exitId, loopContext);
        nodes.push(...bodyResult.nodes);
        edges.push(...bodyResult.edges);
        if (bodyResult.entryNodeId) {
            edges.push({ from: loopHeaderId, to: bodyResult.entryNodeId, label: 'Loop' });
        }
        bodyResult.nodesConnectedToExit.forEach((n) => nodesConnectedToExit.add(n));
        bodyResult.exitPoints.forEach((exitPoint) => {
            const label = exitPoint.label ? exitPoint.label : undefined;
            edges.push({ from: exitPoint.id, to: loopHeaderId, label: label });
        });
        edges.push({ from: loopHeaderId, to: exitLoopId, label: 'End For Each' });
        return {
            nodes,
            edges,
            entryNodeId: loopHeaderId,
            exitPoints: [{ id: exitLoopId }],
            nodesConnectedToExit,
        };
    }
    processForInStatement(forInStmt, exitId) {
        const nodes = [];
        const edges = [];
        const nodesConnectedToExit = new Set();
        const initializer = this.escapeString(forInStmt.getInitializer().getText());
        const expression = this.escapeString(forInStmt.getExpression().getText());
        const loopHeaderId = this.generateNodeId("for_in_header");
        const loopHeaderText = this.escapeString(`for (${initializer} in ${expression})`);
        nodes.push({ id: loopHeaderId, label: loopHeaderText, shape: 'diamond', style: this.nodeStyles.decision });
        const start = forInStmt.getStart();
        const end = forInStmt.getEnd();
        this.locationMap.push({ start, end, nodeId: loopHeaderId });
        const exitLoopId = this.generateNodeId("for_in_exit");
        nodes.push({ id: exitLoopId, label: "end loop", shape: 'stadium' });
        const loopContext = {
            breakTargetId: exitLoopId,
            continueTargetId: loopHeaderId, // For..in continues to the next iteration directly.
        };
        const bodyResult = this.processBlock(forInStmt.getStatement(), exitId, loopContext);
        nodes.push(...bodyResult.nodes);
        edges.push(...bodyResult.edges);
        if (bodyResult.entryNodeId) {
            edges.push({ from: loopHeaderId, to: bodyResult.entryNodeId, label: 'Loop' });
        }
        bodyResult.nodesConnectedToExit.forEach((n) => nodesConnectedToExit.add(n));
        bodyResult.exitPoints.forEach((exitPoint) => {
            const label = exitPoint.label ? exitPoint.label : undefined;
            edges.push({ from: exitPoint.id, to: loopHeaderId, label: label });
        });
        edges.push({ from: loopHeaderId, to: exitLoopId, label: 'End For In' });
        return {
            nodes,
            edges,
            entryNodeId: loopHeaderId,
            exitPoints: [{ id: exitLoopId }],
            nodesConnectedToExit,
        };
    }
    /**
     * Processes a 'while' loop.
     */
    processWhileStatement(whileStmt, exitId) {
        const nodes = [];
        const edges = [];
        const nodesConnectedToExit = new Set();
        const condition = this.escapeString(whileStmt.getExpression().getText());
        const conditionId = this.generateNodeId("while_cond");
        nodes.push({ id: conditionId, label: condition, shape: 'diamond', style: this.nodeStyles.decision });
        const start = whileStmt.getStart();
        const end = whileStmt.getEnd();
        this.locationMap.push({ start, end, nodeId: conditionId });
        const exitLoopId = this.generateNodeId("while_exit");
        nodes.push({ id: exitLoopId, label: "end loop", shape: 'stadium' });
        const loopContext = {
            breakTargetId: exitLoopId,
            continueTargetId: conditionId,
        };
        const bodyResult = this.processStatement(whileStmt.getStatement(), exitId, loopContext);
        nodes.push(...bodyResult.nodes);
        edges.push(...bodyResult.edges);
        if (bodyResult.entryNodeId) {
            edges.push({ from: conditionId, to: bodyResult.entryNodeId, label: 'Yes' });
        }
        bodyResult.nodesConnectedToExit.forEach((n) => nodesConnectedToExit.add(n));
        bodyResult.exitPoints.forEach((exitPoint) => {
            const label = exitPoint.label ? ` -- "${exitPoint.label}" --> ` : ` --> `;
            edges.push({ from: exitPoint.id, to: conditionId, label: label });
        });
        edges.push({ from: conditionId, to: exitLoopId, label: 'No' });
        return {
            nodes,
            edges,
            entryNodeId: conditionId,
            exitPoints: [{ id: exitLoopId }],
            nodesConnectedToExit,
        };
    }
    /**
     * Processes a 'do-while' loop.
     */
    processDoWhileStatement(doStmt, exitId) {
        const nodes = [];
        const edges = [];
        const nodesConnectedToExit = new Set();
        const bodyEntryId = this.generateNodeId("do_while_body");
        nodes.push({ id: bodyEntryId, label: 'do', shape: 'stadium' });
        const start = doStmt.getStart();
        const end = doStmt.getEnd();
        this.locationMap.push({ start, end, nodeId: bodyEntryId });
        const condition = this.escapeString(doStmt.getExpression().getText());
        const conditionId = this.generateNodeId("do_while_cond");
        nodes.push({ id: conditionId, label: condition, shape: 'diamond', style: this.nodeStyles.decision });
        const exitLoopId = this.generateNodeId("do_while_exit");
        nodes.push({ id: exitLoopId, label: "end loop", shape: 'stadium' });
        const loopContext = {
            breakTargetId: exitLoopId,
            continueTargetId: conditionId, // 'continue' in do-while goes to the condition check.
        };
        const body = doStmt.getStatement();
        const bodyResult = this.processStatement(body, exitId, loopContext);
        nodes.push(...bodyResult.nodes);
        edges.push(...bodyResult.edges);
        bodyResult.nodesConnectedToExit.forEach((n) => nodesConnectedToExit.add(n));
        if (bodyResult.entryNodeId) {
            edges.push({ from: bodyEntryId, to: bodyResult.entryNodeId });
            bodyResult.exitPoints.forEach((exitPoint) => {
                const label = exitPoint.label
                    ? exitPoint.label
                    : undefined;
                edges.push({ from: exitPoint.id, to: conditionId, label: label });
            });
            edges.push({ from: conditionId, to: bodyEntryId, label: 'Yes' }); // Loop back.
        }
        else {
            edges.push({ from: bodyEntryId, to: conditionId });
        }
        edges.push({ from: conditionId, to: exitLoopId, label: 'No' });
        return {
            nodes,
            edges,
            entryNodeId: bodyEntryId,
            exitPoints: [{ id: exitLoopId }],
            nodesConnectedToExit,
        };
    }
}
exports.TsAstParser = TsAstParser;
//# sourceMappingURL=TsAstParser.js.map