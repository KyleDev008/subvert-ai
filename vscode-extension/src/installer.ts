import * as vscode from 'vscode';
import * as child_process from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as util from 'util';

const execAsync = util.promisify(child_process.exec);

export class Installer {
    private outputChannel: vscode.OutputChannel;
    private context: vscode.ExtensionContext;

    constructor(outputChannel: vscode.OutputChannel, context: vscode.ExtensionContext) {
        this.outputChannel = outputChannel;
        this.context = context;
    }

    private getServerPath(): string {
        return path.join(this.context.globalStorageUri.fsPath, 'server');
    }

    async checkPrerequisites(): Promise<{ pythonPath: string; version: string }> {
        this.outputChannel.appendLine('Checking prerequisites...');

        // Check for Python
        let pythonCommand: string | null = null;

        // Try different Python commands
        const pythonCommands = ['python3', 'python', 'py'];

        for (const cmd of pythonCommands) {
            try {
                const { stdout } = await execAsync(`${cmd} --version`);
                const version = stdout.trim();
                this.outputChannel.appendLine(`Found Python: ${cmd} - ${version}`);

                // Parse version
                const versionMatch = version.match(/Python (\d+)\.(\d+)/);
                if (versionMatch) {
                    const major = parseInt(versionMatch[1]);
                    const minor = parseInt(versionMatch[2]);

                    if (major > 3 || (major === 3 && minor >= 8)) {
                        pythonCommand = cmd;
                        break;
                    } else {
                        this.outputChannel.appendLine(`Python version ${major}.${minor} is too old (need 3.8+)`);
                    }
                }
            } catch {
                // Command not found, try next
            }
        }

        if (!pythonCommand) {
            throw new Error(
                'Python 3.8+ not found. Please install Python from https://python.org and ensure it is in your PATH.'
            );
        }

        // Get full Python path
        const { stdout: pythonPath } = await execAsync(`${pythonCommand} -c "import sys; print(sys.executable)"`);
        const cleanPythonPath = pythonPath.trim();

        return { pythonPath: cleanPythonPath, version: 'detected' };
    }

    async setupEnvironment(): Promise<void> {
        const serverPath = this.getServerPath();

        // Ensure server directory exists
        if (!fs.existsSync(serverPath)) {
            this.outputChannel.appendLine(`Creating server directory: ${serverPath}`);
            fs.mkdirSync(serverPath, { recursive: true });
        }

        // Check if venv already exists
        const venvPath = path.join(serverPath, '.venv');
        const pythonCmd = process.platform === 'win32'
            ? path.join(venvPath, 'Scripts', 'python.exe')
            : path.join(venvPath, 'bin', 'python');

        if (fs.existsSync(pythonCmd)) {
            this.outputChannel.appendLine('Virtual environment already exists');
            return;
        }

        const { pythonPath } = await this.checkPrerequisites();

        this.outputChannel.appendLine(`Creating virtual environment at ${venvPath}...`);

        await new Promise<void>((resolve, reject) => {
            const venvProcess = child_process.spawn(
                pythonPath,
                ['-m', 'venv', '.venv'],
                { cwd: serverPath }
            );

            venvProcess.stdout?.on('data', (data) => {
                this.outputChannel.append(data.toString());
            });

            venvProcess.stderr?.on('data', (data) => {
                this.outputChannel.append(data.toString());
            });

            venvProcess.on('close', (code) => {
                if (code === 0) {
                    resolve();
                } else {
                    reject(new Error(`venv creation failed with code ${code}`));
                }
            });
        });
    }

    async installDependencies(): Promise<void> {
        const serverPath = this.getServerPath();
        const venvPath = path.join(serverPath, '.venv');

        const pipCmd = process.platform === 'win32'
            ? path.join(venvPath, 'Scripts', 'pip.exe')
            : path.join(venvPath, 'bin', 'pip');

        this.outputChannel.appendLine('Installing Python dependencies...');

        // Create requirements.txt
        const requirementsContent = `fastapi>=0.104.0
uvicorn[standard]>=0.24.0
httpx>=0.25.0
pydantic>=2.5.0
python-dotenv>=1.0.0
jinja2>=3.1.0
python-multipart>=0.0.6
aiofiles>=23.2.0
`;

        const requirementsPath = path.join(serverPath, 'requirements.txt');
        fs.writeFileSync(requirementsPath, requirementsContent);

        await new Promise<void>((resolve, reject) => {
            const pipProcess = child_process.spawn(
                pipCmd,
                ['install', '-r', 'requirements.txt'],
                { cwd: serverPath }
            );

            pipProcess.stdout?.on('data', (data) => {
                this.outputChannel.append(data.toString());
            });

            pipProcess.stderr?.on('data', (data) => {
                this.outputChannel.append(data.toString());
            });

            pipProcess.on('close', (code) => {
                if (code === 0) {
                    resolve();
                } else {
                    reject(new Error(`pip install failed with code ${code}`));
                }
            });
        });
    }

    async copyServerFiles(): Promise<void> {
        const serverPath = this.getServerPath();
        const sourcePath = path.join(this.context.extensionUri.fsPath, 'server');

        this.outputChannel.appendLine('Copying server files...');

        // Server files are bundled in the extension's server/ folder

        const filesToCopy = [
            'main.py',
            'config.py',
            'requirements.txt',
        ];

        for (const file of filesToCopy) {
            const src = path.join(sourcePath, file);
            const dest = path.join(serverPath, file);

            if (fs.existsSync(src)) {
                this.outputChannel.appendLine(`Copying ${file}...`);
                fs.copyFileSync(src, dest);
            } else {
                throw new Error(`Required file not found: ${src}`);
            }
        }

        // Copy directories (only static is bundled in the extension)
        const dirsToCopy = ['static'];

        for (const dir of dirsToCopy) {
            const src = path.join(sourcePath, dir);
            const dest = path.join(serverPath, dir);

            if (fs.existsSync(src)) {
                this.outputChannel.appendLine(`Copying ${dir}/ directory...`);
                this.copyDirectory(src, dest);
            }
        }

        // Create default .env file
        const envPath = path.join(serverPath, '.env');
        if (!fs.existsSync(envPath)) {
            const defaultEnv = `# Ollama Cloud Configuration
OLLAMA_CLOUD_URL=https://ollama.com
OLLAMA_CLOUD_KEY=your-api-key-here

# Server Configuration
PORT=11435
HOST=0.0.0.0
`;
            fs.writeFileSync(envPath, defaultEnv);
        }
    }

    private copyDirectory(src: string, dest: string): void {
        if (!fs.existsSync(dest)) {
            fs.mkdirSync(dest, { recursive: true });
        }

        const entries = fs.readdirSync(src, { withFileTypes: true });

        for (const entry of entries) {
            const srcPath = path.join(src, entry.name);
            const destPath = path.join(dest, entry.name);

            if (entry.isDirectory()) {
                this.copyDirectory(srcPath, destPath);
            } else {
                fs.copyFileSync(srcPath, destPath);
            }
        }
    }
}
