import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { setupHtml } from '../utils/setupHtml';
import { WebviewCommunicationHub, MessageTypes } from '../../communication';
import { fetchTaskDetail, TableData } from '../../httpC';
import { ReportViewProvider } from '../reportView/panel';
import { ZastAuth } from '../../auth';
import { getPrefixedLogger } from '../../logger';

const logger = getPrefixedLogger('ProjectTaskView');

interface ProjectTaskRecord {
  taskId: string;
  createdAt: number;
  userId?: string; // Optional for backward compatibility with existing data
}

export class ProjectTaskViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'project-tasks';

  private _view?: vscode.WebviewView;
  private _context: vscode.ExtensionContext;
  private _communicationHub: WebviewCommunicationHub;
  private _auth: ZastAuth;

  constructor(context: vscode.ExtensionContext, communicationHub: WebviewCommunicationHub) {
    this._context = context;
    this._communicationHub = communicationHub;
    this._auth = ZastAuth.getInstance(context);
  }

  public resolveWebviewView(webviewView: vscode.WebviewView, context: vscode.WebviewViewResolveContext, _token: vscode.CancellationToken) {
    logger.info('ProjectTaskViewProvider.resolveWebviewView called');
    this._view = webviewView;

    webviewView.webview.options = {
      // Allow scripts in the webview
      enableScripts: true,
      localResourceRoots: [this._context.extensionUri],
    };

    webviewView.webview.html = setupHtml(webviewView.webview, this._context, 'project-task');

    // Register webview with communication hub
    this._communicationHub.registerWebview('project-tasks', webviewView.webview, this);

    // Listen for task creation events
    this._communicationHub.addEventListener(MessageTypes.TASK_CREATED, async (message) => {
      logger.info(`ProjectTaskViewProvider received task created: ${JSON.stringify(message)}`);
      if (message.data?.taskId) {
        await this.addProjectTask(message.data.taskId);
      }
    });

    // Listen for task status changes
    this._communicationHub.addEventListener(MessageTypes.TASK_STATUS_CHANGED, (message) => {
      logger.info(`ProjectTaskViewProvider received task status changes: ${JSON.stringify(message)}`);
      this._handleTaskStatusChanges(message.data);
    });

    // Listen for authentication events
    this._communicationHub.addEventListener(MessageTypes.AUTH_LOGIN_SUCCESS, (message) => {
      logger.info(`ProjectTaskViewProvider received login success: ${JSON.stringify(message)}`);
      this._handleLoginSuccess(message.data);
    });

    this._communicationHub.addEventListener(MessageTypes.AUTH_LOGOUT_SUCCESS, (message) => {
      logger.info(`ProjectTaskViewProvider received logout success: ${JSON.stringify(message)}`);
      this._handleLogoutSuccess(message.data);
    });

    this._communicationHub.addEventListener(MessageTypes.AUTH_STATUS_CHANGED, (message) => {
      logger.info(`ProjectTaskViewProvider received auth status change: ${JSON.stringify(message)}`);
      this._handleAuthStatusChange(message.data);
    });

    this._communicationHub.addEventListener(MessageTypes.AUTH_SESSION_EXPIRED, (message) => {
      logger.info(`ProjectTaskViewProvider received session expired: ${JSON.stringify(message)}`);
      this._handleSessionExpired(message.data);
    });

    // Handle messages from webview
    webviewView.webview.onDidReceiveMessage(async (message) => {
      switch (message.type) {
        case 'refreshProjectTasks':
          await this._refreshProjectTasks();
          break;
        case 'viewTaskReport':
          this._viewTaskReport(message.data?.data?.taskId);
          break;
        case 'removeProjectTask':
          await this._removeProjectTask(message.data?.data?.taskId);
          break;
      }
    });

    // Set up cleanup on dispose
    webviewView.onDidDispose(() => {
      this._communicationHub.unregisterWebview('project-tasks');
    });

    // Load initial data
    this._loadInitialData();
  }

  private async _loadInitialData() {
    if (!this._view) return;

    try {
      await this._refreshProjectTasks();
      // await this._sendAuthStatusToWebview();
    } catch (error) {
      logger.error(`Error loading initial project task data: ${error}`);
    }
  }

  private async _refreshProjectTasks() {
    const isAuthenticated = await this._auth.isAuthenticated();

    if (!isAuthenticated) {
      this._sendProjectTasksToWebview([]);
      return;
    }

    try {
      const projectTasks = await this.getProjectTasksWithDetails();
      this._sendProjectTasksToWebview(projectTasks);
    } catch (error) {
      logger.error(`Error refreshing project tasks: ${error}`);
      this._sendProjectTasksToWebview([]);
    }
  }

  private _sendProjectTasksToWebview(taskList: TableData[]) {
    if (!this._view) return;

    try {
      this._view.webview.postMessage({
        type: 'updateProjectTasks',
        data: {
          taskList,
          timestamp: Date.now(),
        },
      });
    } catch (error) {
      logger.error(`Error sending project tasks to webview: ${error}`);
    }
  }

  private _viewTaskReport(taskId: string) {
    if (!taskId) return;

    try {
      ReportViewProvider.render(this._context, this._communicationHub, taskId);
    } catch (error) {
      logger.error(`Error opening task report: ${error}`);
      vscode.window.showErrorMessage(`Failed to open task report: ${error}`);
    }
  }

  private async _removeProjectTask(taskId: string) {
    if (!taskId) return;

    try {
      await this.removeProjectTask(taskId);
      await this._refreshProjectTasks();
    } catch (error) {
      logger.error(`Error removing project task: ${error}`);
      vscode.window.showErrorMessage(`Failed to remove project task: ${error}`);
    }
  }

  private async _sendAuthStatusToWebview() {
    if (!this._view) return;

    try {
      const isAuthenticated = await this._auth.isAuthenticated();
      this._view.webview.postMessage({
        type: 'authStatusChanged',
        data: { isAuthenticated },
      });
    } catch (error) {
      logger.error(`Error sending auth status to webview: ${error}`);
    }
  }

  private _handleLoginSuccess(data: any) {
    this._sendAuthStatusToWebview();
    this._refreshProjectTasks();
  }

  private _handleLogoutSuccess(data: any) {
    this._sendAuthStatusToWebview();
    this._sendProjectTasksToWebview([]);
  }

  private _handleSessionExpired(data: { isAuthenticated: boolean; provider?: string; message?: string }) {
    logger.info(`ProjectTaskView: Session expired for provider: ${data.provider}`);

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

      // Clear project tasks
      this._sendProjectTasksToWebview([]);
    } catch (error) {
      logger.error(`Error handling session expiration: ${error}`);
    }
  }

  private _handleAuthStatusChange(data: any) {
    this._sendAuthStatusToWebview();
    if (!data.isAuthenticated) {
      this._sendProjectTasksToWebview([]);
    } else {
      this._refreshProjectTasks();
    }
  }

  /**
   * Handle task status changes
   */
  private _handleTaskStatusChanges(data: any) {
    const logger = getPrefixedLogger('ProjectTaskView');

    if (data?.statusChanges && Array.isArray(data.statusChanges)) {
      logger.info(`Processing ${data.statusChanges.length} task status changes`);

      // Refresh project tasks to show updated data
      this._refreshProjectTasks();
    }
  }

  /**
   * Handle login success
   */

  /**
   * Get project tasks file path
   */
  private getProjectTasksFilePath(): string {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      throw new Error('No workspace folder found');
    }
    return path.join(workspaceFolder.uri.fsPath, 'project-tasks.json');
  }

  /**
   * Get current user ID from stored user info in globalState
   */
  private async getCurrentUserId(): Promise<string | undefined> {
    try {
      const auth = ZastAuth.getInstance(this._context);
      const currentProvider = auth.getCurrentProvider();

      if (!currentProvider) {
        logger.warn('No current authentication provider available');
        return undefined;
      }

      // Get user info key based on current provider type
      const userInfoKey = currentProvider.USER_INFO_KEY;

      // Read user info from globalState instead of making a new request
      const userInfo = await this._context.globalState.get<{ id: string; email: string; name: string }>(userInfoKey);

      if (!userInfo || !userInfo.id) {
        logger.warn('No user info found in globalState');
        return undefined;
      }

      return userInfo.id;
    } catch (error) {
      logger.error(`Error getting current user ID: ${error}`);
      return undefined;
    }
  }

  /**
   * Read project tasks from file (filtered by current user)
   */
  private async getProjectTasks(): Promise<ProjectTaskRecord[]> {
    try {
      const filePath = this.getProjectTasksFilePath();
      logger.info(`Reading project tasks from file: ${filePath}`);
      if (!fs.existsSync(filePath)) {
        return [];
      }

      const content = fs.readFileSync(filePath, 'utf8');
      const allTasks = JSON.parse(content) as ProjectTaskRecord[];

      if (!Array.isArray(allTasks)) {
        return [];
      }

      // Get current user ID
      const currentUserId = await this.getCurrentUserId();

      // If no user ID is available, return empty array for security
      if (!currentUserId) {
        logger.warn('No current user ID available, returning empty task list');
        return [];
      }

      // Filter tasks by current user ID
      const userTasks = allTasks.filter((task) => task.userId === currentUserId);

      return userTasks;
    } catch (error) {
      logger.error(`Error reading project tasks: ${error}`);
      return [];
    }
  }

  /**
   * Save project tasks to file (current user's tasks only - for backward compatibility)
   */
  private async saveProjectTasks(tasks: ProjectTaskRecord[]): Promise<void> {
    try {
      const filePath = this.getProjectTasksFilePath();
      fs.writeFileSync(filePath, JSON.stringify(tasks, null, 2));
    } catch (error) {
      logger.error(`Error saving project tasks: ${error}`);
      throw error;
    }
  }

  /**
   * Read all project tasks from file (not filtered by user)
   */
  private async getAllProjectTasks(): Promise<ProjectTaskRecord[]> {
    try {
      const filePath = this.getProjectTasksFilePath();
      if (!fs.existsSync(filePath)) {
        return [];
      }

      const content = fs.readFileSync(filePath, 'utf8');
      const tasks = JSON.parse(content) as ProjectTaskRecord[];
      return Array.isArray(tasks) ? tasks : [];
    } catch (error) {
      logger.error(`Error reading all project tasks: ${error}`);
      return [];
    }
  }

  /**
   * Save all project tasks to file (including all users' tasks)
   */
  private async saveAllProjectTasks(tasks: ProjectTaskRecord[]): Promise<void> {
    try {
      const filePath = this.getProjectTasksFilePath();
      fs.writeFileSync(filePath, JSON.stringify(tasks, null, 2));
    } catch (error) {
      logger.error(`Error saving all project tasks: ${error}`);
      throw error;
    }
  }

  /**
   * Add a new project task (associated with current user)
   */
  public async addProjectTask(taskId: string): Promise<void> {
    try {
      // Get current user ID
      const currentUserId = await this.getCurrentUserId();
      if (!currentUserId) {
        logger.error('Cannot add project task: No current user ID available');
        throw new Error('Authentication required to add project task');
      }

      // Get all tasks from file (not filtered)
      const allTasks = await this.getAllProjectTasks();

      // Get current user's tasks
      const userTasks = allTasks.filter((task) => task.userId === currentUserId);

      // Check if task already exists for current user
      const existingTaskIndex = userTasks.findIndex((task) => task.taskId === taskId);

      if (existingTaskIndex !== -1) {
        // Update existing task timestamp and ensure userId is set
        const existingTaskInAllTasks = allTasks.findIndex((task) => task.taskId === taskId && task.userId === currentUserId);
        if (existingTaskInAllTasks !== -1) {
          allTasks[existingTaskInAllTasks].createdAt = Date.now();
          allTasks[existingTaskInAllTasks].userId = currentUserId;
        }
      } else {
        // Add new task with user association
        const newTask: ProjectTaskRecord = {
          taskId,
          createdAt: Date.now(),
          userId: currentUserId,
        };
        allTasks.unshift(newTask);
      }

      // Clean up: Keep only the latest 5 records per user
      const tasksByUser = new Map<string, ProjectTaskRecord[]>();
      for (const task of allTasks) {
        const userId = task.userId;
        if (!userId) {
          continue;
        }
        if (!tasksByUser.has(userId)) {
          tasksByUser.set(userId, []);
        }
        tasksByUser.get(userId)!.push(task);
      }

      // Limit each user's tasks to 5 and combine back
      const limitedTasks: ProjectTaskRecord[] = [];
      for (const [userId, tasks] of tasksByUser) {
        tasks.sort((a, b) => b.createdAt - a.createdAt);
        limitedTasks.push(...tasks.slice(0, 5));
      }

      await this.saveAllProjectTasks(limitedTasks);

      logger.info(`Project task added successfully for user ${currentUserId}: ${taskId}`);

      // Refresh the webview
      await this._refreshProjectTasks();
    } catch (error) {
      logger.error(`Error adding project task: ${error}`);
      throw error;
    }
  }

  /**
   * Remove a project task (for current user only)
   */
  public async removeProjectTask(taskId: string): Promise<void> {
    try {
      // Get current user ID
      const currentUserId = await this.getCurrentUserId();
      if (!currentUserId) {
        logger.error('Cannot remove project task: No current user ID available');
        throw new Error('Authentication required to remove project task');
      }

      // Get all tasks from file
      const allTasks = await this.getAllProjectTasks();

      // Remove task only if it belongs to current user or has no userId (for backward compatibility)
      const filteredTasks = allTasks.filter((task) => !(task.taskId === taskId && (task.userId === currentUserId || !task.userId)));

      await this.saveAllProjectTasks(filteredTasks);

      logger.info(`Project task removed successfully for user ${currentUserId}: ${taskId}`);

      // Refresh the webview
      await this._refreshProjectTasks();
    } catch (error) {
      logger.error(`Error removing project task: ${error}`);
      throw error;
    }
  }

  /**
   * Get project tasks with full details
   */
  public async getProjectTasksWithDetails(): Promise<TableData[]> {
    try {
      const tasks = await this.getProjectTasks();
      const tasksWithDetails: TableData[] = [];

      for (const task of tasks) {
        try {
          const detail = await fetchTaskDetail(this._context, task.taskId);
          if (detail) {
            tasksWithDetails.push({
              taskId: detail.taskId,
              lang: detail.lang || 'unknown',
              projectName: detail.projectName || 'Unknown Project',
              taskStatus: detail.taskStatus || 'unknown',
              createdAt: detail.createdAt || new Date(task.createdAt).toISOString(),
              updatedAt: detail.updatedAt || new Date(task.createdAt).toISOString(),
              resultsStat: detail.resultsStat || {
                total: 0,
                lowCount: 0,
                highCount: 0,
                mediumCount: 0,
                criticalCount: 0,
                purchased: 0,
              },
            });
          }
        } catch (error) {
          logger.error(`Error fetching details for task ${task.taskId}: ${error}`);
          // Continue with next task instead of failing completely
        }
      }

      return tasksWithDetails;
    } catch (error) {
      logger.error(`Error getting project tasks with details: ${error}`);
      return [];
    }
  }
}
