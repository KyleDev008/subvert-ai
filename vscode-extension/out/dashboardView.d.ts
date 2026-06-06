import * as vscode from 'vscode';
import { ServerManager } from './serverManager';
import { ApiClient } from './apiClient';
export declare class DashboardViewProvider implements vscode.WebviewViewProvider {
    static readonly viewType = "subvertAIDashboard";
    private _view?;
    private serverManager;
    private apiClient;
    private outputChannel;
    private _extensionUri;
    constructor(extensionUri: vscode.Uri, serverManager: ServerManager, apiClient: ApiClient, outputChannel: vscode.OutputChannel);
    resolveWebviewView(webviewView: vscode.WebviewView, context: vscode.WebviewViewResolveContext, _token: vscode.CancellationToken): void;
    updateContent(): Promise<void>;
    private getHtml;
}
//# sourceMappingURL=dashboardView.d.ts.map