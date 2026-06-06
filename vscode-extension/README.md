# Subvert AI - VS Code Extension

A VS Code extension for managing the Subvert AI Ollama-OpenAI proxy server.

## Features

- **Server Management**: Start, stop, and monitor the Subvert AI server directly from VS Code
- **Dashboard Integration**: Embedded web UI for configuring the proxy server
- **Auto-Installation**: One-click installation of the Python server and dependencies
- **VS Code LM Export**: Export configuration for VS Code's Language Model API

## Requirements

- Python 3.8 or higher
- VS Code 1.74.0 or higher

## Installation

1. Install the extension from the VS Code marketplace
2. Open the Subvert AI sidebar (look for the icon in the Activity Bar)
3. Click "Install Server" to set up the Python environment
4. Click "Start Server" to begin

## Usage

### Commands

- `Subvert AI: Start Server` - Start the proxy server
- `Subvert AI: Stop Server` - Stop the proxy server
- `Subvert AI: Open Dashboard` - Open the full dashboard in a tab
- `Subvert AI: Install / Repair` - Reinstall the server files
- `Subvert AI: Test Connection` - Test connection to Ollama Cloud
- `Subvert AI: Export VS Code Config` - Copy LM configuration to clipboard

### Configuration

Configure the extension in VS Code settings:

- `subvertAI.serverPort` - Port for the server (default: 11435)
- `subvertAI.autoStart` - Auto-start server when VS Code opens
- `subvertAI.ollamaCloudUrl` - Ollama Cloud URL
- `subvertAI.ollamaCloudKey` - Ollama Cloud API Key

## Development

```bash
# Install dependencies
npm install

# Compile TypeScript
npm run compile

# Watch for changes
npm run watch

# Package extension
npx vsce package
```

## License

MIT
