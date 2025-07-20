const Parser = require("tree-sitter");
const Python = require("tree-sitter-python");

const parser = new Parser();
parser.setLanguage(Python);

const testCode = `def test_multiple_returns():
    x = 5
    if x > 0:
        return "positive"
    elif x < 0:
        return "negative"
    else:
        return "zero"`;

const tree = parser.parse(testCode);

function printNodeDebug(node, depth = 0) {
  const indent = "  ".repeat(depth);

  if (node.type === "if_statement") {
    console.log(`${indent}=== IF STATEMENT ===`);
    console.log(`${indent}text: "${node.text.replace(/\n/g, "\\n")}"`);
    console.log(`${indent}children count: ${node.children.length}`);
    node.children.forEach((child, i) => {
      console.log(
        `${indent}  child[${i}]: ${child.type} - "${child.text.replace(
          /\n/g,
          "\\n"
        )}"`
      );
    });

    // Find blocks specifically
    const blocks = node.children.filter((c) => c.type === "block");
    console.log(`${indent}blocks found: ${blocks.length}`);
    blocks.forEach((block, i) => {
      console.log(
        `${indent}  block[${i}]: "${block.text.replace(/\n/g, "\\n")}"`
      );
      const statements = block.namedChildren;
      console.log(`${indent}    statements in block: ${statements.length}`);
      statements.forEach((stmt, j) => {
        console.log(
          `${indent}      stmt[${j}]: ${stmt.type} - "${stmt.text.replace(
            /\n/g,
            "\\n"
          )}"`
        );
      });
    });
  }

  for (const child of node.children) {
    printNodeDebug(child, depth + 1);
  }
}

console.log("=== Debugging IF Statement Structure ===");
printNodeDebug(tree.rootNode);
