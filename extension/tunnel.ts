import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as zlib from 'zlib';
import { spawn, ChildProcess } from 'child_process';
import { promisify } from 'util';
import fetch from 'node-fetch';
import { getPrefixedLogger } from './logger';
import { WebviewCommunicationHub, MessageTypes } from './communication';

interface TunnelInstance {
  port: number;
  process?: ChildProcess;
  terminal: vscode.Terminal;
  pseudoterminal: TunnelPseudoterminal;
  url?: string;
  isAutoCreated?: boolean;
}

interface CloudflaredInfo {
  exists: boolean;
  path?: string;
  needsDownload: boolean;
}

/**
 * Pseudoterminal implementation for tunnel processes
 */
class TunnelPseudoterminal implements vscode.Pseudoterminal {
  private writeEmitter = new vscode.EventEmitter<string>();
  private closeEmitter = new vscode.EventEmitter<number | void>();
  private process?: ChildProcess;
  private logger = getPrefixedLogger('TunnelPseudoterminal');

  onDidWrite: vscode.Event<string> = this.writeEmitter.event;
  onDidClose?: vscode.Event<number | void> = this.closeEmitter.event;

  constructor(private port: number, private cloudflaredPath: string, private onUrlExtracted?: (url: string) => void, private onTunnelStopped?: (port: number, reason: string) => void) {}

  open(): void {
    this.writeEmitter.fire(`Creating tunnel for port ${this.port}...\r\n`);
    this.startProcess();
  }

  close(): void {
    if (this.process) {
      this.logger.info(`Terminating tunnel process for port ${this.port}`);
      this.process.kill('SIGTERM');

      // Force kill after 5 seconds if still running
      setTimeout(() => {
        if (this.process && !this.process.killed) {
          this.logger.warn(`Force killing tunnel process for port ${this.port}`);
          this.process.kill('SIGKILL');
        }
      }, 5000);
    }
  }

  private startProcess(): void {
    try {
      this.process = spawn(this.cloudflaredPath, ['tunnel', '--url', `http://localhost:${this.port}`], {
        stdio: 'pipe',
        cwd: os.homedir(), // Set working directory to avoid permission issues
      });

      this.logger.info(`Started cloudflared process for port ${this.port}`);
      this.writeEmitter.fire(`Starting cloudflared tunnel...\r\n`);

      // Handle stdout
      this.process.stdout?.on('data', (data) => {
        const output = data.toString();
        this.writeEmitter.fire(output.replace(/\n/g, '\r\n'));
        this.extractUrlFromOutput(output);
      });

      // Handle stderr (cloudflared often outputs important info here)
      this.process.stderr?.on('data', (data) => {
        const output = data.toString();
        this.writeEmitter.fire(output.replace(/\n/g, '\r\n'));
        this.extractUrlFromOutput(output);
      });

      // Handle process close
      this.process.on('close', (code) => {
        this.logger.info(`Tunnel process for port ${this.port} exited with code ${code}`);
        this.writeEmitter.fire(`\r\n[Process exited with code ${code}]\r\n`);

        // Notify about tunnel stop if callback is provided
        if (this.onTunnelStopped) {
          this.onTunnelStopped(this.port, code === 0 ? 'process-exit-normal' : 'process-exit-error');
        }

        this.closeEmitter.fire(code || 0);
      });

      // Handle process error
      this.process.on('error', (error) => {
        this.logger.error(`Tunnel process error for port ${this.port}: ${error}`);
        this.writeEmitter.fire(`\r\n[Error: ${error.message}]\r\n`);

        // Notify about tunnel stop if callback is provided
        if (this.onTunnelStopped) {
          this.onTunnelStopped(this.port, 'process-error');
        }

        this.closeEmitter.fire(1);
      });
    } catch (error) {
      this.logger.error(`Failed to start tunnel process for port ${this.port}: ${error}`);
      this.writeEmitter.fire(`\r\n[Failed to start process: ${error}]\r\n`);
      this.closeEmitter.fire(1);
    }
  }

