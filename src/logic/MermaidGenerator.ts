import { FlowchartIR, FlowchartNode } from '../ir/ir';
import { StringProcessor } from './utils/StringProcessor';

// Optimized string building
class StringBuilder {
    private parts: string[] = [];

    append(str: string): void {
        this.parts.push(str);
    }

    appendLine(str: string): void {
        this.parts.push(str, '\n');
    }

    toString(): string {
        return this.parts.join('');
    }

    clear(): void {
        this.parts.length = 0;
    }
}

export class MermaidGenerator {
    private sb = new StringBuilder();
    
    public generate(ir: FlowchartIR): string {
        this.sb.clear();
        this.sb.appendLine('graph TD');

        if (ir.title) {
            this.sb.appendLine(`%% ${ir.title}`);
        }

        // Generate nodes efficiently
        for (const node of ir.nodes) {
            const shape = this.getShape(node);
            const label = this.escapeString(node.label);
            this.sb.append('    ');
            this.sb.append(node.id);
            this.sb.append(shape[0]);
            this.sb.append('"');
            this.sb.append(label);
            this.sb.append('"');
            this.sb.append(shape[1]);
            this.sb.appendLine('');
        }

        // Generate edges efficiently  
        for (const edge of ir.edges) {
            this.sb.append('    ');
            this.sb.append(edge.from);
            
            if (edge.label) {
                const label = this.escapeString(edge.label);
                this.sb.append(' -- "');
                this.sb.append(label);
                this.sb.append('" --> ');
            } else {
                this.sb.append(' --> ');
            }
            
            this.sb.append(edge.to);
            this.sb.appendLine('');
        }

        // Generate click handlers efficiently
        for (const entry of ir.locationMap) {
            this.sb.append('    click ');
            this.sb.append(entry.nodeId);
            this.sb.append(' call onNodeClick(');
            this.sb.append(entry.start.toString());
            this.sb.append(', ');
            this.sb.append(entry.end.toString());
            this.sb.appendLine(')');
        }

        return this.sb.toString();
    }

    private getShape(node: FlowchartNode): [string, string] {
        switch (node.shape) {
            case 'diamond':
                return ['{', '}'];
            case 'round':
                return ['((', '))'];
            case 'stadium':
                return ['([', '])'];
            case 'rect':
            default:
                return ['[', ']'];
        }
    }

    private escapeString(str: string): string {
        return StringProcessor.escapeString(str);
    }
} 