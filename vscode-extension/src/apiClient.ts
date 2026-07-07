import * as vscode from 'vscode';
import * as http from 'http';

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

interface KeyEntry {
    name: string;
    key: string;
}

interface KeysResponse {
    multi_mode: boolean;
    active_index: number;
    keys: KeyEntry[];
}

interface LocalSettingsResponse {
    local_ollama_url: string;
    local_ollama_port: number;
    local_ollama_enabled: boolean;
    local_tool_mode: string;
}

interface LocalTestConnectionResponse {
    success: boolean;
    error?: string;
    model_count?: number;
    models?: Array<{
        id: string;
        name: string;
        owned_by: string;
        vision: boolean;
        toolCalling: boolean;
        maxInputTokens: number;
        maxOutputTokens: number;
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

export class ApiClient {
    private outputChannel: vscode.OutputChannel;
    private baseUrl: string;

    constructor(outputChannel: vscode.OutputChannel) {
        this.outputChannel = outputChannel;

        const config = vscode.workspace.getConfiguration('subvertAI');
        const port = config.get<number>('serverPort', 11435);
        this.baseUrl = `http://localhost:${port}`;
    }

    private async request<T>(
        path: string,
        method: 'GET' | 'POST' | 'DELETE' = 'GET',
        body?: object
    ): Promise<T> {
        return new Promise((resolve, reject) => {
            const postData = body ? JSON.stringify(body) : undefined;

            const options: http.RequestOptions = {
                hostname: 'localhost',
                port: this.getPort(),
                path: path,
                method: method,
                headers: {
                    'Content-Type': 'application/json',
                },
                timeout: 10000,
            };

            if (postData) {
                (options.headers as Record<string, string | number>)['Content-Length'] = Buffer.byteLength(postData);
            }

            const req = http.request(options, (res) => {
                let data = '';

                res.on('data', (chunk) => {
                    data += chunk;
                });

                res.on('end', () => {
                    try {
                        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                            resolve(JSON.parse(data) as T);
                        } else {
                            reject(new Error(`HTTP ${res.statusCode}: ${data}`));
                        }
                    } catch (error) {
                        reject(new Error(`Failed to parse response: ${error instanceof Error ? error.message : String(error)}`));
                    }
                });
            });

            req.on('error', (error) => {
                reject(error);
            });

            req.on('timeout', () => {
                req.destroy();
                reject(new Error('Request timeout'));
            });

            if (postData) {
                req.write(postData);
            }

            req.end();
        });
    }

    private getPort(): number {
        const config = vscode.workspace.getConfiguration('subvertAI');
        return config.get<number>('serverPort', 11435);
    }

    async getSettings(): Promise<SettingsResponse> {
        return this.request<SettingsResponse>('/ui/settings');
    }

    async saveSettings(settings: Partial<SettingsResponse>): Promise<{ message: string; ok: boolean }> {
        return this.request<{ message: string; ok: boolean }>('/ui/settings', 'POST', settings);
    }

    async testConnection(url?: string, key?: string): Promise<TestConnectionResponse> {
        const body: Record<string, string> = {};
        if (url) body.ollama_cloud_url = url;
        if (key) body.ollama_cloud_key = key;

        return this.request<TestConnectionResponse>('/ui/test-connection', 'POST', body);
    }

    async getVSCodeConfig(): Promise<VSCodeConfigResponse> {
        return this.request<VSCodeConfigResponse>('/ui/vscode-config');
    }

    async getKeys(): Promise<KeysResponse> {
        return this.request<KeysResponse>('/ui/keys');
    }

    async addKey(name: string, key: string): Promise<{ ok: boolean; index: number; total: number }> {
        return this.request('/ui/keys', 'POST', { name, key });
    }

    async deleteKey(index: number): Promise<{ ok: boolean; active_index: number; total: number }> {
        return this.request(`/ui/keys/${index}`, 'DELETE');
    }

    async activateKey(index: number): Promise<{ ok: boolean; active_index: number; active_name: string }> {
        return this.request(`/ui/keys/${index}/activate`, 'POST');
    }

    async healthCheck(): Promise<{ status: string; service: string }> {
        return this.request<{ status: string; service: string }>('/health');
    }

    async getLocalSettings(): Promise<LocalSettingsResponse> {
        return this.request<LocalSettingsResponse>('/ui/local-settings');
    }

    async saveLocalSettings(settings: Partial<LocalSettingsResponse>): Promise<{ message: string; ok: boolean }> {
        return this.request<{ message: string; ok: boolean }>('/ui/local-settings', 'POST', settings);
    }

    async testLocalConnection(url?: string): Promise<LocalTestConnectionResponse> {
        const body: Record<string, string> = {};
        if (url) body.local_ollama_url = url;
        return this.request<LocalTestConnectionResponse>('/ui/test-local-connection', 'POST', body);
    }

    async getLocalVSCodeConfig(): Promise<VSCodeConfigResponse> {
        return this.request<VSCodeConfigResponse>('/ui/local-vscode-config');
    }
}
