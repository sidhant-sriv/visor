// math_utils.ts
export function add(a: number, b: number): number {
    return a + b;
}

export function multiply(a: number, b: number): number {
    return a * b;
}

export class Calculator {
    private history: number[] = [];

    calculate(operation: string, a: number, b: number): number {
        let result: number;
        
        switch (operation) {
            case 'add':
                result = add(a, b);
                break;
            case 'multiply':
                result = multiply(a, b);
                break;
            default:
                result = 0;
        }
        
        this.history.push(result);
        return result;
    }

    getHistory(): number[] {
        return this.history.slice();
    }
}