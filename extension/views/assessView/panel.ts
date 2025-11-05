import type { Disposable, ExtensionContext, WebviewPanel, Progress, OpenDialogOptions } from 'vscode';
import { ViewColumn, window, env, Uri, ProgressLocation, workspace } from 'vscode';
import { setupHtml } from '../utils/setupHtml';
import { DiscoveryService } from '../../discovery/DiscoveryService';
import { type ArtifactInfo, type UnifiedProjectInfo } from '../../discovery/types';
import { TunnelManager } from '../../tunnel';
import { fetchBrowserUrl, uploadFile, createTask, fetchNetworkDiagnostics, fetchNetworkDiagnosticsNextStage } from '../../httpC';
import { WebviewCommunicationHub, MessageTypes } from '../../communication';
import { getPrefixedLogger } from '../../logger';
import { SourceCodePackager } from '../../packaging/SourcePackager';
import { GitUtilities } from '../../utils/git';
import path from 'path';
import fs from 'fs';
import os from 'os';

async function getFileSize(filePath: string): Promise<number> {
  const fileSize = await fs.promises.stat(filePath);
  return fileSize.size;
}

// Throttle utility function - executes immediately on first call, then ignores subsequent calls within the time window
function throttle<T extends (...args: any[]) => any>(func: T, wait: number): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout | null = null;
  let lastExecTime = 0;

  return (...args: Parameters<T>) => {
    const now = Date.now();

    // If enough time has passed since last execution, execute immediately
    if (now - lastExecTime >= wait) {
      lastExecTime = now;
      func(...args);
      return;
    }

    // If we're still within the time window, ignore the call
    if (timeout) {
      return;
    }

    // Set a timeout to reset the throttle after the remaining time
    const remainingTime = wait - (now - lastExecTime);
    timeout = setTimeout(() => {
      timeout = null;
    }, remainingTime);
  };
}

export class MainPanel {
  public static currentPanel: MainPanel | undefined;
  private readonly _panel: WebviewPanel;
  private _disposables: Disposable[] = [];
  private _discoveryService: DiscoveryService;
  private _tunnelManager: TunnelManager;
  private _context: ExtensionContext;
  private _activePort: number | null = null;
  private _communicationHub: WebviewCommunicationHub;
  private _tunnelStoppedEventListener: (message: any) => void;
  private _tunnelCreationFailedEventListener: (message: any) => void;
  private _authLogoutEventListener: (message: any) => void;
  private _authSessionExpiredEventListener: (message: any) => void;
  private _authStatusChangedEventListener: (message: any) => void;
  private _logger = getPrefixedLogger('AssessView');

  // Throttled versions of methods
  private throttledShowAlert: (type: string, data: { title: string; message: string }, messageId: string) => void;
  private throttledShowConfirm: (type: string, data: { title: string; message: string }, messageId: string) => void;

