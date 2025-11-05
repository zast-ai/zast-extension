import type { Disposable, ExtensionContext, WebviewPanel } from 'vscode';
import { ViewColumn, window, workspace, Uri, Range, Position } from 'vscode';
import * as vscode from 'vscode';
import * as path from 'path';
import { setupHtml } from '../utils/setupHtml';
import { WebviewCommunicationHub, MessageTypes } from '../../communication';
import { ScaReport } from '../../httpC';

export class SbomReportViewProvider {
  public static currentPanel: SbomReportViewProvider | undefined;
  private readonly _panel: WebviewPanel;
  private _disposables: Disposable[] = [];
  private _context: ExtensionContext;
  private _communicationHub: WebviewCommunicationHub;
  private _currentReportId: string | null = null;
  private _currentFileHash: string | null = null;

  private constructor(panel: WebviewPanel, context: ExtensionContext, communicationHub: WebviewCommunicationHub) {
    this._panel = panel;
    this._context = context;
    this._communicationHub = communicationHub;

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    this._panel.webview.html = setupHtml(this._panel.webview, context, 'sbom-report');

    // Register webview with communication hub
    this._communicationHub.registerWebview('sbom-reports', this._panel.webview, this);

    // Setup webview message handlers
    this.setupWebviewHooks();
  }

  public static render(context: ExtensionContext, communicationHub: WebviewCommunicationHub, fileHash: string) {
    if (SbomReportViewProvider.currentPanel) {
      SbomReportViewProvider.currentPanel._panel.reveal(ViewColumn.Beside);
      if (fileHash) {
        SbomReportViewProvider.currentPanel.loadSbomReport(fileHash);
      }
    } else {
      const panel = window.createWebviewPanel('ZastSbomReports', 'SBOM Reports', ViewColumn.Beside, {
        enableScripts: true,
        retainContextWhenHidden: true,
      });

      SbomReportViewProvider.currentPanel = new SbomReportViewProvider(panel, context, communicationHub);
      if (fileHash) {
        SbomReportViewProvider.currentPanel.loadSbomReport(fileHash);
      }
    }
  }

  public setupWebviewHooks() {
    this._panel.webview.onDidReceiveMessage(async (message) => {
      console.log('SbomReportViewProvider message:', message);

      switch (message.type) {
        case 'refreshReports':
          if (this._currentFileHash) {
            await this.loadSbomReport(this._currentFileHash);
          }
          break;
        case 'loadSbomReport':
          await this.loadSbomReport(message.fileHash);
          break;
        case 'openFileAtLine':
          await this.handleOpenFileAtLine(message.data?.data?.filePath, message.data?.data?.lineNumber);
          break;
        case 'openExternalLink':
          if (message.data?.url) {
            vscode.env.openExternal(vscode.Uri.parse(message.data.url));
          }
          break;
        default:
          console.log('Unknown message type:', message.type);
      }
    });
  }

  public async loadSbomReport(fileHash: string) {
    try {
      this._currentFileHash = fileHash;

      // 从缓存中获取报告列表
      const cachedReports = await this._getCachedReports(fileHash);

      if (cachedReports && cachedReports.length > 0) {
        // 发送报告列表数据到前端
        await this._panel.webview.postMessage({
          type: 'updateSbomReport',
          data: {
            reports: cachedReports,
            fileHash,
          },
        });
      } else {
        // 如果缓存中没有找到报告，发送错误信息
        await this._panel.webview.postMessage({
          type: 'updateSbomReport',
          data: {
            reports: [],
            fileHash,
            error: 'No reports found in cache for this file',
          },
        });
      }
    } catch (error) {
      console.error('Error loading SBOM reports:', error);
      await this._panel.webview.postMessage({
        type: 'updateSbomReport',
        data: {
          reports: [],
          fileHash,
          error: (error as Error).message,
        },
      });
    }
  }

