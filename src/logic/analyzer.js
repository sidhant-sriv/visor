"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.analyzeCode = analyzeCode;
const typescript_1 = require("./language-services/typescript");
const python_1 = require("./language-services/python");
/**
 * Orchestrates the analysis of a code string.
 * It creates an in-memory ts-morph project to parse the code.
 */
function analyzeCode(code, position, language) {
    // Language selection logic
    if (language === 'typescript' || language === 'javascript') {
        return (0, typescript_1.analyzeTypeScriptCode)(code, position);
    }
    if (language === 'python') {
        return (0, python_1.analyzePythonCode)(code, position);
    }
    // Default or unsupported language
    return {
        flowchart: 'graph TD\n    A[Error: Unsupported language]\n    A --> B["' + language + '"]',
        locationMap: []
    };
}
//# sourceMappingURL=analyzer.js.map