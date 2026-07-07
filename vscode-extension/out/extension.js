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
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const serverManager_1 = require("./serverManager");
const dashboardView_1 = require("./dashboardView");
const installer_1 = require("./installer");
const apiClient_1 = require("./apiClient");
let serverManager;
let dashboardProvider;
let outputChannel;
function activate(context) {
    outputChannel = vscode.window.createOutputChannel('Subvert AI');
    outputChannel.appendLine('Subvert AI extension activated');
    const config = vscode.workspace.getConfiguration('subvertAI');
    // Initialize components
    serverManager = new serverManager_1.ServerManager(outputChannel, context);
    const apiClient = new apiClient_1.ApiClient(outputChannel);
    dashboardProvider = new dashboardView_1.DashboardViewProvider(context.extensionUri, serverManager, apiClient, outputChannel);
    const installer = new installer_1.Installer(outputChannel, context);
    // Register the dashboard webview provider
    context.subscriptions.push(vscode.window.registerWebviewViewProvider(dashboardView_1.DashboardViewProvider.viewType, dashboardProvider, { webviewOptions: { retainContextWhenHidden: true } }));
    // Register commands
    const commands = [
        vscode.commands.registerCommand('subvertAI.startServer', async () => {
            try {
                await serverManager.startServer();
                vscode.window.showInformationMessage('Subvert AI server started successfully');
                dashboardProvider.updateContent();
            }
            catch (error) {
                const errorMsg = error instanceof Error ? error.message : String(error);
                outputChannel.appendLine(`Failed to start server: ${errorMsg}`);
                // Check if it's an installation issue
                if (errorMsg.includes('not found') || errorMsg.includes('not installed')) {
                    const installAction = 'Install Now';
                    const result = await vscode.window.showErrorMessage('Subvert AI server is not installed. Would you like to install it?', installAction);
                    if (result === installAction) {
                        vscode.commands.executeCommand('subvertAI.install');
                    }
                }
                else {
                    vscode.window.showErrorMessage(`Failed to start server: ${errorMsg}`);
                }
            }
        }),
        vscode.commands.registerCommand('subvertAI.stopServer', async () => {
            try {
                await serverManager.stopServer();
                vscode.window.showInformationMessage('Subvert AI server stopped');
                dashboardProvider.updateContent();
            }
            catch (error) {
                vscode.window.showErrorMessage(`Failed to stop server: ${error instanceof Error ? error.message : String(error)}`);
            }
        }),
        vscode.commands.registerCommand('subvertAI.openDashboard', async () => {
            const isRunning = await serverManager.isServerRunning();
            if (!isRunning) {
                const startAction = 'Start Server';
                const result = await vscode.window.showWarningMessage('Server is not running. Start it first?', startAction);
                if (result === startAction) {
                    await vscode.commands.executeCommand('subvertAI.startServer');
                }
                return;
            }
            // Open the dashboard in a full webview panel
            const panel = vscode.window.createWebviewPanel('subvertAIDashboardFull', 'Subvert AI Dashboard', vscode.ViewColumn.One, {
                enableScripts: true,
                retainContextWhenHidden: true
            });
            const port = serverManager.getServerPort();
            panel.webview.html = `
                <!DOCTYPE html>
                <html style="height: 100%; margin: 0; padding: 0;">
                <head>
                    <meta charset="UTF-8">
                    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; frame-src http://localhost:${port} http://127.0.0.1:${port}; style-src 'unsafe-inline';">
                </head>
                <body style="height: 100%; margin: 0; padding: 0; overflow: hidden;">
                    <iframe 
                        src="http://localhost:${port}" 
                        style="width: 100%; height: 100%; border: none;"
                        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                    ></iframe>
                </body>
                </html>
            `;
        }),
        vscode.commands.registerCommand('subvertAI.install', async () => {
            try {
                await vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: 'Installing Subvert AI...',
                    cancellable: false
                }, async (progress) => {
                    progress.report({ increment: 0, message: 'Checking Python...' });
                    await installer.checkPrerequisites();
                    progress.report({ increment: 30, message: 'Setting up environment...' });
                    await installer.setupEnvironment();
                    progress.report({ increment: 40, message: 'Installing dependencies...' });
                    await installer.installDependencies();
                    progress.report({ increment: 20, message: 'Copying server files...' });
                    await installer.copyServerFiles();
                    progress.report({ increment: 10, message: 'Complete!' });
                });
                vscode.window.showInformationMessage('Subvert AI installed successfully! You can now start the server.');
            }
            catch (error) {
                vscode.window.showErrorMessage(`Installation failed: ${error instanceof Error ? error.message : String(error)}`);
            }
        }),
        vscode.commands.registerCommand('subvertAI.testConnection', async () => {
            try {
                const isRunning = await serverManager.isServerRunning();
                if (!isRunning) {
                    vscode.window.showWarningMessage('Server is not running. Start it first.');
                    return;
                }
                const result = await apiClient.testConnection();
                if (result.success) {
                    vscode.window.showInformationMessage(`Connection successful! Found ${result.model_count} models.`);
                }
                else {
                    vscode.window.showErrorMessage(`Connection failed: ${result.error}`);
                }
            }
            catch (error) {
                vscode.window.showErrorMessage(`Test failed: ${error instanceof Error ? error.message : String(error)}`);
            }
        }),
        vscode.commands.registerCommand('subvertAI.exportVSCodeConfig', async () => {
            try {
                const isRunning = await serverManager.isServerRunning();
                if (!isRunning) {
                    vscode.window.showWarningMessage('Server is not running. Start it first.');
                    return;
                }
                const config = await apiClient.getVSCodeConfig();
                // Copy to clipboard
                await vscode.env.clipboard.writeText(JSON.stringify(config, null, 2));
                vscode.window.showInformationMessage('VS Code LM configuration copied to clipboard!');
                // Show the config in a new document
                const doc = await vscode.workspace.openTextDocument({
                    content: JSON.stringify(config, null, 2),
                    language: 'json'
                });
                await vscode.window.showTextDocument(doc);
            }
            catch (error) {
                vscode.window.showErrorMessage(`Export failed: ${error instanceof Error ? error.message : String(error)}`);
            }
        }),
        vscode.commands.registerCommand('subvertAI.exportLocalVSCodeConfig', async () => {
            try {
                const isRunning = await serverManager.isServerRunning();
                if (!isRunning) {
                    vscode.window.showWarningMessage('Server is not running. Start it first.');
                    return;
                }
                const config = await apiClient.getLocalVSCodeConfig();
                // Copy to clipboard
                await vscode.env.clipboard.writeText(JSON.stringify(config, null, 2));
                vscode.window.showInformationMessage('Local Ollama VS Code config copied to clipboard!');
                // Show the config in a new document
                const doc = await vscode.workspace.openTextDocument({
                    content: JSON.stringify(config, null, 2),
                    language: 'json'
                });
                await vscode.window.showTextDocument(doc);
            }
            catch (error) {
                vscode.window.showErrorMessage(`Export failed: ${error instanceof Error ? error.message : String(error)}`);
            }
        }),
        vscode.commands.registerCommand('subvertAI.refreshStatus', () => {
            dashboardProvider.updateContent();
        }),
    ];
    context.subscriptions.push(...commands);
    // Refresh server files whenever the extension version changes (silent update)
    const currentVersion = context.extension.packageJSON.version;
    const lastVersion = context.globalState.get('installedServerVersion');
    if (lastVersion !== currentVersion) {
        installer.copyServerFiles()
            .then(() => {
            context.globalState.update('installedServerVersion', currentVersion);
            outputChannel.appendLine(`Server files updated to v${currentVersion}`);
        })
            .catch((err) => {
            outputChannel.appendLine(`Server file update skipped (not yet installed): ${err}`);
        });
    }
    // Auto-start server if configured
    if (config.get('autoStart', false)) {
        serverManager.startServer().catch(() => {
            // Silent fail for auto-start
        });
    }
    // Update context when server state changes
    const updateServerContext = async () => {
        const isRunning = await serverManager.isServerRunning();
        vscode.commands.executeCommand('setContext', 'subvertAI.serverRunning', isRunning);
    };
    // Initial status check (dashboard has its own polling interval)
    updateServerContext();
}
function deactivate() {
    outputChannel?.appendLine('Subvert AI extension deactivating...');
    serverManager?.dispose();
}
//# sourceMappingURL=extension.js.map