import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as fs from 'fs';
import { promises as fsp } from 'fs';
import * as path from 'path';
import * as os from 'os';
import archiver from 'archiver';
import { setupHtml } from '../utils/setupHtml';
import { WebviewCommunicationHub, MessageTypes } from '../../communication';
import { getPrefixedLogger } from '../../logger';
import { sbomAnalyze, sbomAnalyzeZip, ScaReport } from '../../httpC';
import { MavenParser } from '../../discovery/strategies/java/MavenParser';
import { ZastAuth } from '../../auth';
import { SbomReportViewProvider } from '../sbomReportView/panel';

type WebViewScaReport = {
  depFile: string;
  fileHash: string;
  issueStats: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    unknown: number;
  };
  totalIssues: number;
  status: 'created' | 'running' | 'success' | 'failed';
};

type AnalysisEntry = {
  rootPom: vscode.Uri;
  pomUris: vscode.Uri[];
  displayPath: string;
  isAggregate: boolean;
};

export class SbomViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'sbom';

  private _view?: vscode.WebviewView;
  private _context: vscode.ExtensionContext;
  private _communicationHub: WebviewCommunicationHub;
  private _logger = getPrefixedLogger('SbomViewProvider');
  private _isAnalyzing = false;
  private _reports: WebViewScaReport[] = [];

  private async _prepareMultiModuleArchive(rootPom: vscode.Uri, moduleUris: vscode.Uri[]): Promise<{ zipPath: string; hash: string; cleanup: () => Promise<void> } | null> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      this._logger.warn('Workspace folders not found when preparing multi-module archive');
      return null;
    }

    const workspaceRoot = workspaceFolders[0].uri.fsPath;
    const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'zast-sbom-'));
    const zipOutputPath = path.join(tempDir, `multi-module-${Date.now()}.zip`);

    const filesToInclude = [rootPom, ...moduleUris];
    const sortedEntries = filesToInclude.map((uri) => ({ uri, relativePath: path.relative(workspaceRoot, uri.fsPath) })).sort((a, b) => a.relativePath.localeCompare(b.relativePath));

    try {
      const output = fs.createWriteStream(zipOutputPath);
      const archiveInstance = archiver('zip', { zlib: { level: 6 } });
      const hash = crypto.createHash('md5');

      const finalizeArchive = new Promise<void>((resolve, reject) => {
        archiveInstance.on('error', reject);
        output.on('error', reject);
        output.on('close', () => resolve());
      });

      archiveInstance.pipe(output);

      for (const { uri, relativePath } of sortedEntries) {
        const content = await vscode.workspace.fs.readFile(uri);
        const buffer = Buffer.from(content);
        hash.update(relativePath);
        hash.update(buffer);
        archiveInstance.append(buffer, { name: relativePath });
      }

      await archiveInstance.finalize();
      await finalizeArchive;

      const digest = hash.digest('hex');

      const cleanup = async () => {
        try {
          await fsp.unlink(zipOutputPath);
        } catch (unlinkError) {
          this._logger.warn(`Failed to remove archive ${zipOutputPath}: ${unlinkError}`);
        }

        try {
          await fsp.rm(tempDir, { recursive: true, force: true });
        } catch (rmdirError) {
          this._logger.warn(`Failed to remove temp directory ${tempDir}: ${rmdirError}`);
        }
      };

      return { zipPath: zipOutputPath, hash: digest, cleanup };
    } catch (error) {
      this._logger.error(`Failed to prepare multi-module archive: ${error}`);
      try {
        await fsp.rm(zipOutputPath, { force: true });
      } catch {
        // ignore cleanup error
      }
      try {
        await fsp.rm(tempDir, { recursive: true, force: true });
      } catch {
        // ignore cleanup error
      }
      return null;
    }
  }

  constructor(context: vscode.ExtensionContext, communicationHub: WebviewCommunicationHub) {
    this._context = context;
    this._communicationHub = communicationHub;
  }

  public resolveWebviewView(webviewView: vscode.WebviewView, context: vscode.WebviewViewResolveContext, _token: vscode.CancellationToken) {
    this._logger.info('SbomViewProvider.resolveWebviewView called');
    this._view = webviewView;

    webviewView.webview.options = {
      // Allow scripts in the webview
      enableScripts: true,
      localResourceRoots: [this._context.extensionUri],
    };

    webviewView.webview.html = setupHtml(webviewView.webview, this._context, 'sbom');

    // Register webview with communication hub
    this._communicationHub.registerWebview('sbom', webviewView.webview, this);

    // Listen for authentication events
    this._communicationHub.addEventListener(MessageTypes.AUTH_LOGIN_SUCCESS, (message) => {
      this._logger.info(`SbomViewProvider received login success: ${JSON.stringify(message)}`);
      this._handleLoginSuccess(message.data);
    });

    this._communicationHub.addEventListener(MessageTypes.AUTH_LOGOUT_SUCCESS, (message) => {
      this._logger.info(`SbomViewProvider received logout success: ${JSON.stringify(message)}`);
      this._handleLogoutSuccess(message.data);
    });

    this._communicationHub.addEventListener(MessageTypes.AUTH_STATUS_CHANGED, (message) => {
      this._logger.info(`SbomViewProvider received auth status change: ${JSON.stringify(message)}`);
      this._handleAuthStatusChange(message.data);
    });

    this._communicationHub.addEventListener(MessageTypes.AUTH_SESSION_EXPIRED, (message) => {
      this._logger.info(`SbomViewProvider received session expired: ${JSON.stringify(message)}`);
      this._handleSessionExpired(message.data);
    });

    // Handle messages from webview
    webviewView.webview.onDidReceiveMessage(async (message) => {
      this._logger.info(`SbomViewProvider.onDidReceiveMessage called: ${JSON.stringify(message)}`);
      switch (message.type) {
        case 'triggerSbomAnalysis':
          this.performSbomAnalysis({ forceRefresh: Boolean(message.data?.forceRefresh) });
          break;
        case 'checkAuthStatus':
          this._sendAuthStatusToWebview();
          break;
        case 'openSbomReportDetail':
          {
            const { fileHash } = message.data;
            if (fileHash) {
              SbomReportViewProvider.render(this._context, this._communicationHub, fileHash);
            }
          }
          break;
        // Add message handlers as needed
      }
    });

    // Set up cleanup on dispose
    webviewView.onDidDispose(() => {
      this._communicationHub.unregisterWebview('sbom');
    });

    // Load initial data
    this._loadInitialData();
  }

  private async _loadInitialData() {
    if (!this._view) return;

    try {
      // Send initial authentication status
      await this._sendAuthStatusToWebview();

      // If analysis is ongoing or completed, send the current report state
      if (this._reports.length > 0) {
        this._view.webview.postMessage({
          type: 'sbomAnalysisInitialized',
          data: {
            reports: this._reports,
            isAnalyzing: this._isAnalyzing,
          },
        });
      }
    } catch (error) {
      this._logger.error(`Error loading initial data: ${error}`);
    }
  }

  public async runFullScan(): Promise<void> {
    this._logger.info('Manual SBOM full scan requested');

    if (!this._view) {
      this._logger.warn('SBOM view is not initialized; aborting full scan');
      await vscode.window.showWarningMessage('请先打开“Deps Security”视图以运行 SBOM 扫描。');
      return;
    }

    await this.performSbomAnalysis({ forceRefresh: true });
  }

  /**
   * 执行SBOM分析
   */
  private async performSbomAnalysis(options: { forceRefresh?: boolean } = {}): Promise<void> {
    const forceRefresh = options.forceRefresh ?? false;
    if (this._isAnalyzing) {
      this._logger.info('SBOM analysis is already in progress');
      if (this._view) {
        this._view.webview.postMessage({
          type: 'sbomAnalysisInitialized',
          data: {
            reports: this._reports,
            isAnalyzing: true,
          },
        });
      }
      return;
    }

    this._isAnalyzing = true;
    this._reports = [];

    try {
      // 获取所有pom文件
      const pomFiles = await MavenParser.findAllPomFiles();
      this._logger.info(`Found ${pomFiles.length} pom files`);

      if (pomFiles.length === 0) {
        // 没有找到pom文件，发送空结果
        if (this._view) {
          this._view.webview.postMessage({
            type: 'sbomAnalysisCompleted',
            data: {
              reports: [],
            },
          });
        }
        return;
      }

      const analysisEntries = await this._buildAnalysisEntries(pomFiles);

      if (analysisEntries.length === 0) {
        if (this._view) {
          this._view.webview.postMessage({
            type: 'sbomAnalysisCompleted',
            data: {
              reports: [],
            },
          });
        }
        return;
      }

      // 1. Initialize reports with 'created' status
      this._reports = analysisEntries.map((entry) => ({
        depFile: entry.displayPath,
        fileHash: '',
        issueStats: { critical: 0, high: 0, medium: 0, low: 0, unknown: 0 },
        totalIssues: 0,
        status: 'created',
      }));

      // Send initial data to webview
      if (this._view) {
        this._view.webview.postMessage({
          type: 'sbomAnalysisInitialized',
          data: {
            reports: this._reports,
            isAnalyzing: true,
          },
        });
      }

      // 2. Serially process each file
      for (let i = 0; i < analysisEntries.length; i++) {
        const report = this._reports[i];
        const entry = analysisEntries[i];
        const relativeFilePath = report.depFile;
        try {
          // Update status to 'running'
          report.status = 'running';
          if (this._view) {
            this._view.webview.postMessage({
              type: 'sbomAnalysisReportUpdated',
              data: { report: { depFile: relativeFilePath, status: 'running' } },
            });
          }

          const { analysisPath, hash, cacheKey, cleanup } = await this._resolveAnalysisTarget(entry);

          let scaReport: ScaReport | null = null;
          if (!forceRefresh) {
            scaReport = await this._getCachedReport(cacheKey, hash);
          } else {
            this._logger.info(`Force refresh enabled; skipping cache for ${analysisPath}`);
          }
          if (!scaReport) {
            this._logger.info(`Analyzing ${analysisPath}`);
            const analyzer = analysisPath.endsWith('.zip') ? sbomAnalyzeZip : sbomAnalyze;
            scaReport = await analyzer(this._context, analysisPath);
            await this._cacheReport(cacheKey, hash, scaReport);
          } else {
            this._logger.info(`Using cached report for ${analysisPath}`);
          }

          const issueStats = this._calculateIssueStats(scaReport);

          report.fileHash = hash;
          report.issueStats = issueStats;
          report.totalIssues = scaReport.length;
          report.status = 'success';

          // Update with success
          if (this._view) {
            this._view.webview.postMessage({
              type: 'sbomAnalysisReportUpdated',
              data: { report },
            });
          }

          if (cleanup) {
            await cleanup();
          }
        } catch (error) {
          this._logger.error(`Error analyzing ${relativeFilePath}: ${error}`);
          // Update with failure
          report.status = 'failed';
          if (this._view) {
            this._view.webview.postMessage({
              type: 'sbomAnalysisReportUpdated',
              data: { report: { depFile: relativeFilePath, status: 'failed' } },
            });
          }
        }
      }

      // Send final completion message
      if (this._view) {
        this._view.webview.postMessage({ type: 'sbomAnalysisCompleted' });
      }
    } catch (error) {
      this._logger.error(`Error during SBOM analysis: ${error}`);

      // 通知webview分析失败
      if (this._view) {
        this._view.webview.postMessage({
          type: 'sbomAnalysisFailed',
          data: {
            error: error instanceof Error ? error.message : String(error),
          },
        });
      }
    } finally {
      this._isAnalyzing = false;
    }
  }

  private async _buildAnalysisEntries(pomFiles: vscode.Uri[]): Promise<AnalysisEntry[]> {
    if (pomFiles.length === 0) {
      return [];
    }

    const pomPathToUri = new Map<string, vscode.Uri>(pomFiles.map((uri) => [uri.fsPath, uri]));
    const pomStructures = new Map<string, { modules: string[]; packaging?: string }>();

    await Promise.all(
      pomFiles.map(async (pomUri) => {
        const structure = await MavenParser.getPomStructure(pomUri);
        pomStructures.set(pomUri.fsPath, structure);
      })
    );

    const childToParent = new Map<string, string>();

    for (const [pomPath, structure] of pomStructures.entries()) {
      for (const module of structure.modules) {
        const modulePomPath = path.join(path.dirname(pomPath), module, 'pom.xml');
        if (pomStructures.has(modulePomPath)) {
          childToParent.set(modulePomPath, pomPath);
        }
      }
    }

    const entries: AnalysisEntry[] = [];
    const processed = new Set<string>();

    for (const [pomPath, structure] of pomStructures.entries()) {
      if (processed.has(pomPath)) {
        continue;
      }

      const pomUri = pomPathToUri.get(pomPath);
      if (!pomUri) {
        continue;
      }

      const isAggregator = structure.packaging === 'pom' && structure.modules.length > 0;
      const hasParent = childToParent.has(pomPath);

      if (isAggregator && !hasParent) {
        const groupPaths = this._collectPomTreePaths(pomPath, pomStructures);
        groupPaths.forEach((pathItem) => processed.add(pathItem));

        const pomUris = groupPaths.map((pathItem) => pomPathToUri.get(pathItem)).filter((uri): uri is vscode.Uri => Boolean(uri));

        entries.push({
          rootPom: pomUri,
          pomUris,
          displayPath: vscode.workspace.asRelativePath(pomUri),
          isAggregate: true,
        });
        continue;
      }

      if (hasParent) {
        processed.add(pomPath);
        continue;
      }

      processed.add(pomPath);
      entries.push({
        rootPom: pomUri,
        pomUris: [pomUri],
        displayPath: vscode.workspace.asRelativePath(pomUri),
        isAggregate: false,
      });
    }

    return entries;
  }

  private _collectPomTreePaths(rootPomPath: string, pomStructures: Map<string, { modules: string[]; packaging?: string }>): string[] {
    const stack = [rootPomPath];
    const collected = new Set<string>();

    while (stack.length > 0) {
      const current = stack.pop();
      if (!current || collected.has(current)) {
        continue;
      }

      collected.add(current);
      const structure = pomStructures.get(current);
      if (!structure || !structure.modules.length) {
        continue;
      }

      for (const module of structure.modules) {
        const modulePomPath = path.join(path.dirname(current), module, 'pom.xml');
        if (pomStructures.has(modulePomPath)) {
          stack.push(modulePomPath);
        }
      }
    }

    return Array.from(collected);
  }

  private async _resolveAnalysisTarget(entry: AnalysisEntry): Promise<{ analysisPath: string; hash: string; cacheKey: string; cleanup?: () => Promise<void> }> {
    if (entry.isAggregate) {
      const moduleUris = entry.pomUris.filter((uri) => uri.fsPath !== entry.rootPom.fsPath);
      const archiveInfo = await this._prepareMultiModuleArchive(entry.rootPom, moduleUris);
      if (archiveInfo) {
        return {
          analysisPath: archiveInfo.zipPath,
          hash: archiveInfo.hash,
          cacheKey: `${entry.rootPom.fsPath}#multi`,
          cleanup: archiveInfo.cleanup,
        };
      }
    }

    const fileContent = await vscode.workspace.fs.readFile(entry.rootPom);
    const hash = crypto.createHash('md5').update(fileContent).digest('hex');

    return {
      analysisPath: entry.rootPom.fsPath,
      hash,
      cacheKey: entry.rootPom.fsPath,
    };
  }

  private _calculateIssueStats(report: ScaReport): { critical: number; high: number; medium: number; low: number; unknown: number } {
    const stats = { critical: 0, high: 0, medium: 0, low: 0, unknown: 0 };
    report.forEach((item) => {
      switch (item.Severity) {
        case 1:
          stats.critical++;
          break;
        case 2:
          stats.high++;
          break;
        case 3:
          stats.medium++;
          break;
        case 4:
          stats.low++;
          break;
        default:
          stats.unknown++;
          break;
      }
    });
    return stats;
  }

  /**
   * 获取缓存的报告
   */
  private async _getCachedReport(filePath: string, fileHash: string): Promise<ScaReport | null> {
    try {
      // 创建缓存目录
      const cacheDir = path.join(this._context.globalStorageUri.fsPath, 'sbom-cache');
      if (!fs.existsSync(cacheDir)) {
        await vscode.workspace.fs.createDirectory(vscode.Uri.file(cacheDir));
      }

      // 查找匹配hash的缓存文件
      const cacheFiles = await vscode.workspace.fs.readDirectory(vscode.Uri.file(cacheDir));
      const matchingFiles = cacheFiles.filter(([name, type]) => type === vscode.FileType.File && name.startsWith(`${fileHash}-`)).map(([name, type]) => name);

      if (matchingFiles.length === 0) {
        return null;
      }

      // 获取最新的缓存文件
      const cacheFileName = matchingFiles.sort().reverse()[0];
      const cacheFilePath = path.join(cacheDir, cacheFileName);

      // 解析时间戳
      const timestamp = parseInt(cacheFileName.split('-')[1]);
      const now = Date.now();

      // 检查是否过期（24小时）
      const oneDay = 24 * 60 * 60 * 1000;
      if (now - timestamp >= oneDay) {
        // 删除过期的缓存文件
        await vscode.workspace.fs.delete(vscode.Uri.file(cacheFilePath));
        return null;
      }

      // 读取缓存文件内容
      const cacheData = await vscode.workspace.fs.readFile(vscode.Uri.file(cacheFilePath));
      const cachedReport: ScaReport = JSON.parse(cacheData.toString());

      return cachedReport;
    } catch (error) {
      this._logger.error(`Error reading cache for ${filePath}: ${error}`);
      return null;
    }
  }

  /**
   * 缓存报告
   */
  private async _cacheReport(filePath: string, fileHash: string, report: ScaReport): Promise<void> {
    try {
      // 创建缓存目录
      const cacheDir = path.join(this._context.globalStorageUri.fsPath, 'sbom-cache');
      if (!fs.existsSync(cacheDir)) {
        await vscode.workspace.fs.createDirectory(vscode.Uri.file(cacheDir));
      }

      // 清理旧的同hash缓存文件
      const cacheFiles = await vscode.workspace.fs.readDirectory(vscode.Uri.file(cacheDir));
      const matchingFiles = cacheFiles.filter(([name, type]) => type === vscode.FileType.File && name.startsWith(`${fileHash}-`)).map(([name, type]) => name);

      for (const oldFile of matchingFiles) {
        await vscode.workspace.fs.delete(vscode.Uri.file(path.join(cacheDir, oldFile)));
      }

      // 创建新的缓存文件
      const timestamp = Date.now();
      const cacheFileName = `${fileHash}-${timestamp}`;
      const cacheFilePath = path.join(cacheDir, cacheFileName);

      // Sort the report before caching
      report.sort((a, b) => {
        if (a.Severity !== b.Severity) {
          return a.Severity - b.Severity;
        }
        const aCve = a.CVEs && a.CVEs.length > 0 ? a.CVEs[0] : '';
        const bCve = b.CVEs && b.CVEs.length > 0 ? b.CVEs[0] : '';
        return bCve.localeCompare(aCve);
      });

      // 写入缓存数据
      const cacheData = JSON.stringify(report);
      await vscode.workspace.fs.writeFile(vscode.Uri.file(cacheFilePath), Buffer.from(cacheData));
    } catch (error) {
      this._logger.error(`Error caching report for ${filePath}: ${error}`);
    }
  }

  /**
   * Send authentication status to webview
   */
  private async _sendAuthStatusToWebview() {
    if (!this._view) return;

    try {
      // Check actual authentication status
      const authManager = ZastAuth.getInstance(this._context);
      const isAuthenticated = await authManager.isAuthenticated();

      this._view.webview.postMessage({
        type: 'authStatusChanged',
        data: {
          isAuthenticated,
        },
      });

      // 如果已认证，自动执行SBOM分析
      if (isAuthenticated) {
        this.performSbomAnalysis();
      }
    } catch (error) {
      this._logger.error(`Error sending auth status to webview: ${error}`);
    }
  }

  /**
   * Handle login success event
   */
  private async _handleLoginSuccess(data: { isAuthenticated: boolean; provider: string }) {
    this._logger.info(`SbomView: User logged in successfully to ${data.provider}`);

    try {
      // Send authentication status update to webview
      if (this._view) {
        this._view.webview.postMessage({
          type: 'authStatusChanged',
          data: {
            isAuthenticated: true,
            provider: data.provider,
            message: `Successfully logged in to ${data.provider}`,
          },
        });

        // 登录成功后自动触发SBOM分析
        this.performSbomAnalysis();
      }
    } catch (error) {
      this._logger.error(`Error handling login success: ${error}`);
    }
  }

  /**
   * Handle logout success event
   */
  private async _handleLogoutSuccess(data: { isAuthenticated: boolean; provider: string }) {
    this._logger.info(`SbomView: User logged out successfully from ${data.provider}`);

    try {
      // Send authentication status update to webview
      if (this._view) {
        this._view.webview.postMessage({
          type: 'authStatusChanged',
          data: {
            isAuthenticated: false,
            provider: data.provider,
            message: `Successfully logged out from ${data.provider}`,
          },
        });

        // 登出后清空分析结果
        this._view.webview.postMessage({
          type: 'sbomAnalysisCompleted',
          data: {
            reports: [],
          },
        });
      }
    } catch (error) {
      this._logger.error(`Error handling logout success: ${error}`);
    }
  }

  /**
   * Handle authentication status change event
   */
  private async _handleAuthStatusChange(data: { isAuthenticated: boolean; provider?: string }) {
    this._logger.info(`SbomView: Auth status changed - ${data.isAuthenticated ? 'authenticated' : 'unauthenticated'}`);

    try {
      // Send authentication status update to webview
      if (this._view) {
        this._view.webview.postMessage({
          type: 'authStatusChanged',
          data: {
            isAuthenticated: data.isAuthenticated,
            provider: data.provider,
          },
        });

        // 如果变为已认证状态，触发SBOM分析
        if (data.isAuthenticated) {
          this.performSbomAnalysis();
        } else {
          // 如果变为未认证状态，发送空结果
          this._view.webview.postMessage({
            type: 'sbomAnalysisCompleted',
            data: {
              reports: [],
            },
          });
        }
      }
    } catch (error) {
      this._logger.error(`Error handling auth status change: ${error}`);
    }
  }

  /**
   * Handle session expiration event
   */
  private async _handleSessionExpired(data: { isAuthenticated: boolean; provider?: string; message?: string }) {
    this._logger.info(`SbomView: Session expired for provider: ${data.provider}`);

    try {
      // Send session expiration notification to webview
      if (this._view) {
        this._view.webview.postMessage({
          type: 'authStatusChanged',
          data: {
            isAuthenticated: false,
            provider: data.provider,
            message: data.message || 'Your login session has expired. Please log in again.',
          },
        });

        // 会话过期后清空分析结果
        this._view.webview.postMessage({
          type: 'sbomAnalysisCompleted',
          data: {
            reports: [],
          },
        });
      }
    } catch (error) {
      this._logger.error(`Error handling session expiration: ${error}`);
    }
  }
}
