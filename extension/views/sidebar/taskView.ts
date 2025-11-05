import * as vscode from 'vscode';
import { setupHtml } from '../utils/setupHtml';
import { WebviewCommunicationHub, MessageTypes } from '../../communication';
import { getCachedTaskList } from '../../index';
import { TableData } from '../../httpC';
import { ReportViewProvider } from '../reportView/panel';
import { ZastAuth } from '../../auth';
import { getPrefixedLogger } from '../../logger';

export class TaskViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'tasks';

  private _view?: vscode.WebviewView;
  private _context: vscode.ExtensionContext;
  private _communicationHub: WebviewCommunicationHub;
  private _auth: ZastAuth;
  private _logger = getPrefixedLogger('TaskViewProvider');

  constructor(context: vscode.ExtensionContext, communicationHub: WebviewCommunicationHub) {
    this._context = context;
    this._communicationHub = communicationHub;
    this._auth = ZastAuth.getInstance(context);
  }

  public resolveWebviewView(webviewView: vscode.WebviewView, context: vscode.WebviewViewResolveContext, _token: vscode.CancellationToken) {
    this._logger.info('TaskViewProvider.resolveWebviewView called');
    this._view = webviewView;

    webviewView.webview.options = {
      // Allow scripts in the webview
      enableScripts: true,
      localResourceRoots: [this._context.extensionUri],
    };

    webviewView.webview.html = setupHtml(webviewView.webview, this._context, 'task');

    // Register webview with communication hub
    this._communicationHub.registerWebview('tasks', webviewView.webview, this);

    // Listen for task list updates
    this._communicationHub.addEventListener(MessageTypes.TASK_LIST_UPDATED, (message) => {
      this._logger.info(`TaskViewProvider received task list update: ${JSON.stringify(message)}`);
      this._sendTaskListToWebview(message.data?.taskList || []);
    });

    // Listen for task creation events
    this._communicationHub.addEventListener(MessageTypes.TASK_CREATED, async (message) => {
      this._logger.info(`TaskViewProvider received task created: ${JSON.stringify(message)}`);
      if (message.data?.taskId) {
        // Refresh task list when a new task is created
        await this._refreshTaskList();
      }
    });

    // Listen for task status changes
    this._communicationHub.addEventListener(MessageTypes.TASK_STATUS_CHANGED, (message) => {
      this._logger.info(`TaskViewProvider received task status changes: ${JSON.stringify(message)}`);
      this._handleTaskStatusChanges(message.data);
    });

    // Listen for authentication events
    this._communicationHub.addEventListener(MessageTypes.AUTH_LOGIN_SUCCESS, (message) => {
      this._logger.info(`TaskViewProvider received login success: ${JSON.stringify(message)}`);
      this._handleLoginSuccess(message.data);
    });

    this._communicationHub.addEventListener(MessageTypes.AUTH_LOGOUT_SUCCESS, (message) => {
      this._logger.info(`TaskViewProvider received logout success: ${JSON.stringify(message)}`);
      this._handleLogoutSuccess(message.data);
    });

    this._communicationHub.addEventListener(MessageTypes.AUTH_STATUS_CHANGED, (message) => {
      this._logger.info(`TaskViewProvider received auth status change: ${JSON.stringify(message)}`);
      this._handleAuthStatusChange(message.data);
    });

    this._communicationHub.addEventListener(MessageTypes.AUTH_SESSION_EXPIRED, (message) => {
      this._logger.info(`TaskViewProvider received session expired: ${JSON.stringify(message)}`);
      this._handleSessionExpired(message.data);
    });

    // Handle messages from webview
    webviewView.webview.onDidReceiveMessage((message) => {
      switch (message.type) {
        case 'refreshTaskList':
          this._refreshTaskList();
          break;
        case 'viewTaskReport':
          this._viewTaskReport(message.data?.data?.taskId);
          break;
      }
    });

    // Set up cleanup on dispose
    webviewView.onDidDispose(() => {
      this._communicationHub.unregisterWebview('tasks');
    });

    // Load initial task stats and task list
    this._loadInitialData();
  }

  private async _loadInitialData() {
    if (!this._view) return;

    const isAuthenticated = await this._auth.isAuthenticated();

    if (!isAuthenticated) {
      this._sendTaskListToWebview([]);
      return;
    }

    try {
      const taskList = getCachedTaskList(this._context);
      this._sendTaskListToWebview(taskList);

      // Send initial authentication status
      await this._sendAuthStatusToWebview();
    } catch (error) {
      this._logger.error(`Error loading initial task data: ${error}`);
    }
  }

  private _sendTaskListToWebview(taskList: TableData[]) {
    if (!this._view) return;

    try {
      this._view.webview.postMessage({
        type: 'updateTaskList',
        data: {
          taskList,
          timestamp: Date.now(),
        },
      });
    } catch (error) {
      this._logger.error(`Error sending task list to webview: ${error}`);
    }
  }

  private async _refreshTaskList() {
    const isAuthenticated = await this._auth.isAuthenticated();

    if (!isAuthenticated) {
      this._sendTaskListToWebview([]);
      return;
    }

    try {
      // Reload task list from backend
      const { fetchJobList } = await import('../../httpC');
      const taskList = await fetchJobList(this._context);

      if (taskList && taskList.length > 0) {
        // Cache the new task list
        const { loadAndCacheTaskListExported } = await import('../../index');
        await loadAndCacheTaskListExported(this._context, this._communicationHub);
      }
    } catch (error) {
      this._logger.error(`Error refreshing task list: ${error}`);
      vscode.window.showErrorMessage(`Failed to refresh task list: ${error}`);
    }
  }

  private _viewTaskReport(taskId: string) {
    if (!taskId) {
      this._logger.error('No taskId provided for viewing report');
      return;
    }

    this._logger.info(`Opening report for task: ${taskId}`);

    // Open the report view with the specified task ID
    ReportViewProvider.render(this._context, this._communicationHub, taskId);
  }

  /**
   * Handle task status changes
   */
  private _handleTaskStatusChanges(data: any) {
    if (data?.statusChanges && Array.isArray(data.statusChanges)) {
      const taskList = getCachedTaskList(this._context);
      this._sendTaskListToWebview(taskList);
    }
  }

  /**
   * Send authentication status to webview
   */
  private async _sendAuthStatusToWebview() {
    if (!this._view) return;

    try {
      const isAuthenticated = await this._auth.isAuthenticated();

      this._view.webview.postMessage({
        type: 'authStatusChanged',
        data: {
          isAuthenticated,
        },
      });
    } catch (error) {
      this._logger.error(`Error sending auth status to webview: ${error}`);
    }
  }

  /**
   * Handle login success event
   */
  private async _handleLoginSuccess(data: { isAuthenticated: boolean; provider: string }) {
    this._logger.info(`TaskView: User logged in successfully to ${data.provider}`);

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
      }
    } catch (error) {
      this._logger.error(`Error handling login success: ${error}`);
    }
  }

  /**
   * Handle logout success event
   */
  private async _handleLogoutSuccess(data: { isAuthenticated: boolean; provider: string }) {
    this._logger.info(`TaskView: User logged out successfully from ${data.provider}`);

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
      }
    } catch (error) {
      this._logger.error(`Error handling logout success: ${error}`);
    }
  }

  /**
   * Handle authentication status change event
   */
  private async _handleAuthStatusChange(data: { isAuthenticated: boolean; provider?: string }) {
    this._logger.info(`TaskView: Auth status changed - ${data.isAuthenticated ? 'authenticated' : 'unauthenticated'}`);

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
      }
    } catch (error) {
      this._logger.error(`Error handling auth status change: ${error}`);
    }
  }

  /**
   * Handle session expiration event
   */
  private async _handleSessionExpired(data: { isAuthenticated: boolean; provider?: string; message?: string }) {
    this._logger.info(`TaskView: Session expired for provider: ${data.provider}`);

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
      }
    } catch (error) {
      this._logger.error(`Error handling session expiration: ${error}`);
    }
  }
}
