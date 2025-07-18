const fs = require('fs');
const path = require('path');

// Import the compiled Python parser
const { analyzePythonCode } = require('./dist/logic/language-services/python/index.js');

// Read the test Python file
const testPyFile = fs.readFileSync('test_debug.py', 'utf8');

console.log('Testing Python AST parser with the function...');
console.log('Python code:');
console.log(testPyFile);
console.log('\n' + '='.repeat(50) + '\n');

try {
    const result = analyzePythonCode(testPyFile, 0);
    console.log('Success! Generated flowchart:');
    console.log(result.flowchart);
} catch (error) {
    console.error('Error occurred:', error);
    console.error('Stack trace:', error.stack);
} 