  private constructor(
    panel: WebviewPanel,
    context: ExtensionContext,
    discoveryService: DiscoveryService,
    tunnelManager: TunnelManager,
    activePort: number | null,
    communicationHub: WebviewCommunicationHub
  ) {
    this._panel = panel;
    this._context = context;
    this._discoveryService = discoveryService;
    this._tunnelManager = tunnelManager;
    this._activePort = activePort;
    this._communicationHub = communicationHub;

    // Initialize throttled methods with 1000ms delay
    this.throttledShowAlert = throttle(this.handleShowAlert.bind(this), 1000);
    this.throttledShowConfirm = throttle(this.handleShowConfirm.bind(this), 1000);

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    this._panel.webview.html = setupHtml(this._panel.webview, context, 'assess');

    // Register webview with communication hub
    this._communicationHub.registerWebview('assess', this._panel.webview, this);

    // Save event listener reference for proper cleanup
    this._tunnelStoppedEventListener = (message) => {
      this._logger.info(`AssessView received tunnel stopped event: ${JSON.stringify(message)}`);

      // Notify assess webview about tunnel stopped
      this._panel.webview.postMessage({
        type: 'tunnelStopped',
        data: { port: message.data.port, reason: message.data.reason },
      });
    };

    this._tunnelCreationFailedEventListener = (message) => {
      this._logger.info(`AssessView received tunnel creation failed event: ${JSON.stringify(message)}`);

      // Notify assess webview about tunnel creation failure
      this._panel.webview.postMessage({
        type: 'tunnelCreationFailed',
        data: { port: message.data.port, reason: message.data.reason },
      });
    };

    // Authentication event listeners
    this._authLogoutEventListener = (message) => {
      this._logger.info('AssessView received logout success event, stopping all tunnels');
      this.handleAuthenticationLogout();
    };

    this._authSessionExpiredEventListener = (message) => {
      this._logger.info('AssessView received session expired event, stopping all tunnels');
      this.handleAuthenticationLogout();
    };

    this._authStatusChangedEventListener = (message) => {
      // Only stop tunnels when authentication status changes to false (user logged out)
      if (message.data && message.data.isAuthenticated === false) {
        this._logger.info('AssessView received auth status changed to unauthenticated, stopping all tunnels');
        this.handleAuthenticationLogout();
      }
    };

    // Listen for tunnel events from other webviews
    this._communicationHub.addEventListener(MessageTypes.TUNNEL_STOPPED, this._tunnelStoppedEventListener);
    this._communicationHub.addEventListener(MessageTypes.TUNNEL_CREATION_FAILED, this._tunnelCreationFailedEventListener);

    // Listen for authentication events
    this._communicationHub.addEventListener(MessageTypes.AUTH_LOGOUT_SUCCESS, this._authLogoutEventListener);
    this._communicationHub.addEventListener(MessageTypes.AUTH_SESSION_EXPIRED, this._authSessionExpiredEventListener);
    this._communicationHub.addEventListener(MessageTypes.AUTH_STATUS_CHANGED, this._authStatusChangedEventListener);

    // Setup webview message handlers
    this.setupWebviewHooks();

    // Initialize artifacts on startup
    this.initializeArtifacts();
  }

  public static render(context: ExtensionContext, discoveryService: DiscoveryService, tunnelManager: TunnelManager, activePort: number | null, communicationHub: WebviewCommunicationHub) {
    if (MainPanel.currentPanel) {
      MainPanel.currentPanel._panel.reveal(ViewColumn.One);
    } else {
      const panel = window.createWebviewPanel('CodeAssess', 'Code Assessment', ViewColumn.One, {
        enableScripts: true,
        retainContextWhenHidden: true,
      });

      MainPanel.currentPanel = new MainPanel(panel, context, discoveryService, tunnelManager, activePort, communicationHub);
    }

    // Record the assessment time when panel is opened
    MainPanel.currentPanel.recordAssessmentTime();
  }

  public setupWebviewHooks() {
    this._panel.webview.onDidReceiveMessage(async (message) => {
      this._logger.debug(`Received message: ${JSON.stringify(message)}`);

      switch (message.type) {
        case 'showAlert':
          // Use throttled version to prevent frequent requests - only executes first call within 1000ms
          this.throttledShowAlert(message.type, message.data, message.id);
          break;
        case 'showConfirm':
          // Use throttled version to prevent frequent requests - only executes first call within 1000ms
          this.throttledShowConfirm(message.type, message.data, message.id);
          break;
        case 'artifacts':
          await this.handleArtifactsRequest();
          break;
        case 'createTunnel':
          await this.handleCreateTunnel(message.port);
          break;
        case 'stopTunnel':
          await this.handleStopTunnel(message.port);
          break;
        case 'testTunnel':
          await this.handleTestTunnel(message.url);
          break;
        case 'requestBrowserUrl':
          const browserUrl = await this.fetchBrowserUrl();
          if (browserUrl) {
            this._panel.webview.postMessage({
              type: 'browserUrl',
              data: { browserUrl },
            });
          }
          break;
        case 'startAssessment':
          await this.handleStartAssessment(message.data);
          break;
        case 'refreshPort':
          await this.handleRefreshPort();
          break;
        case 'closePage':
          await this.handleClosePage();
          break;
        case 'selectFiles':
          await this.handleSelectFiles(message.data);
          break;
        case 'retryNetworkDiagnostics':
          await this.handleRetryNetworkDiagnostics(message.url);
          break;
        default:
          this._logger.warn(`Unknown message type: ${message.type}`);
      }
    });
  }

