const Parser = require("tree-sitter");
const Python = require("tree-sitter-python");

const parser = new Parser();
parser.setLanguage(Python);

const code = `def test_multiple_returns():
    x = 5
    if x > 0:
        return "positive"
    elif x < 0:
        return "negative"
    else:
        return "zero"`;

const tree = parser.parse(code);

// Find the function body block
function findFunctionBody(node) {
  if (node.type === "function_definition") {
    for (const child of node.children) {
      if (child.type === "block") {
        return child;
      }
    }
  }
  for (const child of node.children) {
    const result = findFunctionBody(child);
    if (result) return result;
  }
  return null;
}

const functionBody = findFunctionBody(tree.rootNode);

console.log("Function body block found:", functionBody ? "yes" : "no");
if (functionBody) {
  console.log("Function body children count:", functionBody.children.length);
  console.log(
    "Function body namedChildren count:",
    functionBody.namedChildren.length
  );

  console.log("\nAll children:");
  for (let i = 0; i < functionBody.children.length; i++) {
    const child = functionBody.children[i];
    console.log(
      `  Child ${i}: ${child.type} - "${child.text.replace(/\n/g, "\\n")}"`
    );
  }

  console.log("\nNamed children:");
  for (let i = 0; i < functionBody.namedChildren.length; i++) {
    const child = functionBody.namedChildren[i];
    console.log(
      `  Named child ${i}: ${child.type} - "${child.text.replace(
        /\n/g,
        "\\n"
      )}"`
    );
  }

  // Look at the if statement specifically
  const ifStatement = functionBody.namedChildren.find(
    (c) => c.type === "if_statement"
  );
  if (ifStatement) {
    console.log("\nIf statement children:");
    for (let i = 0; i < ifStatement.children.length; i++) {
      const child = ifStatement.children[i];
      console.log(
        `  If child ${i}: ${child.type} - "${child.text.replace(/\n/g, "\\n")}"`
      );
    }
  }
}
