import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ZastAuth } from './auth';
import { ZastConfig } from './config';
import { DiscoveryService } from './discovery/DiscoveryService';
import { TunnelManager } from './tunnel';
import { WebviewCommunicationHub, MessageTypes } from './communication';
import { fetchJobList, TableData } from './httpC';
import { getPrefixedLogger } from './logger';
import { StartPanel } from './views/startPanel';
import { MainPanel } from './views/assessView/panel';
import { HomeViewProvider } from './views/sidebar/homeView';
import { TaskViewProvider } from './views/sidebar/taskView';
import { ProjectTaskViewProvider } from './views/sidebar/projectTaskView';
import { HelpViewProvider } from './views/sidebar/helpView';
import { SbomViewProvider } from './views/sidebar/sbomView';
import type { ExtensionContext } from 'vscode';

// Global status bar item
let statusBarItem: vscode.StatusBarItem;

// Task refresh is now event-driven (no timer needed)

// Interface for task status change
interface TaskStatusChange {
  taskId: string;
  oldStatus: string;
  newStatus: string;
  taskDetails: TableData;
}

// Interface for task refresh metadata
interface TaskRefreshMetadata {
  lastRefreshTime: Date;
  previousTaskStatusMap: Map<string, string>;
}

export async function activate(context: ExtensionContext) {
  const logger = getPrefixedLogger('Main');
  const auth = ZastAuth.getInstance(context);
  const discoveryService = DiscoveryService.getInstance();
  const tunnelManager = TunnelManager.getInstance(context);
  const communicationHub = WebviewCommunicationHub.getInstance();

  // Set up communication hub for authentication events
  auth.setCommunicationHub(communicationHub);

  // Create status bar item
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBarItem.command = 'workbench.view.extension.assess-explorer';
  statusBarItem.show();

  // Refresh token on activation
  try {
    logger.info('Refreshing authentication token on activation');
    await auth.refreshToken();
    logger.info('Token refresh successful');

    // Update status bar on activation
    await updateStatusBar(auth, communicationHub);

    // Load and cache task list on activation (only after successful token refresh)
    loadAndCacheTaskList(context, communicationHub);

    // Setup event-driven task refresh (only after successful token refresh)
    setupTaskRefreshEventHandlers(context, communicationHub);
  } catch (error) {
    logger.warn(`Token refresh failed on activation: ${error}`);

    await auth.logout();

    // Update status bar even if token refresh fails
    await updateStatusBar(auth, communicationHub);

    // Don't load tasks or start timer if token refresh fails
    logger.info('Skipping task list loading and timer due to token refresh failure');
  }

  // Check if start panel should be shown for first-time users
  const shouldShowStartPanel = await StartPanel.shouldShowStartPanel(context);

  // Register sidebar view providers
  logger.info('Registering sidebar view providers...');
  const homeViewProvider = new HomeViewProvider(context, auth, discoveryService, tunnelManager, communicationHub);
  const taskViewProvider = new TaskViewProvider(context, communicationHub);
  const projectTaskViewProvider = new ProjectTaskViewProvider(context, communicationHub);
  const helpViewProvider = new HelpViewProvider(context);
  const sbomViewProvider = new SbomViewProvider(context, communicationHub);

  const homeViewProviderRegistration = vscode.window.registerWebviewViewProvider(HomeViewProvider.viewType, homeViewProvider);
  const taskViewProviderRegistration = vscode.window.registerWebviewViewProvider(TaskViewProvider.viewType, taskViewProvider);
  const projectTaskViewProviderRegistration = vscode.window.registerWebviewViewProvider(ProjectTaskViewProvider.viewType, projectTaskViewProvider);
  const helpViewProviderRegistration = vscode.window.registerWebviewViewProvider(HelpViewProvider.viewType, helpViewProvider);
  const sbomViewProviderRegistration = vscode.window.registerWebviewViewProvider(SbomViewProvider.viewType, sbomViewProvider);

  // Register commands
  logger.info('Registering commands...');
  const loginCommand = vscode.commands.registerCommand('zast.login', async () => {
    try {
      logger.info('Login command executed');
      await auth.login();
      vscode.window.showInformationMessage('Login successful');
    } catch (error) {
      logger.error(`Login command failed: ${error}`);
      vscode.window.showErrorMessage(`Login failed: ${error}`);
    }
  });

  const logoutCommand = vscode.commands.registerCommand('zast.logout', async () => {
    try {
      logger.info('Logout command executed');
      await auth.logout();
      vscode.window.showInformationMessage('Logout successful');
    } catch (error) {
      logger.error(`Logout command failed: ${error}`);
      vscode.window.showErrorMessage(`Logout failed: ${error}`);
    }
  });

  const runSbomFullScanCommand = vscode.commands.registerCommand('zast.runSbomFullScan', async () => {
    logger.info('Run SBOM full scan command executed');
    try {
      await sbomViewProvider.runFullScan();
    } catch (error) {
      logger.error(`Run SBOM full scan command failed: ${error}`);
      const message = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(`Failed to rescan SBOM: ${message}`);
    }
  });

  const showStartPageCommand = vscode.commands.registerCommand('zast.showStartPage', async () => {
    try {
      logger.info('Show start panel command executed');
      // Reset start panel state to show it again
      // await StartPanel.resetStartPanelState(context);
      // Render start panel in editor
      StartPanel.render(context, communicationHub, discoveryService, tunnelManager);
      logger.info('Getting Started panel opened in editor');
    } catch (error) {
      logger.error(`Show start panel command failed: ${error}`);
      vscode.window.showErrorMessage(`Failed to show Getting Started guide: ${error}`);
    }
  });

  // Register debug session listener to automatically discover ports
  const debugSessionDisposable = vscode.debug.onDidStartDebugSession(async (session) => {
    logger.info(`Debug session started: ${session.name}`);

    // Try to extract port from debug session configuration
    const port = await extractPortFromDebugSession(session);
    if (port) {
      logger.info(`Auto-discovered port from debug session: ${port}`);

      // Send port update to MainPanel if it exists
      if (MainPanel.currentPanel) {
        MainPanel.currentPanel.sendPortUpdate(port);
        MainPanel.currentPanel.setActivePort(port);
      }

      // Broadcast port update to all webviews
      communicationHub.broadcast({
        type: MessageTypes.TUNNEL_PORT_UPDATED,
        data: { port },
        source: 'debug-session',
      });
    }
  });

  // Set up event-driven authentication status monitoring
  setupAuthStatusEventHandlers(auth, communicationHub);

  // Set up global subscription error handling
  setupSubscriptionErrorHandler(communicationHub);

  // Show start panel for first-time users
  if (shouldShowStartPanel) {
    logger.info('First-time user detected, showing start panel in editor');
    // Show start panel after a short delay to ensure extension is fully activated
    setTimeout(() => {
      StartPanel.render(context, communicationHub, discoveryService, tunnelManager);
    }, 1000);
  }

  context.subscriptions.push(
    statusBarItem,
    homeViewProviderRegistration,
    taskViewProviderRegistration,
    projectTaskViewProviderRegistration,
    helpViewProviderRegistration,
    sbomViewProviderRegistration,
    loginCommand,
    logoutCommand,
    showStartPageCommand,
    runSbomFullScanCommand,
    debugSessionDisposable
  );
}