  public setActivePort(port: number) {
    this._activePort = port;
  }

  private async initializeArtifacts() {
    try {
      this._logger.info('Initializing artifacts...');
      await this.handleArtifactsRequest();
    } catch (error) {
      this._logger.error(`Error initializing artifacts: ${error}`);
    }
  }

  private async handleArtifactsRequest() {
    try {
      this._logger.info('Discovering projects and artifacts...');
      const projects = await this._discoveryService.discoverAllProjects();

      // Extract artifacts from all projects and convert to frontend format
      const artifactList: any[] = [];

      for (const project of projects) {
        if (project.language === 'java' && project.artifacts) {
          // Convert Java artifacts to frontend format
          const javaArtifacts = project.artifacts.map((artifact) => ({
            name: artifact.fileName,
            path: artifact.filePath,
            size: artifact.size,
            sourceCodePaths: artifact.sourceCodePaths,
            language: 'java',
            type: 'file', // Java artifacts are always files
          }));
          artifactList.push(...javaArtifacts);
        } else if (project.language === 'javascript' || project.language === 'python') {
          // For JS and Python projects, create source-based artifacts
          const sourceArtifact = {
            name: `${project.projectInfo.packageName || 'Unnamed Project'} [${project.language}]`,
            path: project.moduleRootPath,
            size: 0, // Size is not applicable for source projects
            sourceCodePaths: project.sourceCodePaths,
            language: project.language,
            type: 'folder', // JS/Python projects are source folders
          };
          artifactList.push(sourceArtifact);
        }
      }

      this._logger.debug(`Sending artifacts to frontend: ${JSON.stringify(artifactList)}`);

      // Send artifacts to frontend
      await this._panel.webview.postMessage({
        type: 'artifacts',
        data: { artifactList },
      });

      // Broadcast artifacts updated event to all webviews
      this._communicationHub.broadcast({
        type: MessageTypes.ARTIFACTS_DISCOVERED,
        data: { artifactList },
        source: 'assess',
      });
    } catch (error) {
      console.error('Error handling artifacts request:', error);
      await this._panel.webview.postMessage({
        type: 'artifacts',
        data: { artifactList: [] },
      });
    }
  }

  private async handleShowAlert(type: string, data: { title: string; message: string }, messageId: string) {
    try {
      await window.showInformationMessage(data.message, { modal: true });
    } catch (error) {
      console.error('Error showing alert:', error);
      await this._panel.webview.postMessage({
        type,
        id: messageId,
        data: { success: false, error: (error as Error).message },
      });
    }
  }

  private async handleShowConfirm(type: string, data: { title: string; message: string }, messageId: string) {
    try {
      const result = await window.showWarningMessage(data.message, { modal: true }, 'Yes', 'No');

      const confirmed = result === 'Yes';

      // Send response back to webview
      this._panel.webview.postMessage({
        type,
        id: messageId,
        data: { success: true, confirmed },
      });
    } catch (error) {
      console.error('Error showing confirm dialog:', error);
      await this._panel.webview.postMessage({
        type: 'response',
        id: messageId,
        data: { success: false, error: (error as Error).message },
      });
    }
  }

  private async handleCreateTunnel(port: string) {
    try {
      const portNumber = parseInt(port);
      if (isNaN(portNumber) || portNumber <= 0 || portNumber > 65535) {
        throw new Error('Invalid port number');
      }

      this._logger.info(`Creating tunnel for port: ${portNumber}`);

      // Create tunnel with callback for when URL becomes available
      await this._tunnelManager.createTunnel(portNumber, false, (url: string) => {
        this._logger.info(`Tunnel URL available: ${url}`);

        // Send tunnel created event to frontend
        this._panel.webview.postMessage({
          type: 'tunnelCreated',
          data: { url, port: portNumber },
        });

        // Broadcast tunnel created event to all webviews
        this._communicationHub.broadcast({
          type: MessageTypes.TUNNEL_CREATED,
          data: { url, port: portNumber },
          source: 'assess',
        });

        // Start network diagnostics after tunnel is created
        this.startNetworkDiagnostics(url);
      });
    } catch (error) {
      console.error('Error creating tunnel:', error);
      await this._panel.webview.postMessage({
        type: 'tunnelError',
        data: { error: (error as Error).message, action: 'create' },
      });
    }
  }

