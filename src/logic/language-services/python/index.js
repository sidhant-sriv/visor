"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.analyzePythonCode = analyzePythonCode;
const PyAstParser_1 = require("./PyAstParser");
const MermaidGenerator_1 = require("../../MermaidGenerator");
/**
 * Orchestrates the analysis of a Python code string.
 * It uses tree-sitter to parse the code and find functions.
 */
function analyzePythonCode(code, position) {
    try {
        const parser = new PyAstParser_1.PyAstParser();
        const ir = parser.generateFlowchart(code, undefined, position);
        const mermaidGenerator = new MermaidGenerator_1.MermaidGenerator();
        const flowchart = mermaidGenerator.generate(ir);
        return { flowchart, locationMap: ir.locationMap, functionRange: ir.functionRange };
    }
    catch (error) {
        console.error("Error analyzing Python code:", error);
        const errorMessage = `graph TD\n    A[Error: Unable to parse code]\n    A --> B["${error.message || error}"]`;
        return { flowchart: errorMessage, locationMap: [] };
    }
}
//# sourceMappingURL=index.js.map