  private async _getCachedReports(fileHash: string): Promise<ScaReport | null> {
    try {
      // 创建缓存目录
      const cacheDir = path.join(this._context.globalStorageUri.fsPath, 'sbom-cache');
      try {
        await vscode.workspace.fs.createDirectory(vscode.Uri.file(cacheDir));
      } catch (error) {
        // 目录可能已存在，忽略错误
        console.debug(`Cache directory already exists or could not be created: ${error}`);
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

      // 读取缓存文件内容
      const cacheData = await vscode.workspace.fs.readFile(vscode.Uri.file(cacheFilePath));
      const cachedReport: ScaReport = JSON.parse(cacheData.toString());

      return cachedReport;
    } catch (error) {
      console.error(`Error reading cache for fileHash ${fileHash}: ${error}`);
      return null;
    }
  }

  private async handleOpenFileAtLine(filePath: string, lineNumber: number) {
    try {
      if (!filePath || !lineNumber) {
        console.warn('Invalid file path or line number:', { filePath, lineNumber });
        window.showErrorMessage('Unable to open file: Invalid file path or line number');
        return;
      }

      // Convert line number to 0-based index
      const line = Math.max(0, lineNumber - 1);

      // Resolve the complete file path
      const resolvedFileUri = await this.resolveFilePath(filePath);
      if (!resolvedFileUri) {
        console.warn('Could not resolve file path:', filePath);
        window.showInformationMessage(`File not found: ${filePath}`);
        return;
      }

      // Open the document
      const document = await workspace.openTextDocument(resolvedFileUri);

      // Create position and selection for the target line
      const position = new Position(line, 0);
      const range = new Range(position, position);

      // Show the document and set cursor position with selection
      await window.showTextDocument(document, {
        viewColumn: ViewColumn.One,
        selection: range,
        preview: false,
      });

      console.log(`Successfully opened file ${resolvedFileUri.fsPath} at line ${lineNumber}`);
    } catch (error) {
      console.error('Error opening file:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      window.showWarningMessage(`Unable to open file: ${errorMessage}`);
    }
  }

  private async resolveFilePath(filePath: string): Promise<Uri | null> {
    try {
      // Check if it's already an absolute path
      if (path.isAbsolute(filePath)) {
        const fileUri = Uri.file(filePath);
        try {
          await workspace.fs.stat(fileUri);
          return fileUri;
        } catch {
          // File doesn't exist at absolute path, continue with relative path resolution
        }
      }

      // Get workspace folders
      const workspaceFolders = workspace.workspaceFolders;
      if (!workspaceFolders || workspaceFolders.length === 0) {
        console.warn('No workspace folders found');
        return null;
      }

      // Try to resolve relative to each workspace folder
      for (const folder of workspaceFolders) {
        const resolvedPath = path.resolve(folder.uri.fsPath, filePath);
        const fileUri = Uri.file(resolvedPath);

        try {
          await workspace.fs.stat(fileUri);
          return fileUri;
        } catch {
          // File doesn't exist in this workspace folder, try next one
          continue;
        }
      }

      // If still not found, try to search for the file by name
      const fileName = path.basename(filePath);
      const searchPattern = `**/${fileName}`;

      try {
        const foundFiles = await workspace.findFiles(searchPattern, null, 10);
        if (foundFiles.length > 0) {
          // Return the first match, or try to find the best match
          return this.findBestMatch(foundFiles, filePath);
        }
      } catch (error) {
        console.warn('Error searching for file:', error);
      }

      return null;
    } catch (error) {
      console.error('Error resolving file path:', error);
      return null;
    }
  }

  private findBestMatch(foundFiles: Uri[], originalPath: string): Uri {
    // If only one file found, return it
    if (foundFiles.length === 1) {
      return foundFiles[0];
    }

    // Try to find the best match by comparing path segments
    const originalSegments = originalPath.split('/').filter((s) => s.length > 0);
    let bestMatch = foundFiles[0];
    let bestScore = 0;

    for (const file of foundFiles) {
      const fileSegments = file.fsPath.split(path.sep).filter((s) => s.length > 0);
      let score = 0;

      // Count matching segments from the end
      for (let i = 0; i < Math.min(originalSegments.length, fileSegments.length); i++) {
        const originalSegment = originalSegments[originalSegments.length - 1 - i];
        const fileSegment = fileSegments[fileSegments.length - 1 - i];

        if (originalSegment === fileSegment) {
          score++;
        } else {
          break;
        }
      }

      if (score > bestScore) {
        bestScore = score;
        bestMatch = file;
      }
    }

    return bestMatch;
  }

  public dispose() {
    SbomReportViewProvider.currentPanel = undefined;

    // Clean up resources
    this._panel.dispose();
    this._communicationHub.unregisterWebview('sbom-reports');

    while (this._disposables.length) {
      const disposable = this._disposables.pop();
      if (disposable) {
        disposable.dispose();
      }
    }
  }
}
