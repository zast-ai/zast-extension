import type { Disposable, ExtensionContext, WebviewPanel } from 'vscode';
import { ViewColumn, window, workspace, Uri, Range, Position, commands, TextEditorRevealType } from 'vscode';
import * as vscode from 'vscode';
import * as path from 'path';
import { setupHtml } from '../utils/setupHtml';
import { WebviewCommunicationHub, MessageTypes } from '../../communication';
import { fetchIssuesList, fetchPocDetail, fetchTaskDetail, Issue, PocDetail } from '../../httpC';
import { PocExecutor, PocExecutionResult } from '../../pocExecutor';

export class ReportViewProvider {
  public static currentPanel: ReportViewProvider | undefined;
  private readonly _panel: WebviewPanel;
  private _disposables: Disposable[] = [];
  private _context: ExtensionContext;
  private _communicationHub: WebviewCommunicationHub;
  private _currentTaskId: string | null = null;

  private constructor(panel: WebviewPanel, context: ExtensionContext, communicationHub: WebviewCommunicationHub) {
    this._panel = panel;
    this._context = context;
    this._communicationHub = communicationHub;

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    this._panel.webview.html = setupHtml(this._panel.webview, context, 'report');

    // Register webview with communication hub
    this._communicationHub.registerWebview('reports', this._panel.webview, this);

    // Setup webview message handlers
    this.setupWebviewHooks();
  }

  public static render(context: ExtensionContext, communicationHub: WebviewCommunicationHub, taskId?: string) {
    if (ReportViewProvider.currentPanel) {
      ReportViewProvider.currentPanel._panel.reveal(ViewColumn.Beside);
      if (taskId) {
        ReportViewProvider.currentPanel.loadTaskReports(taskId);
      }
    } else {
      const panel = window.createWebviewPanel('ZastReports', 'Security Reports', ViewColumn.Beside, {
        enableScripts: true,
        retainContextWhenHidden: true,
      });

      ReportViewProvider.currentPanel = new ReportViewProvider(panel, context, communicationHub);
      if (taskId) {
        ReportViewProvider.currentPanel.loadTaskReports(taskId);
        ReportViewProvider.currentPanel.handleFetchTaskDetail(taskId);
      }
    }
  }

  public setupWebviewHooks() {
    this._panel.webview.onDidReceiveMessage(async (message) => {
      console.log('ReportViewProvider message:', message);

      switch (message.type) {
        case 'refreshReports':
          if (this._currentTaskId) {
            await this.loadTaskReports(this._currentTaskId);
          }
          break;
        case 'loadTaskReports':
          await this.loadTaskReports(message.taskId);
          break;
        case 'fetchIssueDetail':
          await this.handleFetchIssueDetail(message.data?.data?.taskId, message.data?.data?.vulId);
          break;
        case 'openFileAtLine':
          await this.handleOpenFileAtLine(message.data?.data?.filePath, message.data?.data?.lineNumber);
          break;
        case 'executePocScript':
          await this.handleExecutePocScript(message.data?.data?.pocScript, message.data?.data?.vulId);
          break;
        default:
          console.log('Unknown message type:', message.type);
      }
    });
  }

  public async loadTaskReports(taskId: string) {
    try {
      this._currentTaskId = taskId;

      // Fetch issues list
      const { data: issues, total } = await fetchIssuesList(this._context, taskId);

      // Send issues to frontend
      await this._panel.webview.postMessage({
        type: 'updateIssues',
        data: {
          issues,
          total,
          taskId,
        },
      });

      // Broadcast reports updated event
      this._communicationHub.broadcast({
        type: MessageTypes.REPORTS_UPDATED,
        data: { taskId, issueCount: total },
        source: 'reports',
      });
    } catch (error) {
      console.error('Error loading task reports:', error);
      await this._panel.webview.postMessage({
        type: 'updateIssues',
        data: {
          issues: [],
          total: 0,
          taskId,
          error: (error as Error).message,
        },
      });
    }
  }

  private async handleFetchIssueDetail(taskId: string, vulId: string) {
    try {
      const pocDetail = await fetchPocDetail(this._context, taskId, vulId);

      await this._panel.webview.postMessage({
        type: 'updateIssueDetail',
        data: {
          vulId,
          detail: pocDetail,
        },
      });
    } catch (error) {
      console.error('Error fetching issue detail:', error);
      await this._panel.webview.postMessage({
        type: 'updateIssueDetail',
        data: {
          vulId,
          error: (error as Error).message,
        },
      });
    }
  }