  private extractUrlFromOutput(output: string): void {
    const urlMatch = output.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
    if (urlMatch && this.onUrlExtracted) {
      const url = urlMatch[0];
      this.logger.info(`Extracted tunnel URL for port ${this.port}: ${url}`);
      this.writeEmitter.fire(`\r\n✅ Tunnel URL: ${url}\r\n`);
      this.onUrlExtracted(url);
    }
  }

  public getProcess(): ChildProcess | undefined {
    return this.process;
  }
}

export class TunnelManager {
  private static instance: TunnelManager;
  private activeTunnels: Map<number, TunnelInstance> = new Map();
  private context: vscode.ExtensionContext;
  private logger = getPrefixedLogger('Tunnel');
  private hasShownSecurityWarning: boolean = false;
  private tunnelCallbacks: Map<number, (url: string) => void> = new Map();
  private communicationHub: WebviewCommunicationHub;

  private constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.communicationHub = WebviewCommunicationHub.getInstance();
    this.setupProcessCleanup();
  }

  public static getInstance(context: vscode.ExtensionContext): TunnelManager {
    if (!TunnelManager.instance) {
      TunnelManager.instance = new TunnelManager(context);
    }
    return TunnelManager.instance;
  }

  /**
   * Discover ports from configuration files
   */
  public async discoverPortsFromConfig(): Promise<number[]> {
    const ports: number[] = [];
    const config = vscode.workspace.getConfiguration('java.tunnel');
    const scanPatterns = config.get<string[]>('port.scanConfigFiles', ['**/application.properties', '**/application.yml', '**/application.yaml']);

    for (const pattern of scanPatterns) {
      const files = await vscode.workspace.findFiles(pattern);

      for (const file of files) {
        try {
          const content = await vscode.workspace.fs.readFile(file);
          const contentStr = content.toString();

          if (file.path.endsWith('.properties')) {
            const discoveredPorts = this.extractPortsFromProperties(contentStr);
            ports.push(...discoveredPorts);
          } else if (file.path.endsWith('.yml') || file.path.endsWith('.yaml')) {
            const discoveredPorts = this.extractPortsFromYaml(contentStr);
            ports.push(...discoveredPorts);
          }
        } catch (error) {
          this.logger.error(`Error reading config file ${file.path}: ${error}`);
        }
      }
    }

    return [...new Set(ports)]; // Remove duplicates
  }

  /**
   * Extract ports from .properties files
   */
  private extractPortsFromProperties(content: string): number[] {
    const ports: number[] = [];
    const lines = content.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('#') || !trimmed.includes('=')) continue;

      const [key, value] = trimmed.split('=');
      if (key.trim().toLowerCase().includes('port')) {
        const port = parseInt(value.trim());
        if (!isNaN(port) && port > 0 && port <= 65535) {
          ports.push(port);
        }
      }
    }

    return ports;
  }

  /**
   * Extract ports from .yml/.yaml files
   */
  private extractPortsFromYaml(content: string): number[] {
    const ports: number[] = [];
    const lines = content.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('#') || !trimmed.includes(':')) continue;

      if (trimmed.toLowerCase().includes('port')) {
        const match = trimmed.match(/port\s*:\s*(\d+)/i);
        if (match) {
          const port = parseInt(match[1]);
          if (!isNaN(port) && port > 0 && port <= 65535) {
            ports.push(port);
          }
        }
      }
    }

    return ports;
  }

  /**
   * Show security warning on first use
   */
  private async showSecurityWarning(): Promise<boolean> {
    if (this.hasShownSecurityWarning) {
      return true;
    }

    const result = await vscode.window.showWarningMessage(
      'This operation will expose your local port to the public internet. Please ensure your service does not contain sensitive information or is properly secured.',
      { modal: true },
      'I understand and continue'
    );

    if (result === 'I understand and continue') {
      this.hasShownSecurityWarning = true;
      return true;
    }

    return false;
  }

  /**
   * Check cloudflared availability and download if needed
   */
  private async checkCloudflaredAvailability(): Promise<CloudflaredInfo> {
    const config = vscode.workspace.getConfiguration('java.tunnel');
    const customPath = config.get<string>('cloudflared.path');

    if (customPath && fs.existsSync(customPath)) {
      return { exists: true, path: customPath, needsDownload: false };
    }

    const binDir = path.join(this.context.extensionPath, 'bin');
    const cloudflaredPath = path.join(binDir, os.platform() === 'win32' ? 'cloudflared.exe' : 'cloudflared');

    if (fs.existsSync(cloudflaredPath)) {
      return { exists: true, path: cloudflaredPath, needsDownload: false };
    }

    return { exists: false, needsDownload: true };
  }

  /**
   * Download cloudflared binary
   */
  private async downloadCloudflared(): Promise<string> {
    return vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Downloading Cloudflared',
        cancellable: true,
      },
      async (progress, token) => {
        const binDir = path.join(this.context.extensionPath, 'bin');

        if (!fs.existsSync(binDir)) {
          fs.mkdirSync(binDir, { recursive: true });
        }

        const platform = os.platform();
        const arch = os.arch();
        let downloadUrl: string;
        let filename: string;
        let isCompressed = false;

        // Determine download URL based on platform and architecture
        if (platform === 'win32') {
          filename = 'cloudflared.exe';
          downloadUrl =
            arch === 'x64'
              ? 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe'
              : 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-386.exe';
        } else if (platform === 'darwin') {
          filename = 'cloudflared';
          isCompressed = true;
          downloadUrl =
            arch === 'arm64'
              ? 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-arm64.tgz'
              : 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-amd64.tgz';
        } else {
          filename = 'cloudflared';
          downloadUrl =
            arch === 'x64'
              ? 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64'
              : 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-386';
        }

        const filePath = path.join(binDir, filename);

        try {
          // Check for cancellation before starting
          if (token.isCancellationRequested) {
            throw new vscode.CancellationError();
          }

          progress.report({ increment: 0, message: 'Preparing download...' });
          this.logger.info(`Downloading cloudflared from: ${downloadUrl}`);

          // Check for cancellation
          if (token.isCancellationRequested) {
            throw new vscode.CancellationError();
          }

          progress.report({ increment: 10, message: 'Starting download...' });
          const response = await fetch(downloadUrl);
          if (!response.ok) {
            throw new Error(`Failed to download: ${response.statusText}`);
          }

          // Check for cancellation
          if (token.isCancellationRequested) {
            throw new vscode.CancellationError();
          }

          progress.report({ increment: 20, message: 'Downloading binary...' });
          const buffer = await response.buffer();

          // Check for cancellation
          if (token.isCancellationRequested) {
            throw new vscode.CancellationError();
          }

          progress.report({ increment: 60, message: 'Processing file...' });

          if (isCompressed && platform === 'darwin') {
            // Handle .tgz files for macOS
            progress.report({ increment: 10, message: 'Extracting archive...' });
            await this.extractTarGz(buffer, binDir, filename);
          } else {
            // Direct binary download for Windows and Linux
            fs.writeFileSync(filePath, buffer);
          }

          // Check for cancellation
          if (token.isCancellationRequested) {
            throw new vscode.CancellationError();
          }

          progress.report({ increment: 5, message: 'Setting permissions...' });
          // Make executable on Unix systems
          if (platform !== 'win32') {
            fs.chmodSync(filePath, '755');
          }

          progress.report({ increment: 5, message: 'Download completed!' });
          this.logger.info(`Successfully downloaded cloudflared to: ${filePath}`);
          return filePath;
        } catch (error) {
          // Check if it's a cancellation error
          if (error instanceof vscode.CancellationError) {
            this.logger.info('Cloudflared download was cancelled by user');
            throw error;
          }
          this.logger.error(`Failed to download cloudflared: ${error}`);
          throw error;
        }
      }
    );
  }

  /**
   * Extract .tgz file using system tar command
   */
  private async extractTarGz(buffer: Buffer, targetDir: string, filename: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const tempTgzPath = path.join(targetDir, 'cloudflared.tgz');
      const finalPath = path.join(targetDir, filename);

      try {
        // Write the tgz file temporarily
        fs.writeFileSync(tempTgzPath, buffer);

        // Use system tar command to extract
        const tarProcess = spawn('tar', ['-xzf', tempTgzPath, '-C', targetDir], {
          stdio: 'pipe',
        });

        tarProcess.stdout?.on('data', (data) => {
          this.logger.debug(`tar output: ${data.toString()}`);
        });

        tarProcess.stderr?.on('data', (data) => {
          this.logger.debug(`tar error: ${data.toString()}`);
        });

        tarProcess.on('close', (code) => {
          try {
            // Clean up temporary file
            if (fs.existsSync(tempTgzPath)) {
              fs.unlinkSync(tempTgzPath);
            }

            if (code === 0) {
              // The extracted file might be named differently, let's find it
              const files = fs.readdirSync(targetDir);
              const extractedFile = files.find((f) => f.startsWith('cloudflared') && f !== filename);

              if (extractedFile) {
                const extractedPath = path.join(targetDir, extractedFile);
                // Move to the expected location
                fs.renameSync(extractedPath, finalPath);
                this.logger.info(`Extracted and moved cloudflared to: ${finalPath}`);
              } else {
                // File might already be named correctly
                const directPath = path.join(targetDir, 'cloudflared');
                if (fs.existsSync(directPath) && directPath !== finalPath) {
                  fs.renameSync(directPath, finalPath);
                }
              }
              resolve();
            } else {
              reject(new Error(`tar extraction failed with code ${code}`));
            }
          } catch (error) {
            reject(error);
          }
        });

        tarProcess.on('error', (error) => {
          // Clean up temporary file
          if (fs.existsSync(tempTgzPath)) {
            fs.unlinkSync(tempTgzPath);
          }
          reject(error);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Create a new tunnel
   */
  public async createTunnel(port: number, isAutoCreated: boolean = false, onTunnelReady?: (url: string) => void): Promise<void> {
    try {
      // Check if tunnel already exists for this port
      if (this.activeTunnels.has(port)) {
        const existing = this.activeTunnels.get(port);
        if (existing?.url) {
          vscode.window.showInformationMessage(`Tunnel already exists for port ${port}: ${existing.url}`);
          if (onTunnelReady) {
            onTunnelReady(existing.url);
          }
          return;
        }
      }

      // Store callback for when URL becomes available
      if (onTunnelReady) {
        this.tunnelCallbacks.set(port, onTunnelReady);
      }

      // Show security warning for manual creation
      if (!isAutoCreated && !(await this.showSecurityWarning())) {
        // Send tunnel creation failed message
        this.communicationHub.broadcast({
          type: MessageTypes.TUNNEL_CREATION_FAILED,
          data: {
            port,
            reason: 'security-warning-cancelled',
          },
          source: 'tunnel-manager',
        });
        return;
      }

      // Check cloudflared availability
      const cloudflaredInfo = await this.checkCloudflaredAvailability();
      let cloudflaredPath: string;

      if (cloudflaredInfo.needsDownload) {
        const downloadResult = await vscode.window.showInformationMessage('Cloudflared is required for tunnel functionality. Would you like to download it automatically?', 'Download', 'Cancel');

        if (downloadResult !== 'Download') {
          // Send tunnel creation failed message
          this.communicationHub.broadcast({
            type: MessageTypes.TUNNEL_CREATION_FAILED,
            data: {
              port,
              reason: 'download-cancelled',
            },
            source: 'tunnel-manager',
          });
          return;
        }

        try {
          cloudflaredPath = await this.downloadCloudflared();
        } catch (error) {
          // Check if download was cancelled
          if (error instanceof vscode.CancellationError) {
            this.logger.info('Cloudflared download cancelled by user');
            // Send tunnel creation failed message
            this.communicationHub.broadcast({
              type: MessageTypes.TUNNEL_CREATION_FAILED,
              data: {
                port,
                reason: 'download-cancelled',
              },
              source: 'tunnel-manager',
            });
            return;
          }
          // Re-throw other errors to be handled by the outer catch block
          throw error;
        }
      } else {
        cloudflaredPath = cloudflaredInfo.path!;
      }

      // Start the tunnel
      await this.startTunnel(port, cloudflaredPath, isAutoCreated);
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to create tunnel: ${error}`);
      this.logger.error(`Error creating tunnel: ${error}`);
    }
  }

  /**
   * Start the tunnel process using Pseudoterminal + Spawn
   */
  private async startTunnel(port: number, cloudflaredPath: string, isAutoCreated: boolean): Promise<void> {
    return new Promise((resolve, reject) => {
      // Create pseudoterminal with callbacks for URL extraction and tunnel stop
      const pseudoterminal = new TunnelPseudoterminal(
        port,
        cloudflaredPath,
        // onUrlExtracted callback
        (url: string) => {
          // Update tunnel instance with URL
          const tunnelInstance = this.activeTunnels.get(port);
          if (tunnelInstance) {
            tunnelInstance.url = url;

            // Call registered callback if exists
            const callback = this.tunnelCallbacks.get(port);
            if (callback) {
              callback(url);
              this.tunnelCallbacks.delete(port);
            }

            // Show notification with URL
            vscode.window.showInformationMessage(`Tunnel created for port ${port}: ${url}`, 'Copy URL').then((action) => {
              if (action === 'Copy URL') {
                vscode.env.clipboard.writeText(url);
              }
            });

            // Send global notification about tunnel creation
            this.communicationHub.broadcast({
              type: MessageTypes.TUNNEL_CREATED,
              data: {
                port,
                url,
                isAutoCreated,
              },
              source: 'tunnel-manager',
            });

            resolve();
          }
        },
        // onTunnelStopped callback
        (stoppedPort: number, reason: string) => {
          this.logger.info(`Tunnel process stopped for port ${stoppedPort}, reason: ${reason}`);

          // Send global notification about tunnel stop
          this.communicationHub.broadcast({
            type: MessageTypes.TUNNEL_STOPPED,
            data: {
              port: stoppedPort,
              reason,
            },
            source: 'tunnel-manager',
          });

          // Clean up tunnel instance if it still exists
          this.activeTunnels.delete(stoppedPort);
          this.tunnelCallbacks.delete(stoppedPort);
        }
      );

      // Create terminal using the pseudoterminal
      const terminal = vscode.window.createTerminal({
        name: `Cloudflared Tunnel: ${port}`,
        pty: pseudoterminal,
      });

      // Show the terminal (this will trigger pseudoterminal.open() and create the process)
      terminal.show();

      // Create tunnel instance first (process will be set when pseudoterminal starts)
      const tunnelInstance: TunnelInstance = {
        port,
        terminal,
        pseudoterminal,
        isAutoCreated,
      };

      this.activeTunnels.set(port, tunnelInstance);

      // Wait a moment for the pseudoterminal to start and get the process
      setTimeout(() => {
        const process = pseudoterminal.getProcess();
        if (process) {
          tunnelInstance.process = process;

          // Handle process errors
          process.on('error', (error) => {
            this.logger.error(`Tunnel process error for port ${port}: ${error}`);
            this.activeTunnels.delete(port);
            this.tunnelCallbacks.delete(port);
            reject(error);
          });
        } else {
          this.logger.warn(`Process not ready yet for port ${port}, will check later`);
        }
      }, 100);

      // Handle terminal closure
      vscode.window.onDidCloseTerminal((closedTerminal) => {
        if (closedTerminal === terminal) {
          this.logger.info(`Tunnel terminal for port ${port} was closed`);

          // Send global notification about tunnel stop
          this.communicationHub.broadcast({
            type: MessageTypes.TUNNEL_STOPPED,
            data: {
              port,
              reason: 'terminal-closed',
            },
            source: 'tunnel-manager',
          });

          this.activeTunnels.delete(port);
          this.tunnelCallbacks.delete(port);

          // Clean up pseudoterminal
          pseudoterminal.close();
        }
      });

      // Set timeout for URL extraction
      setTimeout(() => {
        const tunnelInstance = this.activeTunnels.get(port);
        if (tunnelInstance && !tunnelInstance.url) {
          this.logger.warn(`Timeout waiting for tunnel URL for port ${port}`);
          // Don't reject here, the tunnel might still work, just no URL yet
          resolve();
        }
      }, 30000); // 30 seconds timeout

      this.logger.info(`Started tunnel for port ${port} using Pseudoterminal + Spawn`);
    });
  }

  /**
   * Stop a specific tunnel
   */
  public async stopTunnel(port: number): Promise<void> {
    const tunnel = this.activeTunnels.get(port);
    if (!tunnel) {
      vscode.window.showWarningMessage(`No active tunnel found for port ${port}`);
      return;
    }

    try {
      // Clean up pseudoterminal first (this will also clean up the process)
      if (tunnel.pseudoterminal) {
        tunnel.pseudoterminal.close();
      }

      // Dispose terminal
      if (tunnel.terminal) {
        tunnel.terminal.dispose();
      }

      // Clean up any remaining process
      if (tunnel.process && !tunnel.process.killed) {
        tunnel.process.kill('SIGTERM');

        // Force kill after 3 seconds
        setTimeout(() => {
          if (tunnel.process && !tunnel.process.killed) {
            tunnel.process.kill('SIGKILL');
          }
        }, 3000);
      }

      this.activeTunnels.delete(port);
      this.tunnelCallbacks.delete(port);

      // Send global notification about tunnel stop
      this.communicationHub.broadcast({
        type: MessageTypes.TUNNEL_STOPPED,
        data: {
          port,
          reason: 'manual-stop',
        },
        source: 'tunnel-manager',
      });

      this.logger.info(`Stopped tunnel for port ${port}`);
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to stop tunnel: ${error}`);
      this.logger.error(`Error stopping tunnel: ${error}`);
    }
  }

  /**
   * Stop all active tunnels
   */
  public async stopAllTunnels(): Promise<void> {
    if (this.activeTunnels.size === 0) {
      vscode.window.showInformationMessage('No active tunnels to stop');
      return;
    }

    const tunnelPorts = Array.from(this.activeTunnels.keys());

    for (const port of tunnelPorts) {
      await this.stopTunnel(port);
    }

    vscode.window.showInformationMessage(`Stopped ${tunnelPorts.length} tunnel(s)`);
  }

  /**
   * Get list of active tunnels
   */
  public getActiveTunnels(): TunnelInstance[] {
    return Array.from(this.activeTunnels.values());
  }

  /**
   * Setup process cleanup on VS Code exit
   */
  private setupProcessCleanup(): void {
    // Clean up on extension deactivation
    this.context.subscriptions.push({
      dispose: () => {
        this.cleanup();
      },
    });

    // Clean up on process exit
    process.on('exit', () => {
      this.cleanup();
    });

    process.on('SIGINT', () => {
      this.cleanup();
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      this.cleanup();
      process.exit(0);
    });
  }

  /**
   * Clean up all resources
   */
  private cleanup(): void {
    this.logger.info('Cleaning up tunnel processes...');

    for (const [port, tunnel] of this.activeTunnels) {
      try {
        // Send global notification about tunnel stop before cleanup
        this.communicationHub.broadcast({
          type: MessageTypes.TUNNEL_STOPPED,
          data: {
            port,
            reason: 'extension-cleanup',
          },
          source: 'tunnel-manager',
        });

        // Clean up pseudoterminal first
        if (tunnel.pseudoterminal) {
          tunnel.pseudoterminal.close();
        }

        // Dispose terminal
        if (tunnel.terminal) {
          tunnel.terminal.dispose();
        }

        // Force kill process if still running
        if (tunnel.process && !tunnel.process.killed) {
          tunnel.process.kill('SIGKILL');
        }

        this.logger.info(`Cleaned up tunnel for port ${port}`);
      } catch (error) {
        this.logger.error(`Error cleaning up tunnel for port ${port}: ${error}`);
      }
    }

    this.activeTunnels.clear();
    this.tunnelCallbacks.clear();
  }
}
