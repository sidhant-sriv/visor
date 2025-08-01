import * as vscode from 'vscode';
import { FlowchartViewProvider } from './view/FlowchartViewProvider';
import { initLanguageServices } from './logic/language-services';

export async function activate(context: vscode.ExtensionContext) {
    console.log('Visor extension is now active!');

    try {
        // Initialize all language services
        await initLanguageServices(context);
        console.log('All language parsers initialized successfully.');
    } catch (error) {
        console.error('Failed to initialize language parsers:', error);
        vscode.window.showErrorMessage('Visor: Failed to load language parsers. Flowchart generation may not be available.');
    }

    const provider = new FlowchartViewProvider(context.extensionUri);

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(FlowchartViewProvider.viewType, provider)
    );
}

export function deactivate() {}