  private async handleStopTunnel(port: string) {
    try {
      const portNumber = parseInt(port);
      if (isNaN(portNumber)) {
        throw new Error('Invalid port number');
      }

      this._logger.info(`Stopping tunnel for port: ${portNumber}`);
      await this._tunnelManager.stopTunnel(portNumber);

      // Send tunnel stopped event to frontend
      await this._panel.webview.postMessage({
        type: 'tunnelStopped',
        data: { port: portNumber },
      });

      // Broadcast tunnel stopped event to all webviews
      this._communicationHub.broadcast({
        type: MessageTypes.TUNNEL_STOPPED,
        data: { port: portNumber },
        source: 'assess',
      });
    } catch (error) {
      this._logger.error(`Error stopping tunnel: ${error}`);
      await this._panel.webview.postMessage({
        type: 'tunnelError',
        data: { error: (error as Error).message, action: 'stop' },
      });
    }
  }

  private async handleTestTunnel(url: string) {
    try {
      this._logger.info(`Opening tunnel URL: ${url}`);

      // Simple URL validation
      if (!url || !url.startsWith('http')) {
        throw new Error('Invalid URL format');
      }

      // Open the URL in the default browser
      await env.openExternal(Uri.parse(url));
    } catch (error) {
      this._logger.error(`Error opening tunnel URL: ${error}`);
      window.showErrorMessage(`Failed to open tunnel URL: ${(error as Error).message}`);
    }
  }

  private async handleStartAssessment(data: string) {
    await window.withProgress(
      {
        location: ProgressLocation.Notification,
        title: 'Creating Security Assessment Task',
        cancellable: false,
      },
      async (progress: Progress<{ message?: string; increment?: number }>) => {
        try {
          // Step 1: Parse assessment data
          progress.report({ message: 'Parsing assessment data...', increment: 10 });
          const assessmentData = JSON.parse(data);
          const { artifactPath, serviceUrl, accounts, sourceCodePaths, language, projectName } = assessmentData;
          this._logger.info(`Starting assessment with data: ${data}`);

          // Determine progress increments and upload strategy based on language type
          const isSourceOnlyLanguage = language === 'javascript' || language === 'python';
          const hasSourceCode = sourceCodePaths && sourceCodePaths.length > 0;

          let fileSha: string;
          const sourceCodeInfos: any[] = [];
          const sandboxHomePageUrl = accounts?.[0]?.loginUrl;

          if (isSourceOnlyLanguage) {
            // For JS/Python projects, upload source code as the main artifact
            progress.report({ message: 'Uploading source code...', increment: 50 });
            const sourceCodeInfo = await this.handleUploadSourceCode(sourceCodePaths);
            if (sourceCodeInfo) {
              fileSha = sourceCodeInfo.sourceCode;
              this._logger.info(`Source code uploaded as main artifact, SHA256: ${fileSha}`);
            } else {
              throw new Error('Failed to upload source code for JavaScript/Python project');
            }
          } else {
            // For Java projects, upload artifact file and optionally source code
            const uploadFileIncrement = hasSourceCode ? 30 : 50;

            // Step 2: Upload artifact file
            progress.report({ message: 'Uploading artifact file...', increment: uploadFileIncrement });
            const uploadResult = await uploadFile(this._context, artifactPath);
            fileSha = uploadResult.sha256;
            this._logger.info(`Artifact file uploaded, SHA256: ${fileSha}`);

            // Step 2.5: Upload source code (optional for Java)
            if (hasSourceCode) {
              progress.report({ message: 'Uploading source code...', increment: 20 });
              const sourceCodeInfo = await this.handleUploadSourceCode(sourceCodePaths);
              if (sourceCodeInfo) {
                sourceCodeInfos.push(sourceCodeInfo);
              }
              this._logger.info(`Source code upload completed, ${sourceCodeInfos.length} items`);
            } else {
              this._logger.info('No source code paths provided, skipping source code upload');
            }
          }

          // Step 3: Create task
          progress.report({ message: 'Creating assessment task...', increment: 30 });
          let taskId = '';
          if (!isSourceOnlyLanguage) {
            const response = await createTask(this._context, {
              projectName,
              lang: language,
              javaPackage: fileSha,
              sandboxTargetServiceUrl: serviceUrl,
              sandboxHomePageUrl,
              sandboxAuthInfos: accounts,
              sourceCodeInfos,
            });
            taskId = response.taskId;
          } else {
            const response = await createTask(this._context, {
              projectName,
              lang: language,
              primarySourceCode: fileSha,
              sandboxTargetServiceUrl: serviceUrl,
              sandboxHomePageUrl,
              sandboxAuthInfos: accounts,
            });
            taskId = response.taskId;
          }
          this._logger.info(`Task created: ${taskId}`);

          // Step 4: Notify webview and broadcast events
          progress.report({ message: 'Finalizing task creation...', increment: 10 });

          this._panel.webview.postMessage({
            type: 'assessment',
            data: { success: true, taskId },
          });

          // Broadcast task created event to all webviews for project task tracking
          this._communicationHub.broadcast({
            type: MessageTypes.TASK_CREATED,
            data: { taskId, createdAt: Date.now() },
            source: 'assess',
          });

          // Broadcast assessment completed event to all webviews
          this._communicationHub.broadcast({
            type: MessageTypes.ASSESSMENT_COMPLETED,
            data: { taskId, timestamp: Date.now() },
            source: 'assess',
          });

          // Complete the progress
          progress.report({ message: 'Task created successfully!', increment: 0 });
        } catch (error) {
          this._logger.error(`Error starting assessment: ${error}`);

          // Show error message
          progress.report({ message: 'Task creation failed', increment: 0 });

          // Show error notification
          window.showErrorMessage(`Failed to create assessment task: ${(error as Error).message}`);

          // Send failure message directly to webview
          this._panel.webview.postMessage({
            type: 'assessment',
            data: { success: false, error: (error as Error).message },
          });

          // Broadcast assessment failed event to all webviews
          this._communicationHub.broadcast({
            type: MessageTypes.ASSESSMENT_FAILED,
            data: { error: (error as Error).message, timestamp: Date.now() },
            source: 'assess',
          });
        }
      }
    );
  }