/**
 * Update the status bar item based on authentication status
 */
async function updateStatusBar(auth: ZastAuth, communicationHub?: WebviewCommunicationHub): Promise<void> {
  const title = ZastConfig.EXTENSION_CONFIG.TITLE;

  try {
    const isAuthenticated = await auth.isAuthenticated();

    // Update context key for menu visibility
    vscode.commands.executeCommand('setContext', 'zast.isAuthenticated', isAuthenticated);

    if (isAuthenticated) {
      // Logged in state - use bright colors and connected icon
      statusBarItem.text = `$(check) ${title}`;
      statusBarItem.tooltip = `${title} - Logged in (Click to open Assess explorer)`;
      statusBarItem.color = new vscode.ThemeColor('statusBarItem.prominentForeground');
      statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.prominentBackground');
    } else {
      // Not logged in state - use muted colors and disconnected icon
      statusBarItem.text = `$(account) ${title}`;
      statusBarItem.tooltip = `${title} - Not logged in (Click to open Assess explorer)`;
      statusBarItem.color = new vscode.ThemeColor('statusBarItem.prominentForeground');
      statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.prominentBackground');
    }

    // Broadcast authentication status change
    if (communicationHub) {
      communicationHub.broadcast({
        type: MessageTypes.AUTH_STATUS_CHANGED,
        data: { isAuthenticated },
        source: 'status-bar',
      });
    }
  } catch (error) {
    // Error state
    statusBarItem.text = `$(shield-x) ${title}`;
    statusBarItem.tooltip = `${title} - Authentication error (Click to open Assess explorer)`;
    statusBarItem.color = new vscode.ThemeColor('statusBarItem.errorForeground');
    statusBarItem.backgroundColor = undefined;

    // Broadcast error state
    if (communicationHub) {
      communicationHub.broadcast({
        type: MessageTypes.SYSTEM_ERROR,
        data: { error: (error as Error).message, context: 'authentication' },
        source: 'status-bar',
      });
    }
  }
}

