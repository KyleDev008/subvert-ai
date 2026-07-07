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
exports.ApiClient = void 0;
const vscode = __importStar(require("vscode"));
const http = __importStar(require("http"));
class ApiClient {
    constructor(outputChannel) {
        this.outputChannel = outputChannel;
        const config = vscode.workspace.getConfiguration('subvertAI');
        const port = config.get('serverPort', 11435);
        this.baseUrl = `http://localhost:${port}`;
    }
    async request(path, method = 'GET', body) {
        return new Promise((resolve, reject) => {
            const postData = body ? JSON.stringify(body) : undefined;
            const options = {
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
                options.headers['Content-Length'] = Buffer.byteLength(postData);
            }
            const req = http.request(options, (res) => {
                let data = '';
                res.on('data', (chunk) => {
                    data += chunk;
                });
                res.on('end', () => {
                    try {
                        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                            resolve(JSON.parse(data));
                        }
                        else {
                            reject(new Error(`HTTP ${res.statusCode}: ${data}`));
                        }
                    }
                    catch (error) {
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
    getPort() {
        const config = vscode.workspace.getConfiguration('subvertAI');
        return config.get('serverPort', 11435);
    }
    async getSettings() {
        return this.request('/ui/settings');
    }
    async saveSettings(settings) {
        return this.request('/ui/settings', 'POST', settings);
    }
    async testConnection(url, key) {
        const body = {};
        if (url)
            body.ollama_cloud_url = url;
        if (key)
            body.ollama_cloud_key = key;
        return this.request('/ui/test-connection', 'POST', body);
    }
    async getVSCodeConfig() {
        return this.request('/ui/vscode-config');
    }
    async getKeys() {
        return this.request('/ui/keys');
    }
    async addKey(name, key) {
        return this.request('/ui/keys', 'POST', { name, key });
    }
    async deleteKey(index) {
        return this.request(`/ui/keys/${index}`, 'DELETE');
    }
    async activateKey(index) {
        return this.request(`/ui/keys/${index}/activate`, 'POST');
    }
    async healthCheck() {
        return this.request('/health');
    }
    async getLocalSettings() {
        return this.request('/ui/local-settings');
    }
    async saveLocalSettings(settings) {
        return this.request('/ui/local-settings', 'POST', settings);
    }
    async testLocalConnection(url) {
        const body = {};
        if (url)
            body.local_ollama_url = url;
        return this.request('/ui/test-local-connection', 'POST', body);
    }
    async getLocalVSCodeConfig() {
        return this.request('/ui/local-vscode-config');
    }
}
exports.ApiClient = ApiClient;
//# sourceMappingURL=apiClient.js.map