  private async handleUploadSourceCode(sourceCodePaths: string[]): Promise<{
    type: 'BACKEND';
    sourceCode: string;
    fileName: string;
  } | null> {
    this._logger.info(`Uploading source code: ${sourceCodePaths}`);

    // Check if sourceCodePaths is empty
    if (!sourceCodePaths || sourceCodePaths.length === 0) {
      this._logger.warn('No source code paths provided');
      return null;
    }

    try {
      // Create a temporary zip file
      const tempZipPath = await this.createSourceCodeZip(sourceCodePaths);

      // Upload the zip file
      const { sha256 } = await uploadFile(this._context, tempZipPath);

      // Clean up temporary file
      fs.unlinkSync(tempZipPath);

      this._logger.info(`Source code uploaded successfully, SHA256: ${sha256}`);

      return {
        type: 'BACKEND',
        sourceCode: sha256,
        fileName: path.basename(tempZipPath),
      };
    } catch (error) {
      this._logger.error(`Failed to upload source code: ${error}`);
      throw error;
    }
  }

  private async createSourceCodeZip(sourceCodePaths: string[]): Promise<string> {
    try {
      // Find the common git root for all source paths
      let gitRoot: string | null = null;

      for (const sourcePath of sourceCodePaths) {
        if (fs.existsSync(sourcePath)) {
          const currentGitRoot = await GitUtilities.findGitRoot(sourcePath);
          if (currentGitRoot) {
            gitRoot = currentGitRoot;
            break;
          }
        }
      }

      if (!gitRoot) {
        throw new Error('No Git repository found for the provided source paths');
      }

      // Get Git info
      const gitInfo = await GitUtilities.getGitInfo(gitRoot);

      // Create source code packager
      const packager = new SourceCodePackager();

      // Package the source directories
      const result = await packager.packageSources(sourceCodePaths, gitInfo, {
        outputDir: os.tmpdir(),
        compressionLevel: 9,
        onProgress: (progress) => {
          this._logger.info(`Packaging progress: ${progress.percentage}% (${progress.currentFile})`);
        },
      });

      if (!result.success) {
        throw new Error(`Failed to create source code package: ${result.errors.join(', ')}`);
      }

      this._logger.info(`Source code zip created: ${result.zipFilePath}`);
      this._logger.info(`Total size: ${result.totalSize} bytes, Compressed: ${result.compressedSize} bytes`);
      this._logger.info(`Compression ratio: ${result.compressionRatio}%, Files included: ${result.includedFiles}`);

      if (result.errors.length > 0) {
        this._logger.warn(`Packaging completed with warnings: ${result.errors.join(', ')}`);
      }

      return result.zipFilePath;
    } catch (error) {
      this._logger.error(`Failed to create source code zip: ${error}`);
      throw error;
    }
  }