/**
 * Setup event-driven authentication status monitoring
 */
function setupAuthStatusEventHandlers(auth: ZastAuth, communicationHub: WebviewCommunicationHub): void {
  const logger = getPrefixedLogger('Main');

  // Listen for authentication events and update status bar accordingly
  communicationHub.addEventListener(MessageTypes.AUTH_LOGIN_SUCCESS, async (message) => {
    logger.info('Status bar received login success event');
    await updateStatusBar(auth, communicationHub);
  });

  communicationHub.addEventListener(MessageTypes.AUTH_LOGOUT_SUCCESS, async (message) => {
    logger.info('Status bar received logout success event');
    await updateStatusBar(auth, communicationHub);
  });

  communicationHub.addEventListener(MessageTypes.AUTH_SESSION_EXPIRED, async (message) => {
    logger.info('Status bar received session expired event');
    await updateStatusBar(auth, communicationHub);
  });

  // Also listen for manual auth status changes
  communicationHub.addEventListener(MessageTypes.AUTH_STATUS_CHANGED, async (message) => {
    // Only update if the source is not 'status-bar' to avoid infinite loops
    if (message.source !== 'status-bar') {
      logger.info('Status bar received auth status change event from external source');
      await updateStatusBar(auth, communicationHub);
    }
  });
}

/**
 * Setup global subscription error handling
 */
function setupSubscriptionErrorHandler(communicationHub: WebviewCommunicationHub): void {
  const logger = getPrefixedLogger('Main');

  // Listen for subscription errors globally
  communicationHub.addEventListener(MessageTypes.SUBSCRIPTION_ERROR, async (message) => {
    logger.warn(`Global subscription error handler triggered: ${JSON.stringify(message.data)}`);

    const errorMessage = message.data?.message || 'Subscription required to continue this operation';
    const errorCode = message.data?.errorCode;

    // Show VSCode information message with action buttons
    const action = await vscode.window.showWarningMessage(
      `⚠️ ${errorMessage}`,
      {
        modal: true,
        detail: errorCode ? `Error Code: ${errorCode}` : 'Please upgrade your subscription to access this feature.',
      },
      'Upgrade Subscription',
      'View Subscription'
    );

    // Handle user action
    if (action === 'Upgrade Subscription') {
      // Open upgrade URL or trigger upgrade flow
      try {
        logger.info('User selected upgrade subscription');

        // Broadcast upgrade request to all webviews
        communicationHub.broadcast({
          type: 'upgradeSubscription',
          data: { category: 'pro' },
          source: 'global-subscription-error-handler',
        });
      } catch (error) {
        logger.error(`Failed to trigger upgrade flow: ${error}`);
        vscode.window.showErrorMessage('Failed to open upgrade page. Please try again.');
      }
    } else if (action === 'View Subscription') {
      // Navigate to subscription management
      try {
        logger.info('User selected view subscription');

        // Open the assess explorer to show subscription section
        vscode.commands.executeCommand('workbench.view.extension.assess-explorer');

        // Optionally broadcast a message to focus on subscription section
        communicationHub.broadcast({
          type: 'focusSubscriptionSection',
          data: { focus: true },
          source: 'global-subscription-error-handler',
        });
      } catch (error) {
        logger.error(`Failed to navigate to subscription section: ${error}`);
        vscode.window.showErrorMessage('Failed to open subscription section. Please try again.');
      }
    }
  });

  logger.info('Global subscription error handler setup completed');
}

