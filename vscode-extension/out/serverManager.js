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
exports.ServerManager = void 0;
const vscode = __importStar(require("vscode"));
const child_process = __importStar(require("child_process"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const http = __importStar(require("http"));
class ServerManager {
    constructor(outputChannel, context) {
        this.serverProcess = null;
        this.serverPort = 11435;
        this.outputChannel = outputChannel;
        this.context = context;
        const config = vscode.workspace.getConfiguration('subvertAI');
        this.serverPort = config.get('serverPort', 11435);
    }
    getServerPort() {
        return this.serverPort;
    }
    getServerPath() {
        // The server is installed in the extension's global storage
        return path.join(this.context.globalStorageUri.fsPath, 'server');
    }
    getPythonPath() {
        const serverPath = this.getServerPath();
        const venvPath = path.join(serverPath, '.venv');
        if (process.platform === 'win32') {
            return path.join(venvPath, 'Scripts', 'python.exe');
        }
        else {
            return path.join(venvPath, 'bin', 'python');
        }
    }
    async isServerInstalled() {
        const pythonPath = this.getPythonPath();
        const mainPath = path.join(this.getServerPath(), 'main.py');
        return fs.existsSync(pythonPath) && fs.existsSync(mainPath);
    }
    async isServerRunning() {
        return new Promise((resolve) => {
            const req = http.get(`http://localhost:${this.serverPort}/health`, (res) => {
                resolve(res.statusCode === 200);
            });
            req.on('error', () => resolve(false));
            req.setTimeout(2000, () => {
                req.destroy();
                resolve(false);
            });
        });
    }
    async startServer() {
        // Check if already running
        const isRunning = await this.isServerRunning();
        if (isRunning) {
            this.outputChannel.appendLine('Server is already running');
            return;
        }
        // Check if installed
        const isInstalled = await this.isServerInstalled();
        if (!isInstalled) {
            throw new Error('Subvert AI server is not installed. Run "Subvert AI: Install / Repair" first.');
        }
        const pythonPath = this.getPythonPath();
        const serverPath = this.getServerPath();
        const mainPath = path.join(serverPath, 'main.py');
        this.outputChannel.appendLine(`Starting server with Python: ${pythonPath}`);
        this.outputChannel.appendLine(`Server path: ${serverPath}`);
        this.outputChannel.show();
        return new Promise((resolve, reject) => {
            const env = {
                ...process.env,
                PYTHONUNBUFFERED: '1',
            };
            // Load settings from VS Code config
            const config = vscode.workspace.getConfiguration('subvertAI');
            const ollamaUrl = config.get('ollamaCloudUrl');
            const ollamaKey = config.get('ollamaCloudKey');
            if (ollamaUrl) {
                env.OLLAMA_CLOUD_URL = ollamaUrl;
            }
            if (ollamaKey) {
                env.OLLAMA_CLOUD_KEY = ollamaKey;
            }
            this.serverProcess = child_process.spawn(pythonPath, ['-m', 'uvicorn', 'main:app', '--host', '0.0.0.0', '--port', this.serverPort.toString()], {
                cwd: serverPath,
                env,
                detached: false,
            });
            let hasStarted = false;
            let startupTimeout;
            this.serverProcess.stdout?.on('data', (data) => {
                const message = data.toString();
                this.outputChannel.append(message);
                // Check for successful startup indicators
                if (message.includes('Application startup complete') ||
                    message.includes('Uvicorn running') ||
                    message.includes('proxy starting')) {
                    hasStarted = true;
                    clearTimeout(startupTimeout);
                    resolve();
                }
            });
            this.serverProcess.stderr?.on('data', (data) => {
                this.outputChannel.append(data.toString());
            });
            this.serverProcess.on('error', (error) => {
                this.outputChannel.appendLine(`Server process error: ${error.message}`);
                if (!hasStarted) {
                    clearTimeout(startupTimeout);
                    reject(error);
                }
            });
            this.serverProcess.on('exit', (code) => {
                this.outputChannel.appendLine(`Server process exited with code ${code}`);
                this.serverProcess = null;
                if (!hasStarted) {
                    clearTimeout(startupTimeout);
                    reject(new Error(`Server exited unexpectedly with code ${code}`));
                }
            });
            // Set a timeout for startup
            startupTimeout = setTimeout(() => {
                if (!hasStarted) {
                    // Check if it's actually running despite no stdout message
                    this.isServerRunning().then(running => {
                        if (running) {
                            hasStarted = true;
                            resolve();
                        }
                        else {
                            reject(new Error('Server startup timed out'));
                        }
                    });
                }
            }, 15000);
        });
    }
    async stopServer() {
        if (this.serverProcess) {
            this.outputChannel.appendLine('Stopping server process...');
            // Kill the process
            if (process.platform === 'win32') {
                child_process.spawn('taskkill', ['/pid', this.serverProcess.pid?.toString() || '', '/f', '/t']);
            }
            else {
                this.serverProcess.kill('SIGTERM');
            }
            this.serverProcess = null;
        }
        else {
            // Try to find and kill any orphaned server processes
            await this.killOrphanedProcesses();
        }
        // Wait a moment and verify
        await new Promise(resolve => setTimeout(resolve, 1000));
        const isRunning = await this.isServerRunning();
        if (isRunning) {
            throw new Error('Server is still running after stop command');
        }
    }
    async killOrphanedProcesses() {
        return new Promise((resolve) => {
            if (process.platform === 'win32') {
                // On Windows, use PowerShell to find and kill processes on the port
                const ps = child_process.spawn('powershell.exe', [
                    '-Command',
                    `Get-NetTCPConnection -LocalPort ${this.serverPort} -ErrorAction SilentlyContinue | ` +
                        `Select-Object -ExpandProperty OwningProcess | ` +
                        `ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }`
                ]);
                ps.on('close', resolve);
            }
            else {
                // On Unix, use lsof or fuser
                const cmd = child_process.spawn('sh', ['-c',
                    `lsof -ti:${this.serverPort} | xargs kill -9 2>/dev/null || true`
                ]);
                cmd.on('close', resolve);
            }
        });
    }
    dispose() {
        if (this.serverProcess) {
            this.stopServer().catch(() => {
                // Ignore errors during dispose
            });
        }
    }
}
exports.ServerManager = ServerManager;
//# sourceMappingURL=serverManager.js.map