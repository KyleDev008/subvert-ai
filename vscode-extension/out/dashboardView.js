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
exports.DashboardViewProvider = void 0;
const vscode = __importStar(require("vscode"));
class DashboardViewProvider {
    constructor(extensionUri, serverManager, apiClient, outputChannel) {
        this.currentPage = 'status';
        this.isStarting = false;
        this.isInstalling = false;
        this.isUpdating = false;
        this.localSettings = null;
        this.localModels = [];
        this._extensionUri = extensionUri;
        this.serverManager = serverManager;
        this.apiClient = apiClient;
        this.outputChannel = outputChannel;
    }
    resolveWebviewView(webviewView, context, _token) {
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
                    }
                    finally {
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
                    this.isInstalling = true;
                    this.updateContent();
                    try {
                        await vscode.commands.executeCommand('subvertAI.install');
                    }
                    finally {
                        this.isInstalling = false;
                        this.updateContent();
                    }
                    break;
                case 'switchPage':
                    this.currentPage = message.page;
                    this.updateContent();
                    break;
                case 'saveSettings':
                    await this.saveSettings(message.settings);
                    break;
                case 'activateKey':
                    await this.activateKey(message.index);
                    break;
                case 'saveLocalSettings':
                    await this.saveLocalSettings(message.settings);
                    break;
                case 'exportLocalConfig':
                    await vscode.commands.executeCommand('subvertAI.exportLocalVSCodeConfig');
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
    async updateContent() {
        if (!this._view || this.isUpdating) {
            return;
        }
        this.isUpdating = true;
        try {
            const isInstalled = await this.serverManager.isServerInstalled();
            const isRunning = await this.serverManager.isServerRunning();
            const port = this.serverManager.getServerPort();
            let statusInfo = '';
            let models = [];
            let keysData = { multi_mode: false, active_index: 0, keys: [] };
            if (isRunning) {
                try {
                    keysData = await this.apiClient.getKeys();
                }
                catch { }
                try {
                    this.localSettings = await this.apiClient.getLocalSettings();
                    if (this.localSettings?.local_ollama_enabled) {
                        const localResult = await this.apiClient.testLocalConnection();
                        this.localModels = localResult.success ? (localResult.models || []) : [];
                    }
                }
                catch { }
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
                }
                catch (error) {
                    statusInfo = `
                        <div class="info-box warning">
                            <strong>Server Status:</strong> Running but API error<br>
                            ${error instanceof Error ? error.message : String(error)}
                        </div>
                    `;
                }
            }
            else if (isInstalled) {
                statusInfo = `
                    <div class="info-box warning">
                        <strong>Server Status:</strong> Installed but not running
                    </div>
                `;
            }
            else {
                statusInfo = `
                    <div class="info-box error">
                        <strong>Server Status:</strong> Not installed
                    </div>
                `;
            }
            const html = this.getSidebarHtml(isInstalled, isRunning, port, models, keysData, this.localModels, this.localSettings);
            this._view.webview.html = html;
            vscode.commands.executeCommand('setContext', 'subvertAI.serverRunning', isRunning);
        }
        finally {
            this.isUpdating = false;
        }
    }
    async saveLocalSettings(settings) {
        try {
            await this.apiClient.saveLocalSettings(settings);
            vscode.window.showInformationMessage('Local Ollama settings saved');
            this.updateContent();
        }
        catch (error) {
            vscode.window.showErrorMessage(`Failed to save local settings: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    async saveSettings(settings) {
        try {
            await this.apiClient.saveSettings(settings);
            vscode.window.showInformationMessage('Settings saved successfully');
        }
        catch (error) {
            vscode.window.showErrorMessage(`Failed to save settings: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    async activateKey(index) {
        try {
            await this.apiClient.activateKey(index);
            this.updateContent();
        }
        catch (error) {
            vscode.window.showErrorMessage(`Failed to switch key: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    getSidebarHtml(isInstalled, isRunning, port, models, keysData, localModels = [], localSettings = null) {
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
            if (this.isInstalling) {
                return `
                    <div class="empty-state">
                        <div class="spinner"></div>
                        <div class="empty-title">Installing...</div>
                        <div class="empty-desc">Setting up Python environment and dependencies</div>
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
            const sortedCloud = [...models].sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
            const sortedLocal = [...localModels].sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
            if (sortedCloud.length === 0 && sortedLocal.length === 0) {
                return `<div class="empty-state"><div class="empty-desc">No models detected</div></div>`;
            }
            const cloudSection = sortedCloud.length > 0 ? `
                <div class="section-label" style="margin-bottom:6px">Cloud</div>
                <div class="models-list-compact" style="margin-bottom:12px">
                    ${sortedCloud.map(m => `
                        <div class="model-row">
                            <span class="model-dot"></span>
                            <span class="model-name-compact" title="${m.id}">${m.name || m.id}</span>
                        </div>
                    `).join('')}
                </div>
            ` : '';
            const localSection = sortedLocal.length > 0 ? `
                <div class="section-label" style="margin-bottom:6px">Local</div>
                <div class="models-list-compact">
                    ${sortedLocal.map(m => `
                        <div class="model-row">
                            <span class="model-dot model-dot-local"></span>
                            <span class="model-name-compact" title="${m.id}">${m.name || m.id}</span>
                        </div>
                    `).join('')}
                </div>
            ` : '';
            return cloudSection + localSection;
        };
        const getSettingsPage = () => {
            const multiSection = keysData.multi_mode && keysData.keys.length > 0 ? `
                <div class="section-label">Active Account</div>
                <div class="keys-list">
                    ${keysData.keys.map((k, i) => `
                        <div class="key-row ${i === keysData.active_index ? 'key-active' : ''}" onclick="activateKey(${i})">
                            <span class="key-dot"></span>
                            <span class="key-name">${k.name}</span>
                            ${i === keysData.active_index ? '<span class="key-badge">Active</span>' : ''}
                        </div>
                    `).join('')}
                </div>
                <div class="settings-hint">Click an account to switch. Manage accounts in the full dashboard.</div>
            ` : (keysData.multi_mode ? `<div class="settings-hint">No accounts configured. Use the full dashboard to add accounts.</div>` : '');
            const localEnabled = localSettings?.local_ollama_enabled ?? false;
            const localUrl = localSettings?.local_ollama_url ?? 'http://localhost:11434';
            const localPort = localSettings?.local_ollama_port ?? 11436;
            const localToolMode = localSettings?.local_tool_mode ?? 'ask';
            return `
            <div class="settings-form">
                <div class="form-group">
                    <label>Port</label>
                    <input type="number" id="port" value="${port}">
                </div>
                <div class="form-group">
                    <label>Ollama URL</label>
                    <input type="text" id="url" placeholder="https://ollama.com">
                </div>
                ${!keysData.multi_mode ? `
                <div class="form-group">
                    <label>API Key</label>
                    <input type="password" id="key" placeholder="••••••••">
                </div>` : ''}
                ${multiSection}
                <button class="btn-primary" onclick="saveSettings()">
                    Save
                </button>
                <div class="section-divider"></div>
                <div class="section-label" style="margin-bottom:8px">Local Ollama</div>
                <div class="local-toggle-row">
                    <span class="local-toggle-label">Enable local proxy (port ${localPort})</span>
                    <button class="toggle-btn ${localEnabled ? 'toggle-on' : ''}" onclick="toggleLocal()" id="localToggle">
                        <span class="toggle-thumb"></span>
                    </button>
                </div>
                <div class="form-group">
                    <label>Local Ollama URL</label>
                    <input type="text" id="localUrl" value="${localUrl}" placeholder="http://localhost:11434">
                </div>
                <div class="form-group">
                    <label>Local Proxy Port</label>
                    <input type="number" id="localPort" value="${localPort}" placeholder="11436">
                </div>
                <div class="form-group">
                    <label>Local Tool Mode</label>
                    <select id="localToolMode">
                        <option value="ask" ${localToolMode === 'ask' ? 'selected' : ''}>Ask (no tools)</option>
                        <option value="plan" ${localToolMode === 'plan' ? 'selected' : ''}>Plan (read-only tools)</option>
                        <option value="agent" ${localToolMode === 'agent' ? 'selected' : ''}>Agent (all tools)</option>
                    </select>
                </div>
                <button class="btn-primary" onclick="saveLocalSettings()">
                    Save Local
                </button>
                ${localEnabled && isRunning ? `
                <button class="btn-secondary" style="width:100%;justify-content:center;margin-top:4px" onclick="exportLocalConfig()">
                    Export Local VS Code Config
                </button>` : ''}
                <div class="settings-hint">
                    Changes will take effect on next server start
                </div>
            </div>
        `;
        };
        const pages = {
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
        
        .form-group input,
        .form-group select {
            padding: 6px 8px;
            border: 1px solid var(--vscode-input-border);
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border-radius: 4px;
            font-size: 12px;
        }
        
        .form-group input:disabled,
        .form-group select:disabled {
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

        /* Key switcher */
        .section-label {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        .keys-list {
            display: flex;
            flex-direction: column;
            gap: 4px;
        }

        .key-row {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 7px 10px;
            border-radius: 4px;
            background: var(--vscode-editor-background);
            cursor: pointer;
            font-size: 12px;
            border: 1px solid transparent;
        }

        .key-row:hover { border-color: var(--vscode-focusBorder); }

        .key-row.key-active {
            border-color: var(--vscode-textLink-foreground);
        }

        .key-dot {
            width: 6px;
            height: 6px;
            border-radius: 50%;
            background: var(--vscode-descriptionForeground);
            flex-shrink: 0;
        }

        .key-active .key-dot {
            background: var(--vscode-testing-iconPassed);
        }

        .key-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

        .key-badge {
            font-size: 10px;
            color: var(--vscode-textLink-foreground);
            font-weight: 600;
        }

        .model-dot-local {
            background: var(--vscode-textLink-foreground);
        }

        .section-divider {
            height: 1px;
            background: var(--vscode-panel-border);
            margin: 4px 0;
        }

        .local-toggle-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 8px;
        }

        .local-toggle-label {
            font-size: 12px;
            color: var(--vscode-foreground);
        }

        .toggle-btn {
            width: 32px;
            height: 18px;
            border-radius: 9px;
            background: var(--vscode-button-secondaryBackground);
            border: 1px solid var(--vscode-panel-border);
            padding: 0;
            position: relative;
            cursor: pointer;
            transition: background 0.2s;
            flex-shrink: 0;
        }

        .toggle-btn.toggle-on {
            background: var(--vscode-textLink-foreground);
        }

        .toggle-thumb {
            position: absolute;
            top: 2px;
            left: 2px;
            width: 12px;
            height: 12px;
            border-radius: 50%;
            background: white;
            transition: transform 0.2s;
        }

        .toggle-btn.toggle-on .toggle-thumb {
            transform: translateX(14px);
        }
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
            ${isRunning && (models.length + localModels.length) > 0 ? `<span class="model-badge">${models.length + localModels.length}</span>` : ''}
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

        function activateKey(index) {
            vscode.postMessage({ command: 'activateKey', index });
        }

        let _localEnabled = document.getElementById('localToggle')?.classList.contains('toggle-on') ?? false;

        function toggleLocal() {
            const btn = document.getElementById('localToggle');
            _localEnabled = !_localEnabled;
            if (_localEnabled) { btn.classList.add('toggle-on'); } else { btn.classList.remove('toggle-on'); }
        }

        function saveLocalSettings() {
            const localUrl = document.getElementById('localUrl')?.value;
            const localPort = document.getElementById('localPort')?.value;
            const localToolMode = document.getElementById('localToolMode')?.value;
            vscode.postMessage({
                command: 'saveLocalSettings',
                settings: { local_ollama_url: localUrl, local_ollama_port: parseInt(localPort) || 11436, local_ollama_enabled: _localEnabled, local_tool_mode: localToolMode || 'ask' }
            });
        }

        function exportLocalConfig() {
            vscode.postMessage({ command: 'exportLocalConfig' });
        }
    </script>
</body>
</html>`;
    }
}
exports.DashboardViewProvider = DashboardViewProvider;
DashboardViewProvider.viewType = 'subvertAIDashboard';
//# sourceMappingURL=dashboardView.js.map