/**
 * Extract port from debug session configuration
 */
async function extractPortFromDebugSession(session: vscode.DebugSession): Promise<number | null> {
  const config = session.configuration;

  // Check various common port configurations
  if (config.port) {
    return typeof config.port === 'number' ? config.port : parseInt(config.port);
  }

  if (config.env && config.env.SERVER_PORT) {
    return parseInt(config.env.SERVER_PORT);
  }

  if (config.args && typeof config.args === 'string') {
    const args = config.args.split(' ');
    // Look for --server.port or --port arguments
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg.includes('--server.port') || arg.includes('--port')) {
        if (arg.includes('=')) {
          const port = arg.split('=')[1];
          return parseInt(port);
        } else if (i + 1 < args.length) {
          return parseInt(args[i + 1]);
        }
      }
    }
  }

  return null;
}

/**
 * Load and cache task list from the backend
 */
async function loadAndCacheTaskList(context: ExtensionContext, communicationHub: WebviewCommunicationHub) {
  const logger = getPrefixedLogger('Main');
  try {
    // Get previous task status map from cache
    const previousTaskStatusMap = getPreviousTaskStatusMap(context);

    // Record current time
    const currentTime = new Date();

    // Fetch new task list
    const taskList = await fetchJobList(context);

    if (taskList) {
      // Compare with previous status and detect changes
      const statusChanges = compareTaskStatuses(previousTaskStatusMap, taskList);

      // Save task list to cache
      await saveTaskListToCache(context, taskList, currentTime);

      // Notify about status changes
      if (statusChanges.length > 0) {
        logger.info(`Detected ${statusChanges.length} task status changes`);
        await notifyTaskStatusChanges(statusChanges, communicationHub);
      }

      // Broadcast task list update to all webviews
      communicationHub.broadcast({
        type: MessageTypes.TASK_LIST_UPDATED,
        data: { taskList, lastRefreshTime: currentTime.toISOString() },
        source: 'task-list-load',
      });

      logger.info(`Task list loaded successfully with ${taskList.length} tasks`);
    } else {
      logger.warn('No task list data received from backend.');
    }
  } catch (error) {
    logger.error(`Failed to load and cache task list: ${error}`);
    // Broadcast error state
    communicationHub.broadcast({
      type: MessageTypes.SYSTEM_ERROR,
      data: { error: (error as Error).message, context: 'task-list-load' },
      source: 'task-list-load',
    });
  }
}

/**
 * Get previous task status map from cache
 */
function getPreviousTaskStatusMap(context: ExtensionContext): Map<string, string> {
  const logger = getPrefixedLogger('Main');
  const previousTaskStatusMap = new Map<string, string>();

  try {
    const globalStorageUri = context.globalStorageUri;
    if (!globalStorageUri) {
      return previousTaskStatusMap;
    }

    const filePath = path.join(globalStorageUri.fsPath, 'taskList.json');
    if (fs.existsSync(filePath)) {
      const fileContent = fs.readFileSync(filePath, 'utf8');
      const cachedTaskList = JSON.parse(fileContent) as TableData[];

      // Build previous status map
      cachedTaskList.forEach((task) => {
        previousTaskStatusMap.set(task.taskId, task.taskStatus);
      });

      logger.debug(`Loaded ${previousTaskStatusMap.size} previous task statuses from cache`);
    }
  } catch (error) {
    logger.error(`Failed to get previous task status map: ${error}`);
  }

  return previousTaskStatusMap;
}

