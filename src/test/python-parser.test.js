"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const assert = __importStar(require("assert"));
const python_1 = require("../logic/language-services/python");
suite('Python Parser Integration Tests', () => {
    const samplePythonCode = `
def fibonacci(n):
    """Calculate the nth Fibonacci number"""
    if n <= 0:
        return 0
    elif n == 1:
        return 1
    else:
        a, b = 0, 1
        for i in range(2, n + 1):
            a, b = b, a + b
        return b

def process_numbers(numbers):
    """Process a list of numbers"""
    result = []
    
    for num in numbers:
        if num < 0:
            continue
        elif num == 0:
            result.append("zero")
        elif num % 2 == 0:
            result.append("even")
        else:
            result.append("odd")
    
    return result
`;
    test('should analyze Python code successfully', () => {
        const position = 50; // Position within the fibonacci function
        const result = (0, python_1.analyzePythonCode)(samplePythonCode, position);
        // Should return a valid flowchart
        assert.ok(result.flowchart);
        assert.ok(result.flowchart.includes('graph TD'));
        assert.ok(result.flowchart.includes('fibonacci'));
        // Should have location map entries
        assert.ok(result.locationMap);
        assert.ok(result.locationMap.length > 0);
        // Should have function range
        assert.ok(result.functionRange);
        assert.ok(result.functionRange.start >= 0);
        assert.ok(result.functionRange.end > result.functionRange.start);
    });
    test('should handle position outside function', () => {
        const position = 0; // Position outside any function
        const result = (0, python_1.analyzePythonCode)(samplePythonCode, position);
        // Should return error message
        assert.ok(result.flowchart);
        assert.ok(result.flowchart.includes('Place cursor inside a function'));
    });
    test('should handle invalid Python code gracefully', () => {
        const invalidCode = 'invalid python code :::';
        const position = 5;
        const result = (0, python_1.analyzePythonCode)(invalidCode, position);
        // Should handle error gracefully
        assert.ok(result.flowchart);
        // Should not crash
        assert.ok(result.locationMap !== undefined);
    });
    test('should handle complex async function with await', () => {
        const complexAsyncCode = `
async def full_feature_test(data_list, config_path):
    print("Function execution started.")
    processed_items = []

    # Test a 'with' statement
    with open(config_path, 'r') as f:
        config = f.read()
        print("Config loaded successfully.")

    # Test a 'for' loop with complex branching
    for item in data_list:
        if item is None:
            # Test a 'pass' statement in a simple block
            pass
            # Test 'continue'
            continue
        elif item < 0:
            print("Negative item found, breaking loop.")
            # Test 'break'
            break
        else:
            # Test 'try/except/else/finally'
            try:
                # Test an 'await' call
                await asyncio.sleep(0.1)
                result = item / 10
                if result > 5:
                    print("Result is large.")
                else:
                    print("Result is small.")
            except TypeError:
                print("A TypeError occurred.")
            except ValueError as e:
                print(f"A ValueError occurred: {e}")
            else:
                # Test the 'else' block of a 'try' statement
                print("Try block completed without exceptions.")
                processed_items.append(result)
            finally:
                # Test the 'finally' block
                print("Finished processing one item.")
    else:
        # Test the 'else' block of a 'for' loop
        print("For loop completed without a break.")

    # Test a simple 'while' loop
    count = 3
    while count > 0:
        print(f"Countdown: {count}")
        count -= 1
        if count == 1:
            # This break will prevent the while-loop's else from running
            break
    else:
        print("This should not be printed.")

    return processed_items
`;
        const position = 100; // Position within the function
        const result = (0, python_1.analyzePythonCode)(complexAsyncCode, position);
        // Should return a valid flowchart
        assert.ok(result.flowchart);
        console.log('Generated flowchart:', result.flowchart);
        // Should not be an error message
        assert.ok(!result.flowchart.includes('Error:'));
        // Should have location map entries
        assert.ok(result.locationMap);
        assert.ok(result.locationMap.length > 0);
    });
});
//# sourceMappingURL=python-parser.test.js.map