  private async handleFetchTaskDetail(taskId: string) {
    try {
      const taskDetail = await fetchTaskDetail(this._context, taskId);
      await this._panel.webview.postMessage({
        type: 'initTaskDetail',
        data: {
          taskId,
          detail: taskDetail,
        },
      });
    } catch (error) {
      console.error('Error fetching task detail:', error);
      await this._panel.webview.postMessage({
        type: 'initTaskDetail',
        data: {
          taskId,
          error: (error as Error).message,
        },
      });
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

  /**
   * Alternative method using VSCode's built-in commands for native file jumping
   * This method uses the editor.action.revealDefinition pattern which mimics VSCode's native file:line behavior
   */
  private async handleOpenFileAtLineNative(filePath: string, lineNumber: number) {
    try {
      if (!filePath || !lineNumber) {
        console.warn('Invalid file path or line number:', { filePath, lineNumber });
        window.showErrorMessage('Unable to open file: Invalid file path or line number');
        return;
      }

      // Resolve the complete file path
      const resolvedFileUri = await this.resolveFilePath(filePath);
      if (!resolvedFileUri) {
        console.warn('Could not resolve file path:', filePath);
        window.showInformationMessage(`File not found: ${filePath}`);
        return;
      }

      // Open the document first
      const document = await workspace.openTextDocument(resolvedFileUri);

      // Use editor.action.goToDeclaration-like behavior with revealRange
      const line = Math.max(0, lineNumber - 1);
      const position = new Position(line, 0);
      const range = new Range(position, position);

      const editor = await window.showTextDocument(document, {
        viewColumn: ViewColumn.One,
        selection: range,
        preview: false,
      });

      // Reveal the range in the center of the editor (like VSCode's native behavior)
      editor.revealRange(range, TextEditorRevealType.InCenter);

      console.log(`Successfully opened file ${resolvedFileUri.fsPath} at line ${lineNumber} using native method`);

      // Show success message
      window.showInformationMessage(`Opened ${path.basename(resolvedFileUri.fsPath)} at line ${lineNumber}`);
    } catch (error) {
      console.error('Error opening file with native method:', error);
      // Fallback to the standard method if this fails
      await this.handleOpenFileAtLine(filePath, lineNumber);
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

  private async handleExecutePocScript(pocScript: string, vulId: string) {
    try {
      if (!pocScript || !pocScript.trim()) {
        console.warn('POC script is empty or invalid');
        await this._panel.webview.postMessage({
          type: 'pocExecutionResult',
          data: {
            vulId,
            success: false,
            message: 'POC script is empty or invalid',
            hasCodeRunner: false,
          },
        });
        return;
      }

      // Execute POC script with automatic cleanup
      const result: PocExecutionResult = await PocExecutor.executePocScriptWithCleanup(pocScript);

      // Send result back to webview
      await this._panel.webview.postMessage({
        type: 'pocExecutionResult',
        data: {
          vulId,
          success: result.success,
          message: result.message,
          hasCodeRunner: result.hasCodeRunner,
        },
      });

      // Show notification to user
      if (result.success) {
        window.showInformationMessage(result.message);
      } else {
        if (!result.hasCodeRunner) {
          window.showWarningMessage(result.message, 'Install Code Runner').then((action) => {
            if (action === 'Install Code Runner') {
              vscode.commands.executeCommand('extension.open', 'formulahendry.code-runner');
            }
          });
        } else {
          window.showErrorMessage(result.message);
        }
      }
    } catch (error) {
      console.error('Error executing POC script:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);

      await this._panel.webview.postMessage({
        type: 'pocExecutionResult',
        data: {
          vulId,
          success: false,
          message: `Error executing POC script: ${errorMessage}`,
          hasCodeRunner: true,
        },
      });

      window.showErrorMessage(`Failed to execute POC script: ${errorMessage}`);
    }
  }

  public dispose() {
    ReportViewProvider.currentPanel = undefined;

    // Clean up resources
    this._panel.dispose();
    this._communicationHub.unregisterWebview('reports');

    while (this._disposables.length) {
      const disposable = this._disposables.pop();
      if (disposable) {
        disposable.dispose();
      }
    }
  }
}
