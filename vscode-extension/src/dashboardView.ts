import * as vscode from 'vscode';
import { ServerManager } from './serverManager';
import { ApiClient } from './apiClient';

export class DashboardViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'subvertAIDashboard';

    private _view?: vscode.WebviewView;
    private serverManager: ServerManager;
    private apiClient: ApiClient;
    private outputChannel: vscode.OutputChannel;
    private _extensionUri: vscode.Uri;
    private currentPage: 'status' | 'models' | 'settings' | 'logs' = 'status';
    private isStarting: boolean = false;

    constructor(
        extensionUri: vscode.Uri,
        serverManager: ServerManager,
        apiClient: ApiClient,
        outputChannel: vscode.OutputChannel
    ) {
        this._extensionUri = extensionUri;
        this.serverManager = serverManager;
        this.apiClient = apiClient;
        this.outputChannel = outputChannel;
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        // Handle messages from the webview
        webviewView.webview.onDidReceiveMessage(async (message) => {
            switch (message.command) {
                case 'startServer':
                    this.isStarting = true;
                    this.updateContent();
                    try {
                        await vscode.commands.executeCommand('subvertAI.startServer');
                    } finally {
                        this.isStarting = false;
                        this.updateContent();
                    }
                    break;
                case 'stopServer':
                    await vscode.commands.executeCommand('subvertAI.stopServer');
                    break;
                case 'openFullDashboard':
                    await vscode.commands.executeCommand('subvertAI.openDashboard');
                    break;
                case 'testConnection':
                    await vscode.commands.executeCommand('subvertAI.testConnection');
                    break;
                case 'exportConfig':
                    await vscode.commands.executeCommand('subvertAI.exportVSCodeConfig');
                    break;
                case 'install':
                    await vscode.commands.executeCommand('subvertAI.install');
                    break;
                case 'switchPage':
                    this.currentPage = message.page;
                    this.updateContent();
                    break;
                case 'saveSettings':
                    await this.saveSettings(message.settings);
                    break;
            }
        });

        this.updateContent();

        // Auto-refresh every 30 seconds
        const interval = setInterval(() => {
            if (this._view?.visible) {
                this.updateContent();
            }
        }, 30000);

        webviewView.onDidDispose(() => {
            clearInterval(interval);
        });
    }

    public async updateContent() {
        if (!this._view) {
            return;
        }

        const isInstalled = await this.serverManager.isServerInstalled();
        const isRunning = await this.serverManager.isServerRunning();
        const port = this.serverManager.getServerPort();

        let statusInfo = '';
        let models: any[] = [];

        if (isRunning) {
            try {
                const settings = await this.apiClient.getSettings();
                const testResult = await this.apiClient.testConnection();
                if (testResult.success) {
                    models = testResult.models || [];
                }

                statusInfo = `
                    <div class="info-box success">
                        <strong>Server Status:</strong> Running on port ${port}<br>
                        <strong>Ollama URL:</strong> ${settings.ollama_cloud_url || 'Not configured'}<br>
                        <strong>Models Available:</strong> ${models.length}
                    </div>
                `;
            } catch (error) {
                statusInfo = `
                    <div class="info-box warning">
                        <strong>Server Status:</strong> Running but API error<br>
                        ${error instanceof Error ? error.message : String(error)}
                    </div>
                `;
            }
        } else if (isInstalled) {
            statusInfo = `
                <div class="info-box warning">
                    <strong>Server Status:</strong> Installed but not running
                </div>
            `;
        } else {
            statusInfo = `
                <div class="info-box error">
                    <strong>Server Status:</strong> Not installed
                </div>
            `;
        }

        const html = this.getSidebarHtml(isInstalled, isRunning, port, models);
        this._view.webview.html = html;
    }

    private async saveSettings(settings: any): Promise<void> {
        try {
            await this.apiClient.saveSettings(settings);
            vscode.window.showInformationMessage('Settings saved successfully');
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to save settings: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private getSidebarHtml(
        isInstalled: boolean,
        isRunning: boolean,
        port: number,
        models: any[]
    ): string {
        const currentPage = this.currentPage;

        // Icons (using SVG for minimal dependencies)
        const icons = {
            status: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>',
            models: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>',
            settings: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
            play: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>',
            stop: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/></svg>',
            external: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>'
        };

        // Page content generators
        const getStatusPage = () => {
            if (this.isStarting) {
                return `
                    <div class="empty-state">
                        <div class="spinner"></div>
                        <div class="empty-title">Starting...</div>
                        <div class="empty-desc">Server is starting up, please wait</div>
                    </div>
                `;
            }

            if (!isInstalled) {
                return `
                    <div class="empty-state">
                        <div class="empty-icon">📦</div>
                        <div class="empty-title">Not Installed</div>
                        <div class="empty-desc">Install the server to get started</div>
                        <button class="btn-primary" onclick="install()">
                            ${icons.play} Install
                        </button>
                    </div>
                `;
            }

            if (!isRunning) {
                return `
                    <div class="empty-state">
                        <div class="empty-icon">⏸️</div>
                        <div class="empty-title">Server Stopped</div>
                        <div class="empty-desc">Start the server to begin</div>
                        <button class="btn-primary" onclick="startServer()">
                            ${icons.play} Start Server
                        </button>
                    </div>
                `;
            }

            return `
                <div class="status-grid">
                    <div class="status-card success">
                        <div class="status-icon">✓</div>
                        <div class="status-label">Running</div>
                        <div class="status-value">Port ${port}</div>
                    </div>
                    <div class="action-buttons">
                        <button class="btn-secondary" onclick="stopServer()">
                            ${icons.stop} Stop
                        </button>
                        <button class="btn-secondary" onclick="openFullDashboard()">
                            ${icons.external} Full
                        </button>
                    </div>
                </div>
            `;
        };

        const getModelsPage = () => {
            if (!isRunning) {
                return `<div class="empty-state"><div class="empty-desc">Start server to see models</div></div>`;
            }

            if (models.length === 0) {
                return `<div class="empty-state"><div class="empty-desc">No models detected</div></div>`;
            }

            const sortedModels = [...models].sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));

            return `
                <div class="models-list-compact">
                    ${sortedModels.map(m => `
                        <div class="model-row">
                            <span class="model-dot"></span>
                            <span class="model-name-compact" title="${m.id}">${m.name || m.id}</span>
                        </div>
                    `).join('')}
                </div>
            `;
        };

        const getSettingsPage = () => `
            <div class="settings-form">
                <div class="form-group">
                    <label>Port</label>
                    <input type="number" id="port" value="${port}">
                </div>
                <div class="form-group">
                    <label>Ollama URL</label>
                    <input type="text" id="url" placeholder="https://ollama.com">
                </div>
                <div class="form-group">
                    <label>API Key</label>
                    <input type="password" id="key" placeholder="••••••••">
                </div>
                <button class="btn-primary" onclick="saveSettings()">
                    Save
                </button>
                <div class="settings-hint">
                    Changes will take effect on next server start
                </div>
            </div>
        `;

        const pages: Record<string, string> = {
            status: getStatusPage(),
            models: getModelsPage(),
            settings: getSettingsPage()
        };

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Subvert AI</title>
    <style>
        * { box-sizing: border-box; }
        
        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background: var(--vscode-sideBar-background);
            margin: 0;
            padding: 0;
            line-height: 1.4;
        }
        
        /* Top icon navigation */
        .top-nav {
            display: flex;
            border-bottom: 1px solid var(--vscode-panel-border);
            background: var(--vscode-editor-background);
        }
        
        .nav-btn {
            flex: 1;
            padding: 10px 4px;
            border: none;
            background: transparent;
            color: var(--vscode-foreground);
            cursor: pointer;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 4px;
            font-size: 10px;
            opacity: 0.6;
            transition: all 0.2s;
        }
        
        .nav-btn:hover { opacity: 0.9; background: var(--vscode-list-hoverBackground); }
        .nav-btn.active { 
            opacity: 1; 
            color: var(--vscode-textLink-foreground);
            border-bottom: 2px solid var(--vscode-textLink-foreground);
            margin-bottom: -1px;
        }
        
        .nav-btn svg { opacity: 0.8; }
        
        /* Content area */
        .content {
            padding: 12px;
        }
        
        /* Empty states */
        .empty-state {
            text-align: center;
            padding: 32px 16px;
        }
        
        .empty-icon { font-size: 32px; margin-bottom: 8px; }
        .empty-title { font-weight: 600; margin-bottom: 4px; }
        .empty-desc { 
            font-size: 12px; 
            color: var(--vscode-descriptionForeground);
            margin-bottom: 16px;
        }
        
        .spinner {
            width: 40px;
            height: 40px;
            border: 3px solid var(--vscode-panel-border);
            border-top-color: var(--vscode-textLink-foreground);
            border-radius: 50%;
            animation: spin 1s linear infinite;
            margin: 0 auto 16px;
        }
        
        @keyframes spin {
            to { transform: rotate(360deg); }
        }
        
        .settings-hint {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            text-align: center;
            margin-top: 8px;
            font-style: italic;
        }
        
        /* Status grid */
        .status-grid { display: flex; flex-direction: column; gap: 12px; }
        
        .status-card {
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 6px;
            padding: 16px;
            text-align: center;
        }
        
        .status-card.success {
            border-color: var(--vscode-testing-iconPassed);
        }
        
        .status-icon { font-size: 24px; margin-bottom: 4px; }
        .status-label { font-size: 12px; color: var(--vscode-descriptionForeground); }
        .status-value { font-weight: 600; }
        
        /* Action buttons */
        .action-buttons {
            display: flex;
            gap: 8px;
        }
        
        /* Buttons */
        button {
            padding: 6px 12px;
            border: 1px solid var(--vscode-button-secondaryBackground);
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            cursor: pointer;
            border-radius: 4px;
            font-size: 12px;
            display: inline-flex;
            align-items: center;
            gap: 6px;
            transition: all 0.2s;
        }
        
        button:hover:not(:disabled) {
            background: var(--vscode-button-secondaryHoverBackground);
        }
        
        button:disabled {
            opacity: 0.4;
            cursor: not-allowed;
        }
        
        button.btn-primary {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border-color: var(--vscode-button-background);
            width: 100%;
            justify-content: center;
        }
        
        button.btn-primary:hover {
            background: var(--vscode-button-hoverBackground);
        }
        
        button.btn-secondary {
            flex: 1;
            justify-content: center;
        }
        
        /* Models list compact */
        .models-list-compact {
            display: flex;
            flex-direction: column;
            gap: 2px;
        }
        
        .model-row {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 8px 10px;
            background: var(--vscode-editor-background);
            border-radius: 4px;
        }
        
        .model-dot {
            width: 6px;
            height: 6px;
            border-radius: 50%;
            background: var(--vscode-testing-iconPassed);
            flex-shrink: 0;
        }
        
        .model-name-compact {
            font-size: 12px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        
        /* Settings form */
        .settings-form {
            display: flex;
            flex-direction: column;
            gap: 12px;
        }
        
        .form-group {
            display: flex;
            flex-direction: column;
            gap: 4px;
        }
        
        .form-group label {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        
        .form-group input {
            padding: 6px 8px;
            border: 1px solid var(--vscode-input-border);
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border-radius: 4px;
            font-size: 12px;
        }
        
        .form-group input:disabled {
            opacity: 0.5;
        }
        
        /* Model count badge */
        .model-badge {
            position: absolute;
            top: 4px;
            right: 4px;
            background: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            font-size: 9px;
            padding: 1px 4px;
            border-radius: 8px;
            min-width: 14px;
            text-align: center;
        }
        
        .nav-btn { position: relative; }
    </style>
</head>
<body>
    <div class="top-nav">
        <button class="nav-btn ${currentPage === 'status' ? 'active' : ''}" onclick="switchPage('status')">
            ${icons.status}
            Status
        </button>
        <button class="nav-btn ${currentPage === 'models' ? 'active' : ''}" onclick="switchPage('models')">
            ${icons.models}
            Models
            ${isRunning && models.length > 0 ? `<span class="model-badge">${models.length}</span>` : ''}
        </button>
        <button class="nav-btn ${currentPage === 'settings' ? 'active' : ''}" onclick="switchPage('settings')">
            ${icons.settings}
            Settings
        </button>
    </div>
    
    <div class="content">
        ${pages[currentPage] || pages.status}
    </div>
    
    <script>
        const vscode = acquireVsCodeApi();
        
        function switchPage(page) {
            vscode.postMessage({ command: 'switchPage', page });
        }
        
        function startServer() {
            vscode.postMessage({ command: 'startServer' });
        }
        
        function stopServer() {
            vscode.postMessage({ command: 'stopServer' });
        }
        
        function openFullDashboard() {
            vscode.postMessage({ command: 'openFullDashboard' });
        }
        
        function install() {
            vscode.postMessage({ command: 'install' });
        }
        
        function saveSettings() {
            const port = document.getElementById('port')?.value;
            const url = document.getElementById('url')?.value;
            const key = document.getElementById('key')?.value;
            vscode.postMessage({ 
                command: 'saveSettings', 
                settings: { port, ollama_cloud_url: url, ollama_cloud_key: key }
            });
        }
    </script>
</body>
</html>`;
    }
}
