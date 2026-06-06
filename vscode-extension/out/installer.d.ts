import * as vscode from 'vscode';
export declare class Installer {
    private outputChannel;
    private context;
    constructor(outputChannel: vscode.OutputChannel, context: vscode.ExtensionContext);
    private getServerPath;
    checkPrerequisites(): Promise<{
        pythonPath: string;
        version: string;
    }>;
    setupEnvironment(): Promise<void>;
    installDependencies(): Promise<void>;
    copyServerFiles(): Promise<void>;
    private copyDirectory;
}
//# sourceMappingURL=installer.d.ts.map