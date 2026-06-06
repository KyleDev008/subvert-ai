import * as vscode from 'vscode';
export declare class ServerManager {
    private serverProcess;
    private outputChannel;
    private context;
    private serverPort;
    constructor(outputChannel: vscode.OutputChannel, context: vscode.ExtensionContext);
    getServerPort(): number;
    getServerPath(): string;
    getPythonPath(): string;
    isServerInstalled(): Promise<boolean>;
    isServerRunning(): Promise<boolean>;
    startServer(): Promise<void>;
    stopServer(): Promise<void>;
    private killOrphanedProcesses;
    dispose(): void;
}
//# sourceMappingURL=serverManager.d.ts.map