# Contributing to Zast Express Extension

Thank you for your interest in contributing to the Zast Express VS Code extension! This document provides guidelines and instructions for setting up your development environment.

## Prerequisites

- [Node.js](https://nodejs.org/) (LTS version recommended)
- [npm](https://www.npmjs.com/) or [yarn](https://yarnpkg.com/)
- [Visual Studio Code](https://code.visualstudio.com/)
- [vsce](https://github.com/microsoft/vscode-vsce), the VS Code extension manager.

## Setup

1.  **Clone the repository:**

    ```bash
    git clone https://github.com/zast-ai/zast-extension.git
    cd zast-extension
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

## Configuration

The extension requires a configuration file to connect to the Zast Express backend services.

1.  In the `config/` directory, you will find configuration files for different regions (e.g., `region_dev.json`, `region_cn.json`). The build script uses these templates to generate a `config.json` file.
2.  **Important**: The values in the template files, especially within the `saasConfig` object (like `clientId` and `clientSecret`), are examples. You need to contact the project author to obtain the correct values for a working development setup.

Here is an example of the configuration structure from `config/region_dev.json`:

```json
{
  "package": {
    "name": "example-extension",
    "displayName": "Example Extension",
    "description": "VSCode extension for Example security vulnerability assessment",
    "publisher": "example-publisher",
    "title": "Example Extension"
  },
  "apiBaseUrl": "https://api.example.com",
  "selfHostedConfig": {
    "oauthAuthUrl": "/oauth/authorize",
    "oauthRefreshTokenUrl": "/biz/api/v1/auth/exchange-token"
  },
  "saasConfig": {
    "clientId": "EXAMPLE_CLIENT_ID",
    "clientSecret": "EXAMPLE_CLIENT_SECRET",
    "authUrl": "https://auth.example.com/oauth/authorize",
    "tokenUrl": "https://auth.example.com/oauth/token",
    "userInfoUrl": "https://auth.example.com/oauth/userinfo",
    "scopes": ["openid", "profile", "email", "public_metadata"]
  },
  "reportUrl": "https://github.com/example-org/example-extension/issues",
  "helpUrl": "https://example.com/document/extension",
  "supportEmail": "support@example.com"
}
```

## Available Scripts

The `package.json` file contains several scripts for building, testing, and packaging the extension.

### Development

- `npm run dev`: Starts the Vite development server for the webview UI.
- `npm run watch`: Compiles the extension source code in watch mode. Changes will trigger a recompilation.
- `npm run lint`: Lints the TypeScript source code to check for errors and style issues.

### Building

The project supports different build regions (`dev`, `cn`, `global`).

- `npm run prepare:files:dev|cn|global`: Prepares the necessary files for a specific region. This script copies the corresponding configuration from `config/` and assets from `regional-assets/`.
- `npm run build:dev|cn|global`: Builds the extension for a specific region. It first prepares the files and then runs `vite build`.
- `npm run compile`: A shorthand for `vite build`.

### Packaging & Publishing

- `npm run package:dev|cn|global`: Packages the extension into a `.vsix` file for a specific region. This is useful for local installation and testing.
- `npm run publish:cn|global`: Publishes the extension to the marketplace for the specified region. This requires publisher credentials.

## Running in Development Mode

1.  **Prepare the development environment:**

    ```bash
    npm run prepare:files:dev
    ```

    This will create the necessary `package.json` and other files for development based on the `region_dev` configuration.

2.  **Start the watcher:**
    In a terminal, run:

    ```bash
    npm run watch
    ```

    This will watch for changes in the `extension/` directory and recompile the extension code.

3.  **Run the extension in VS Code:**
    - Open the project in VS Code.
    - Press `F5` to open a new "Extension Development Host" window.
    - The Zast Express extension will be running in this new window.

Happy coding!