  private async handleRefreshPort() {
    this._logger.info(`Refreshing port: ${this._activePort}`);
    if (this._activePort) {
      this.sendPortUpdate(this._activePort);
    }
  }

  private async handleSelectFiles(data: any) {
    this._logger.info('Opening file selection dialog...');
    try {
      const options: OpenDialogOptions = {
        defaultUri: workspace.workspaceFolders?.[0]?.uri,
        canSelectMany: false,
        canSelectFiles: data?.canSelectFiles ?? true,
        canSelectFolders: data?.canSelectFolders ?? false,
        openLabel: 'Select Files for Analysis',
        title: data?.title ?? 'Select Files for Analysis',
      };

      // Add file filters if provided
      if (data?.filters) {
        options.filters = {
          ...data.filters,
          'All files': ['*'],
        };
      }

      const fileUris = await window.showOpenDialog(options);

      if (fileUris && fileUris.length > 0) {
        const selections = await Promise.all(
          fileUris.map(async (uri) => {
            const filePath = uri.fsPath;
            const stats = await fs.promises.stat(filePath);
            const isDirectory = stats.isDirectory();
            return {
              path: filePath,
              size: isDirectory ? 0 : stats.size,
              type: isDirectory ? 'folder' : 'file',
              name: path.basename(filePath),
            };
          })
        );

        this._logger.info(`Selected ${selections.length} items: ${selections.map((s) => s.path).join(', ')}`);

        // Send selected files back to webview
        this._panel.webview.postMessage({
          type: 'filesSelected',
          data: { selections },
        });
      } else {
        // User cancelled selection
        this._panel.webview.postMessage({
          type: 'fileSelectionCancelled',
          data: {},
        });
      }
    } catch (error) {
      this._logger.error(`Error opening file selection dialog: ${error}`);

      // Send error back to webview
      this._panel.webview.postMessage({
        type: 'fileSelectionError',
        data: { error: error?.toString() ?? 'Unknown error' },
      });
    }
  }

  private async handleClosePage() {
    this._logger.info('Closing assessment page...');
    try {
      // Close the webview panel
      this.dispose();
    } catch (error) {
      this._logger.error(`Error closing assessment page: ${error}`);
    }
  }

  private async fetchBrowserUrl() {
    try {
      const browserUrl = await fetchBrowserUrl(this._context);
      return browserUrl;
    } catch (error) {
      this._logger.error(`Error fetching browser URL: ${error}`);
      return null;
    }
  }

  public recordAssessmentTime() {
    // Record the current time as the last assessment time
    this._context.globalState.update('lastAssessTime', Date.now());
  }

  /**
   * Store task data to workspaceState and maintain latest 10 records
   * @param taskId The ID of the created task
   */

  /**
   * Handle authentication logout/session expiry - stop all tunnels
   */
  private async handleAuthenticationLogout(): Promise<void> {
    try {
      // Stop all active tunnels
      await this._tunnelManager.stopAllTunnels();

      // Notify the webview about authentication logout affecting tunnels
      this._panel.webview.postMessage({
        type: 'authenticationLogout',
        data: { message: 'All tunnels stopped due to authentication logout' },
      });

      this._logger.info('Successfully stopped all tunnels due to authentication logout');
    } catch (error) {
      this._logger.error(`Error stopping tunnels during authentication logout: ${error}`);
    }
  }

