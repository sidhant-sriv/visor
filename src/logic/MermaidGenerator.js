"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MermaidGenerator = void 0;
class MermaidGenerator {
    generate(ir) {
        let mermaid = 'graph TD\n';
        if (ir.title) {
            // Mermaid doesn't have a formal title, but we can use a comment
            mermaid += `%% ${ir.title}\n`;
        }
        ir.nodes.forEach(node => {
            const shape = this.getShape(node);
            const label = this.escapeString(node.label);
            mermaid += `    ${node.id}${shape[0]}"${label}"${shape[1]}\n`;
        });
        ir.edges.forEach(edge => {
            if (edge.label) {
                const label = this.escapeString(edge.label);
                mermaid += `    ${edge.from} -- "${label}" --> ${edge.to}\n`;
            }
            else {
                mermaid += `    ${edge.from} --> ${edge.to}\n`;
            }
        });
        ir.locationMap.forEach(entry => {
            mermaid += `    click ${entry.nodeId} call onNodeClick(${entry.start}, ${entry.end})\n`;
        });
        return mermaid;
    }
    getShape(node) {
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
    escapeString(str) {
        if (!str) {
            return '';
        }
        return str.replace(/"/g, '&quot;').replace(/\n/g, ' ').trim();
    }
}
exports.MermaidGenerator = MermaidGenerator;
//# sourceMappingURL=MermaidGenerator.js.map