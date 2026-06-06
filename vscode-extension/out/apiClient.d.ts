import * as vscode from 'vscode';
interface SettingsResponse {
    ollama_cloud_url: string;
    ollama_cloud_key: string;
    port: number;
    host: string;
}
interface TestConnectionResponse {
    success: boolean;
    error?: string;
    model_count?: number;
    models?: Array<{
        id: string;
        name: string;
        owned_by: string;
    }>;
}
interface VSCodeConfigResponse {
    name: string;
    vendor: string;
    apiKey: string;
    apiType: string;
    models: Array<{
        id: string;
        name: string;
        url: string;
        toolCalling: boolean;
        vision: boolean;
        maxInputTokens: number;
        maxOutputTokens: number;
    }>;
}
export declare class ApiClient {
    private outputChannel;
    private baseUrl;
    constructor(outputChannel: vscode.OutputChannel);
    private request;
    private getPort;
    getSettings(): Promise<SettingsResponse>;
    saveSettings(settings: Partial<SettingsResponse>): Promise<{
        message: string;
        ok: boolean;
    }>;
    testConnection(url?: string, key?: string): Promise<TestConnectionResponse>;
    getVSCodeConfig(): Promise<VSCodeConfigResponse>;
    healthCheck(): Promise<{
        status: string;
        service: string;
    }>;
}
export {};
//# sourceMappingURL=apiClient.d.ts.map