  /**
   * Send port update event to the webview
   */
  public sendPortUpdate(port: number): void {
    this._panel.webview.postMessage({
      type: 'portUpdate',
      data: { port },
    });
  }

  /**
   * Start network diagnostics for the given URL
   */
  private async startNetworkDiagnostics(url: string): Promise<void> {
    try {
      this._logger.info(`Starting network diagnostics for URL: ${url}`);

      // Notify frontend that diagnostics is starting
      this._panel.webview.postMessage({
        type: 'networkDiagnosticsStarted',
        data: { url },
      });

      // Create network diagnostics task
      const { id } = await fetchNetworkDiagnostics(this._context, url);
      this._logger.info(`Network diagnostics task created with ID: ${id}`);

      // Start polling for diagnostics results
      this.pollNetworkDiagnostics(id, url);
    } catch (error) {
      this._logger.error(`Error starting network diagnostics: ${error}`);

      // Notify frontend about diagnostics failure
      this._panel.webview.postMessage({
        type: 'networkDiagnosticsFailed',
        data: {
          url,
          error: (error as Error).message,
          canRetry: true,
        },
      });
    }
  }

  /**
   * Poll network diagnostics results until finished
   */
  private async pollNetworkDiagnostics(diagId: string, url: string): Promise<void> {
    try {
      const result = await fetchNetworkDiagnosticsNextStage(this._context, diagId);

      // Send current stage results to frontend
      this._panel.webview.postMessage({
        type: 'networkDiagnosticsUpdate',
        data: {
          url,
          diagId,
          status: result.status,
          stageCount: result.stageCount,
          nextStage: result.nextStage,
          stages: result.stages,
        },
      });

      // If not finished, continue polling
      if (result.status === 'IN_PROGRESS') {
        setTimeout(() => {
          this.pollNetworkDiagnostics(diagId, url);
        }, 2000); // Poll every 2 seconds
      } else if (result.status === 'FINISHED') {
        this._logger.info(`Network diagnostics completed for URL: ${url}`);

        // Check if all stages passed
        const allStagesPassed = result.stages.every((stage) => stage.status === 'PASS');

        this._panel.webview.postMessage({
          type: 'networkDiagnosticsCompleted',
          data: {
            url,
            diagId,
            success: allStagesPassed,
            stages: result.stages,
          },
        });
      }
    } catch (error) {
      this._logger.error(`Error polling network diagnostics: ${error}`);

      // Notify frontend about diagnostics failure
      this._panel.webview.postMessage({
        type: 'networkDiagnosticsFailed',
        data: {
          url,
          error: (error as Error).message,
          canRetry: true,
        },
      });
    }
  }

  /**
   * Handle retry network diagnostics request from frontend
   */
  private async handleRetryNetworkDiagnostics(url: string): Promise<void> {
    this._logger.info(`Retrying network diagnostics for URL: ${url}`);
    await this.startNetworkDiagnostics(url);
  }

  /**
   * Cleans up and disposes of webview resources when the webview panel is closed.
   */
  public dispose() {
    MainPanel.currentPanel = undefined;

    // Remove event listeners
    this._communicationHub.removeEventListener(MessageTypes.TUNNEL_STOPPED, this._tunnelStoppedEventListener);
    this._communicationHub.removeEventListener(MessageTypes.TUNNEL_CREATION_FAILED, this._tunnelCreationFailedEventListener);
    this._communicationHub.removeEventListener(MessageTypes.AUTH_LOGOUT_SUCCESS, this._authLogoutEventListener);
    this._communicationHub.removeEventListener(MessageTypes.AUTH_SESSION_EXPIRED, this._authSessionExpiredEventListener);
    this._communicationHub.removeEventListener(MessageTypes.AUTH_STATUS_CHANGED, this._authStatusChangedEventListener);

    // Unregister webview from communication hub
    this._communicationHub.unregisterWebview('assess');

    // Dispose of the current webview panel
    this._panel.dispose();

    // Dispose of all disposables (i.e. commands) for the current webview panel
    while (this._disposables.length) {
      const disposable = this._disposables.pop();
      if (disposable) {
        disposable.dispose();
      }
    }
  }
}