/**
 * Compare task statuses and detect changes
 */
function compareTaskStatuses(previousTaskStatusMap: Map<string, string>, newTaskList: TableData[]): TaskStatusChange[] {
  const statusChanges: TaskStatusChange[] = [];

  newTaskList.forEach((task) => {
    const previousStatus = previousTaskStatusMap.get(task.taskId);

    // Only check for status changes in existing tasks (ignore new and deleted tasks)
    if (previousStatus && previousStatus !== task.taskStatus) {
      statusChanges.push({
        taskId: task.taskId,
        oldStatus: previousStatus,
        newStatus: task.taskStatus,
        taskDetails: task,
      });
    }
  });

  return statusChanges;
}

/**
 * Save task list to cache with metadata
 */
async function saveTaskListToCache(context: ExtensionContext, taskList: TableData[], refreshTime: Date) {
  const logger = getPrefixedLogger('Main');
  try {
    const globalStorageUri = context.globalStorageUri;
    if (!globalStorageUri) {
      logger.warn('Global storage URI not available. Cannot cache task list.');
      return;
    }

    // Ensure the directory exists
    const dirPath = globalStorageUri.fsPath;
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }

    // Save task list
    const taskListPath = path.join(dirPath, 'taskList.json');
    fs.writeFileSync(taskListPath, JSON.stringify(taskList, null, 2));

    // Save metadata
    const metadataPath = path.join(dirPath, 'taskListMetadata.json');
    const metadata: TaskRefreshMetadata = {
      lastRefreshTime: refreshTime,
      previousTaskStatusMap: new Map(taskList.map((task) => [task.taskId, task.taskStatus])),
    };

    // Convert Map to object for JSON serialization
    const metadataForSave = {
      lastRefreshTime: refreshTime,
      previousTaskStatusMap: Object.fromEntries(metadata.previousTaskStatusMap),
    };

    fs.writeFileSync(metadataPath, JSON.stringify(metadataForSave, null, 2));

    logger.info(`Task list cached successfully at: ${taskListPath}`);
  } catch (error) {
    logger.error(`Failed to save task list to cache: ${error}`);
  }
}

/**
 * Notify about task status changes
 */
async function notifyTaskStatusChanges(statusChanges: TaskStatusChange[], communicationHub: WebviewCommunicationHub) {
  const logger = getPrefixedLogger('Main');

  // Group changes by status for better notification
  const statusChangeGroups = statusChanges.reduce((groups, change) => {
    const key = `${change.oldStatus}->${change.newStatus}`;
    if (!groups[key]) {
      groups[key] = [];
    }
    groups[key].push(change);
    return groups;
  }, {} as Record<string, TaskStatusChange[]>);

  // Create notification message
  const notificationMessages: string[] = [];

  Object.entries(statusChangeGroups).forEach(([statusTransition, changes]) => {
    if (changes.length === 1) {
      const change = changes[0];
      notificationMessages.push(`Task "${change.taskDetails.projectName}" status changed from ${change.oldStatus} to ${change.newStatus}`);
    } else {
      notificationMessages.push(`${changes.length} tasks status changed from ${statusTransition.split('->')[0]} to ${statusTransition.split('->')[1]}`);
    }
  });

  // Show notification to user
  if (notificationMessages.length > 0) {
    const message = notificationMessages.join('\n');
    logger.info(`Task status changes: ${message}`);

    // Show VS Code notification
    vscode.window
      .showInformationMessage(`Task Status Update: ${notificationMessages.length === 1 ? notificationMessages[0] : `${statusChanges.length} tasks have status changes`}`, 'View Tasks')
      .then((selection) => {
        if (selection === 'View Tasks') {
          vscode.commands.executeCommand('workbench.view.extension.zast-explorer');
        }
      });

    communicationHub.broadcast({
      type: MessageTypes.TASK_STATUS_CHANGED,
      data: { statusChanges },
      source: 'task-status-monitor',
    });
  }
}

