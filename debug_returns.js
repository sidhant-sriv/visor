const {
  PyAstParser,
} = require("./out/logic/language-services/python/PyAstParser");
const fs = require("fs");

const parser = new PyAstParser();
const testCode = fs.readFileSync("./test_return_statements.py", "utf8");

console.log("Functions found:", parser.listFunctions(testCode));

// Test each function
const functions = [
  "test_multiple_returns",
  "test_early_return",
  "test_nested_return",
  "test_return_in_try",
];

functions.forEach((funcName) => {
  console.log(`\n=== Testing ${funcName} ===`);
  const result = parser.generateFlowchart(testCode, funcName);

  console.log("Nodes:");
  result.nodes.forEach((node) => {
    console.log(`  ${node.id}: ${node.label} (${node.shape})`);
  });

  console.log("Edges:");
  result.edges.forEach((edge) => {
    console.log(
      `  ${edge.from} -> ${edge.to}${edge.label ? ` (${edge.label})` : ""}`
    );
  });

  // Check return statements specifically
  const returnNodes = result.nodes.filter((node) =>
    node.label.includes("return")
  );
  console.log(`Return statements found: ${returnNodes.length}`);
  returnNodes.forEach((node) => {
    console.log(`  Return node: ${node.id} - ${node.label}`);
  });
});
