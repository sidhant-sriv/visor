import * as assert from 'assert';
import { analyzePythonCode } from '../logic/language-services/python';

suite('Performance Tests', () => {
    // Medium-sized Python code sample
    const pythonCode = `
def complex_function(data):
    """Process complex data structure"""
    result = []
    
    for item in data:
        if isinstance(item, dict):
            for key, value in item.items():
                if value > 10:
                    result.append(key)
                else:
                    continue
        elif isinstance(item, list):
            for subitem in item:
                if subitem % 2 == 0:
                    result.append(subitem * 2)
                else:
                    result.append(subitem + 1)
        else:
            try:
                with open('config.txt', 'r') as f:
                    config = f.read()
                    if config:
                        result.append(len(config))
            except FileNotFoundError:
                pass
    
    return result
`;

    // Medium-sized TypeScript code sample
    const typeScriptCode = `
function complexFunction(data: any[]): (string | number)[] {
    const result: (string | number)[] = [];
    
    for (const item of data) {
        if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
            for (const [key, value] of Object.entries(item)) {
                if (typeof value === 'number' && value > 10) {
                    result.push(key);
                } else {
                    continue;
                }
            }
        } else if (Array.isArray(item)) {
            for (const subitem of item) {
                if (typeof subitem === 'number') {
                    if (subitem % 2 === 0) {
                        result.push(subitem * 2);
                    } else {
                        result.push(subitem + 1);
                    }
                }
            }
        } else {
            try {
                const fs = require('fs');
                const config = fs.readFileSync('config.txt', 'utf8');
                if (config) {
                    result.push(config.length);
                }
            } catch (error) {
                // Handle error
            }
        }
    }
    
    return result;
}
`;

    test('Python parser performance should be reasonable', function() {
        this.timeout(5000); // 5 second timeout
        
        const startTime = Date.now();
        const result = analyzePythonCode(pythonCode, 100);
        const endTime = Date.now();
        
        const duration = endTime - startTime;
        console.log(`Python parser took ${duration}ms`);
        
        // Should complete within 1 second for reasonable code size
        assert.ok(duration < 1000, `Python parser took too long: ${duration}ms`);
        
        // Should return valid result
            
    });

    test('TypeScript parser performance should be reasonable', function() {
        this.timeout(5000); // 5 second timeout
        
        const startTime = Date.now();
        const endTime = Date.now();
        
        const duration = endTime - startTime;
        console.log(`TypeScript parser took ${duration}ms`);
        
        // Should complete within 1 second for reasonable code size
        assert.ok(duration < 1000, `TypeScript parser took too long: ${duration}ms`);
        
    });
}); 