/**
 * Load and cache task list from the backend (exported version)
 */
export async function loadAndCacheTaskListExported(context: ExtensionContext, communicationHub: WebviewCommunicationHub) {
  return loadAndCacheTaskList(context, communicationHub);
}

/**
 * Get cached task list from globalStorageUri
 */
export function getCachedTaskList(context: ExtensionContext): TableData[] {
  const logger = getPrefixedLogger('Main');
  try {
    const globalStorageUri = context.globalStorageUri;
    if (!globalStorageUri) {
      logger.warn('Global storage URI not available. Cannot get cached task list.');
      return [];
    }

    const filePath = path.join(globalStorageUri.fsPath, 'taskList.json');
    if (!fs.existsSync(filePath)) {
      logger.warn('Task list cache file does not exist.');
      return [];
    }

    const fileContent = fs.readFileSync(filePath, 'utf8');
    const taskList = JSON.parse(fileContent) as TableData[];
    logger.info(`Successfully loaded ${taskList.length} tasks from cache.`);
    return taskList;
  } catch (error) {
    logger.error(`Failed to get cached task list: ${error}`);
    return [];
  }
}

/**
 * Get the last task list refresh time from cache
 */
export function getLastTaskListRefreshTime(context: ExtensionContext): Date | null {
  const logger = getPrefixedLogger('Main');
  try {
    const globalStorageUri = context.globalStorageUri;
    if (!globalStorageUri) {
      logger.warn('Global storage URI not available. Cannot get last refresh time.');
      return null;
    }

    const metadataPath = path.join(globalStorageUri.fsPath, 'taskListMetadata.json');
    if (!fs.existsSync(metadataPath)) {
      logger.warn('Task list metadata file does not exist.');
      return null;
    }

    const metadataContent = fs.readFileSync(metadataPath, 'utf8');
    const metadata = JSON.parse(metadataContent);

    if (metadata.lastRefreshTime) {
      return new Date(metadata.lastRefreshTime);
    }

    return null;
  } catch (error) {
    logger.error(`Failed to get last refresh time: ${error}`);
    return null;
  }
}

/**
 * Manually trigger task list refresh
 */
export async function refreshTaskListManually(context: ExtensionContext, communicationHub: WebviewCommunicationHub) {
  const logger = getPrefixedLogger('Main');
  logger.info('Manually triggering task list refresh...');
  await loadAndCacheTaskList(context, communicationHub);
  logger.info('Manual task list refresh complete.');
}

/**
 * Start the task refresh timer.
 */
/**
 * Setup event-driven task refresh
 */
function setupTaskRefreshEventHandlers(context: ExtensionContext, communicationHub: WebviewCommunicationHub): void {
  const logger = getPrefixedLogger('Main');

  // Listen for authentication events that should trigger task refresh
  communicationHub.addEventListener(MessageTypes.AUTH_LOGIN_SUCCESS, async (message) => {
    logger.info('Task refresh triggered by login success');
    await loadAndCacheTaskList(context, communicationHub);
  });

  // Listen for specific task events that might require list refresh
  communicationHub.addEventListener(MessageTypes.TASK_CREATED, async (message) => {
    logger.info('Task refresh triggered by task creation');
    await loadAndCacheTaskList(context, communicationHub);
  });

  logger.info('Task refresh event handlers setup completed');
}

export function deactivate() {
  // Clean up singleton instances
  ZastAuth.resetInstance();
  WebviewCommunicationHub.resetInstance();
  if (statusBarItem) {
    statusBarItem.dispose();
  }
}
