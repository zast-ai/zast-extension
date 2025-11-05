import * as vscode from 'vscode';
import { ZastAuth } from '../../auth';
import { DiscoveryService } from '../../discovery/DiscoveryService';
import { TunnelManager } from '../../tunnel';
import { MainPanel } from '../assessView/panel';
import { setupHtml } from '../utils/setupHtml';
import { WebviewCommunicationHub, MessageTypes } from '../../communication';
import { getCachedTaskList } from '../../index';
import { TableData } from '../../httpC';
import { ZastConfig } from '../../config';
import { getPrefixedLogger } from '../../logger';
import { SubscriptionManager, SubscriptionStatus } from '../../subscriptionManager';

export class HomeViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'home';

  private _view?: vscode.WebviewView;
  private _context: vscode.ExtensionContext;
  private _auth: ZastAuth;
  private _discoveryService: DiscoveryService;
  private _tunnelManager: TunnelManager;
  private _communicationHub: WebviewCommunicationHub;
  private _subscriptionManager: SubscriptionManager;
  private _activeTunnels: Map<number, string> = new Map(); // Store active tunnels: port -> url
  private _logger = getPrefixedLogger('HomeViewProvider');

  constructor(context: vscode.ExtensionContext, auth: ZastAuth, discoveryService: DiscoveryService, tunnelManager: TunnelManager, communicationHub: WebviewCommunicationHub) {
    this._context = context;
    this._auth = auth;
    this._discoveryService = discoveryService;
    this._tunnelManager = tunnelManager;
    this._communicationHub = communicationHub;
    this._subscriptionManager = SubscriptionManager.getInstance(context);
    // Register communication hub with subscription manager
    this._subscriptionManager.setCommunicationHub(communicationHub);
  }

  public resolveWebviewView(webviewView: vscode.WebviewView, context: vscode.WebviewViewResolveContext, _token: vscode.CancellationToken) {
    this._logger.info('HomeViewProvider.resolveWebviewView called');
    this._view = webviewView;

    webviewView.webview.options = {
      // Allow scripts in the webview
      enableScripts: true,
      localResourceRoots: [this._context.extensionUri],
    };

    webviewView.webview.html = setupHtml(webviewView.webview, this._context, 'home');

    // Register webview with communication hub
    this._communicationHub.registerWebview('home', webviewView.webview, this);

    // Listen for task list updates
    this._communicationHub.addEventListener(MessageTypes.TASK_LIST_UPDATED, (message) => {
      this._logger.info(`HomeViewProvider received task list update: ${JSON.stringify(message)}`);
      // this._sendTaskListToWebview(message.data?.taskList || []);
      this._handleTaskStatusChanges();
    });

    // Listen for task creation events
    this._communicationHub.addEventListener(MessageTypes.TASK_CREATED, async (message) => {
      this._logger.info(`HomeViewProvider received task created: ${JSON.stringify(message)}`);
      if (message.data?.taskId) {
        // Update assess status when a new task is created
        await this._updateAssessStatus();
      }
    });

    // Listen for task status changes
    this._communicationHub.addEventListener(MessageTypes.TASK_STATUS_CHANGED, (message) => {
      this._logger.info(`HomeViewProvider received task status changes: ${JSON.stringify(message)}`);
      this._handleTaskStatusChanges();
    });

    // Listen for tunnel created events
    this._communicationHub.addEventListener(MessageTypes.TUNNEL_CREATED, (message) => {
      this._logger.info(`HomeViewProvider received tunnel created: ${JSON.stringify(message)}`);
      const { url, port } = message.data;
      this._activeTunnels.set(port, url);
      this._sendTunnelInfoToWebview();
    });

    // Listen for tunnel stopped events
    this._communicationHub.addEventListener(MessageTypes.TUNNEL_STOPPED, (message) => {
      this._logger.info(`HomeViewProvider received tunnel stopped: ${JSON.stringify(message)}`);
      const { port } = message.data;
      this._activeTunnels.delete(port);
      this._sendTunnelInfoToWebview();
    });

    // Listen for authentication events
    this._communicationHub.addEventListener(MessageTypes.AUTH_LOGIN_SUCCESS, (message) => {
      this._logger.info(`HomeViewProvider received login success: ${JSON.stringify(message)}`);
      this._handleLoginSuccess(message.data);
      // Send user info after login
      this._sendUserInfoToWebview();
    });

    this._communicationHub.addEventListener(MessageTypes.AUTH_LOGOUT_SUCCESS, (message) => {
      this._logger.info(`HomeViewProvider received logout success: ${JSON.stringify(message)}`);
      this._handleLogoutSuccess(message.data);
    });

    this._communicationHub.addEventListener(MessageTypes.AUTH_STATUS_CHANGED, (message) => {
      this._logger.info(`HomeViewProvider received auth status change: ${JSON.stringify(message)}`);
      this._handleAuthStatusChange(message.data);
      // Send user info when auth status changes
      this._sendUserInfoToWebview();
    });

    this._communicationHub.addEventListener(MessageTypes.AUTH_SESSION_EXPIRED, (message) => {
      this._logger.info(`HomeViewProvider received session expired: ${JSON.stringify(message)}`);
      this._handleSessionExpired(message.data);
    });

    // Listen for subscription events
    this._communicationHub.addEventListener(MessageTypes.SUBSCRIPTION_STATUS_CHANGED, (message) => {
      this._logger.info(`HomeViewProvider received subscription status change: ${JSON.stringify(message)}`);
      this._handleSubscriptionStatusChange(message.data);
    });

    this._communicationHub.addEventListener(MessageTypes.SUBSCRIPTION_CREDIT_LIMIT_CHANGED, (message) => {
      this._logger.info(`HomeViewProvider received credit limit change: ${JSON.stringify(message)}`);
      this._handleSubscriptionCreditLimitChange(message.data);
    });

    this._communicationHub.addEventListener(MessageTypes.SUBSCRIPTION_ERROR, (message) => {
      this._logger.info(`HomeViewProvider received subscription error: ${JSON.stringify(message)}`);
      this._handleSubscriptionError(message.data);
    });

    // Listen for payment events
    this._communicationHub.addEventListener(MessageTypes.PAYMENT_SUCCESS, (message) => {
      this._logger.info(`HomeViewProvider received payment success: ${JSON.stringify(message)}`);
      this._handlePaymentSuccessEvent(message.data);
    });

    this._communicationHub.addEventListener(MessageTypes.PAYMENT_CANCELLED, (message) => {
      this._logger.info(`HomeViewProvider received payment cancelled: ${JSON.stringify(message)}`);
      this._handlePaymentCancelledEvent(message.data);
    });

    // Handle messages from webview
    webviewView.webview.onDidReceiveMessage((message) => {
      this._logger.info(`HomeViewProvider.onDidReceiveMessage called: ${JSON.stringify(message)}`);
      switch (message.type) {
        case 'newAssess':
          this._handleNewAssess();
          break;
        case 'refreshStatus':
          this._updateAssessStatus();
          break;
        case 'refreshTaskList':
          this._refreshTaskList();
          break;
        case 'stopTunnel':
          this._handleStopTunnel(message.data.port);
          break;
        case 'refreshTunnelInfo':
          this._sendTunnelInfoToWebview();
          break;
        case 'openTunnelUrl':
          this._handleOpenTunnelUrl(message.data.url);
          break;
        case 'openZastWebsite':
          this._handleOpenZastWebsite();
          break;
        case 'login':
          this._handleLogin();
          break;
        case 'logout':
          this._handleLogout();
          break;
        case 'refreshSubscriptionStatus':
          this._handleRefreshSubscriptionStatus();
          break;
        case 'upgradeSubscription':
          this._handleUpgradeSubscription(message.data.data.category);
          break;
        case 'manageSubscription':
          this._handleManageSubscription();
          break;
        case 'getUserInfo':
          this._sendUserInfoToWebview();
          break;
      }
    });

    // Set up cleanup on dispose
    webviewView.onDidDispose(() => {
      this._communicationHub.unregisterWebview('home');
    });

    this._auth.isAuthenticated().then((isAuthenticated) => {
      if (isAuthenticated) {
        this._updateAssessStatus();
        this._updateSubscriptionStatus();
        // this._sendInitialTaskList();
        this._sendTunnelInfoToWebview();
        // Send user info on initialization if authenticated
        this._sendUserInfoToWebview();
      }
    });
  }

  private async _sendInitialTaskList() {
    if (!this._view) return;

    try {
      const taskList = getCachedTaskList(this._context);
      this._sendTaskListToWebview(taskList);
    } catch (error) {
      this._logger.error(`Error sending initial task list: ${error}`);
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

  private _sendTunnelInfoToWebview() {
    if (!this._view) return;

    try {
      // Convert Map to array for easier handling in webview
      const tunnelList = Array.from(this._activeTunnels.entries()).map(([port, url]) => ({
        port,
        url,
      }));

      this._view.webview.postMessage({
        type: 'updateTunnelInfo',
        data: {
          tunnelList,
          timestamp: Date.now(),
        },
      });
    } catch (error) {
      this._logger.error(`Error sending tunnel info to webview: ${error}`);
    }
  }

  private async _handleStopTunnel(port: number) {
    try {
      this._logger.info(`Stopping tunnel for port: ${port}`);

      // Stop the tunnel using TunnelManager
      await this._tunnelManager.stopTunnel(port);

      // Remove from active tunnels
      this._activeTunnels.delete(port);

      // Update webview
      this._sendTunnelInfoToWebview();

      // Broadcast tunnel stopped event to all webviews
      this._communicationHub.broadcast({
        type: MessageTypes.TUNNEL_STOPPED,
        data: { port },
        source: 'home',
      });

      // Show success message
      vscode.window.showInformationMessage(`Tunnel on port ${port} stopped successfully`);
    } catch (error) {
      this._logger.error(`Error stopping tunnel: ${error}`);
      vscode.window.showErrorMessage(`Failed to stop tunnel on port ${port}: ${error}`);
    }
  }

  private async _refreshTaskList() {
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

  private async _handleNewAssess() {
    try {
      // Broadcast assessment start event
      this._communicationHub.broadcast({
        type: MessageTypes.ASSESSMENT_STARTED,
        data: { timestamp: Date.now() },
        source: 'home',
      });

      // Render the MainPanel directly instead of executing command
      MainPanel.render(this._context, this._discoveryService, this._tunnelManager, null, this._communicationHub);
    } catch (error) {
      this._logger.error(`Error starting assessment: ${error}`);
      vscode.window.showErrorMessage(`Failed to start assessment: ${error}`);

      // Broadcast assessment failure event
      this._communicationHub.broadcast({
        type: MessageTypes.ASSESSMENT_FAILED,
        data: { error: (error as Error).message, timestamp: Date.now() },
        source: 'home',
      });
    }
  }

  private _handleOpenZastWebsite() {
    const homeUrl = ZastConfig.getApiBaseUrl();
    vscode.env.openExternal(vscode.Uri.parse(homeUrl));
  }

  private async _handleLogin() {
    try {
      await this._auth.login();
      // Broadcast login event
      this._communicationHub.broadcast({
        type: MessageTypes.AUTH_LOGIN_SUCCESS,
        data: { isAuthenticated: true },
        source: 'home-view',
      });
    } catch (error) {
      this._logger.error(`Login failed: ${error}`);
      vscode.window.showErrorMessage(`Login failed: ${error}`);
    }
  }

  private async _handleLogout() {
    try {
      await this._auth.logout();
      // Broadcast logout event
      this._communicationHub.broadcast({
        type: MessageTypes.AUTH_LOGOUT_SUCCESS,
        data: { isAuthenticated: false },
        source: 'home-view',
      });
    } catch (error) {
      this._logger.error(`Logout failed: ${error}`);
      vscode.window.showErrorMessage(`Logout failed: ${error}`);
    }
  }

  private async _updateAssessStatus() {
    if (!this._view) return;

    try {
      // Get first task from cached task list instead of globalState
      const taskList = getCachedTaskList(this._context);
      const firstTask = taskList.length > 0 ? taskList[0] : null;

      // Format the time if we have a task
      const timeAgo = firstTask ? this._formatTimeAgo(new Date(firstTask.createdAt).getTime()) : 'Never';
      const projectName = firstTask?.projectName || 'No project';

      // Get authentication status
      const isAuthenticated = await this._auth.isAuthenticated();

      // Send update to webview with project name and time
      this._view.webview.postMessage({
        type: 'updateStatus',
        data: {
          lastAssess: timeAgo,
          projectName: projectName,
          taskStatus: firstTask?.taskStatus,
          isAuthenticated,
        },
      });
    } catch (error) {
      this._logger.error(`Error updating assess status: ${error}`);
    }
  }

  private _formatTimeAgo(timestamp: number): string {
    const now = Date.now();
    const diff = now - timestamp;

    const minutes = Math.floor(diff / (1000 * 60));
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (minutes < 60) {
      return `${minutes}min ago`;
    } else if (hours < 24) {
      return `${hours}h ago`;
    } else {
      return `${days}d ago`;
    }
  }

  private _handleOpenTunnelUrl(url: string) {
    vscode.env.openExternal(vscode.Uri.parse(url));
  }

  /**
   * Handle login success event
   */
  private async _handleLoginSuccess(data: { isAuthenticated: boolean; provider: string }) {
    this._logger.info(`HomeView: User logged in successfully to ${data.provider}`);

    try {
      // Update authentication status in the UI
      await this._updateAssessStatus();

      // Refresh task list to get latest data
      await this._refreshTaskList();

      // Send login success notification to webview
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
    this._logger.info(`HomeView: User logged out successfully from ${data.provider}`);

    try {
      // Update authentication status in the UI
      await this._updateAssessStatus();

      // Clear sensitive data
      this._clearSensitiveData();

      // Send logout success notification to webview
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
    this._logger.info(`HomeView: Auth status changed - ${data.isAuthenticated ? 'authenticated' : 'unauthenticated'}`);

    try {
      // Update authentication status in the UI
      await this._updateAssessStatus();

      // If user is no longer authenticated, disable features
      if (!data.isAuthenticated) {
        this._disableAuthRequiredFeatures();
      } else {
        this._enableAuthRequiredFeatures();
      }

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
    this._logger.info(`HomeView: Session expired for provider: ${data.provider}`);

    try {
      // Update authentication status in the UI
      await this._updateAssessStatus();

      // Disable auth required features
      this._disableAuthRequiredFeatures();

      // Clear sensitive data
      this._clearSensitiveData();

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

  /**
   * Handle task status changes
   */
  private async _handleTaskStatusChanges() {
    try {
      // Update assess status to reflect the new task status
      await this._updateAssessStatus();
    } catch (error) {
      this._logger.error(`Error handling task status change: ${error}`);
    }
  }

  /**
   * Clear sensitive data when user logs out
   */
  private _clearSensitiveData() {
    try {
      // Clear active tunnels
      this._activeTunnels.clear();

      // Send updated tunnel info to webview
      this._sendTunnelInfoToWebview();

      // Clear any cached authentication tokens or user data
      // Note: The actual token clearing is handled by the auth provider

      this._logger.info('HomeView: Sensitive data cleared successfully');
    } catch (error) {
      this._logger.error(`Error clearing sensitive data: ${error}`);
    }
  }

  /**
   * Disable features that require authentication
   */
  private _disableAuthRequiredFeatures() {
    try {
      // Send message to webview to disable auth-required features
      if (this._view) {
        this._view.webview.postMessage({
          type: 'disableAuthFeatures',
          data: {
            message: 'Authentication required to use this feature',
          },
        });
      }

      this._logger.info('HomeView: Auth-required features disabled');
    } catch (error) {
      this._logger.error(`Error disabling auth-required features: ${error}`);
    }
  }

  /**
   * Enable features that require authentication
   */
  private _enableAuthRequiredFeatures() {
    try {
      // Send message to webview to enable auth-required features
      if (this._view) {
        this._view.webview.postMessage({
          type: 'enableAuthFeatures',
          data: {
            message: 'Authentication successful - all features enabled',
          },
        });
      }

      this._logger.info('HomeView: Auth-required features enabled');
    } catch (error) {
      this._logger.error(`Error enabling auth-required features: ${error}`);
    }
  }

  /**
   * Update subscription status and send to webview
   */
  private async _updateSubscriptionStatus() {
    if (!this._view) return;

    try {
      const subscriptionStatus = await this._subscriptionManager.getSubscriptionStatus();
      this._sendSubscriptionStatusToWebview(subscriptionStatus);
    } catch (error) {
      this._logger.error(`Error updating subscription status: ${error}`);
    }
  }

  /**
   * Send subscription status to webview
   */
  private _sendSubscriptionStatusToWebview(status: SubscriptionStatus) {
    if (!this._view) return;

    try {
      this._view.webview.postMessage({
        type: 'updateSubscriptionStatus',
        data: {
          category: status.category,
          exceedCreditLimit: status.exceedCreditLimit,
          creditsUsage: status.creditsUsage,
          firstTierLimit: status.firstTierLimit,
          activeSubscriptionId: status.activeSubscriptionId,
          timestamp: Date.now(),
        },
      });
    } catch (error) {
      this._logger.error(`Error sending subscription status to webview: ${error}`);
    }
  }

  /**
   * Handle subscription status change event
   */
  private async _handleSubscriptionStatusChange(data: any) {
    this._logger.info(`HomeView: Subscription status changed - ${data.category}`);

    try {
      // Update subscription status in the UI
      await this._updateSubscriptionStatus();

      // Show notification if needed
      if (this._view) {
        this._view.webview.postMessage({
          type: 'subscriptionStatusChanged',
          data: {
            category: data.category,
            message: `Subscription status updated to ${data.category}`,
          },
        });
      }
    } catch (error) {
      this._logger.error(`Error handling subscription status change: ${error}`);
    }
  }

  /**
   * Handle subscription credit limit change event
   */
  private async _handleSubscriptionCreditLimitChange(data: any) {
    this._logger.info(`HomeView: Credit limit status changed - exceeded: ${data.exceedCreditLimit}`);

    try {
      // Update subscription status in the UI
      await this._updateSubscriptionStatus();

      // Show notification if credit limit exceeded
      if (data.exceedCreditLimit && this._view) {
        this._view.webview.postMessage({
          type: 'subscriptionCreditLimitExceeded',
          data: {
            message: 'You have exceeded your credit limit. Please upgrade your subscription.',
            creditsUsage: data.creditsUsage,
            firstTierLimit: data.firstTierLimit,
          },
        });
      }
    } catch (error) {
      this._logger.error(`Error handling credit limit change: ${error}`);
    }
  }

  /**
   * Handle subscription error event
   */
  private async _handleSubscriptionError(data: any) {
    this._logger.warn(`HomeView: Subscription error - ${data.message}`);

    try {
      // Refresh subscription status
      await this._updateSubscriptionStatus();

      // Show error notification
      if (this._view) {
        this._view.webview.postMessage({
          type: 'subscriptionError',
          data: {
            message: data.message || 'Subscription error occurred',
            errorCode: data.errorCode,
          },
        });
      }
    } catch (error) {
      this._logger.error(`Error handling subscription error: ${error}`);
    }
  }

  /**
   * Handle refresh subscription status request
   */
  private async _handleRefreshSubscriptionStatus() {
    try {
      this._logger.info('Refreshing subscription status');

      // Force refresh from API
      await this._subscriptionManager.refreshSubscriptionStatus();

      // Update UI
      await this._updateSubscriptionStatus();
    } catch (error) {
      this._logger.error(`Error refreshing subscription status: ${error}`);
      vscode.window.showErrorMessage(`Failed to refresh subscription status: ${error}`);
    }
  }

  /**
   * Handle upgrade subscription request
   */
  private async _handleUpgradeSubscription(category: 'pro' | 'enterprise') {
    try {
      this._logger.info(`Upgrading subscription to: ${category}`);

      // Import the function to avoid circular dependencies
      const { fetchCreateCheckoutSession } = await import('../../httpC');

      // Get appropriate redirect URIs based on editor type
      const successUrl = this._getPaymentRedirectUri('success');
      const cancelUrl = this._getPaymentRedirectUri('cancel');

      // Create checkout session
      const response = await fetchCreateCheckoutSession(this._context, {
        category,
        successUrl,
        cancelUrl,
      });

      // Open checkout URL
      vscode.env.openExternal(vscode.Uri.parse(response.url));

      this._logger.info(`Checkout session created: ${response.url}`);
    } catch (error) {
      this._logger.error(`Error upgrading subscription: ${error}`);
      vscode.window.showErrorMessage(`Failed to upgrade subscription: ${error}`);
    }
  }

  /**
   * Get payment redirect URI based on editor type
   */
  private _getPaymentRedirectUri(type: 'success' | 'cancel'): string {
    const clientId = ZastConfig.EXTENSION_CONFIG.CLIENT_ID;

    // Check if running in Cursor
    if (this._isCursorEditor()) {
      return `cursor://${clientId}/payment-${type}`;
    }

    // Default to VSCode
    return `vscode://${clientId}/payment-${type}`;
  }

  /**
   * Detect if running in Cursor editor
   */
  private _isCursorEditor(): boolean {
    try {
      // Check vscode.env.appName which should contain 'cursor' in Cursor editor
      const appName = vscode.env.appName?.toLowerCase();
      if (appName && appName.includes('cursor')) {
        return true;
      }

      // Additional check: process name or executable name
      if (process.argv0?.toLowerCase().includes('cursor')) {
        return true;
      }

      // Check environment variables that might indicate Cursor
      if (process.env.TERM_PROGRAM?.toLowerCase().includes('cursor')) {
        return true;
      }

      return false;
    } catch (error) {
      this._logger.warn(`Failed to detect editor type, defaulting to VSCode: ${error}`);
      return false;
    }
  }

  /**
   * Handle manage subscription request
   */
  private async _handleManageSubscription() {
    try {
      this._logger.info('Opening subscription management portal');

      // Import the function to avoid circular dependencies
      const { fetchCreatePortalSession } = await import('../../httpC');

      // Create portal session
      const response = await fetchCreatePortalSession(this._context);

      // Open portal URL
      vscode.env.openExternal(vscode.Uri.parse(response.url));

      this._logger.info(`Portal session created: ${response.url}`);
    } catch (error) {
      this._logger.error(`Error opening subscription management: ${error}`);
      vscode.window.showErrorMessage(`Failed to open subscription management: ${error}`);
    }
  }

  /**
   * Handle payment success event
   */
  private async _handlePaymentSuccessEvent(data: any) {
    this._logger.info(`HomeView: Payment completed successfully - session: ${data.sessionId}`);

    try {
      // Refresh subscription status to reflect the new payment
      await this._subscriptionManager.refreshSubscriptionStatus();

      // Update UI with new subscription status
      await this._updateSubscriptionStatus();

      // Send payment success notification to webview
      if (this._view) {
        this._view.webview.postMessage({
          type: 'paymentSuccess',
          data: {
            sessionId: data.sessionId,
            message: data.message || 'Payment completed successfully! Your subscription has been updated.',
            timestamp: data.timestamp,
          },
        });
      }
    } catch (error) {
      this._logger.error(`Error handling payment success event: ${error}`);
    }
  }

  /**
   * Handle payment cancelled event
   */
  private async _handlePaymentCancelledEvent(data: any) {
    this._logger.info(`HomeView: Payment was cancelled - session: ${data.sessionId}`);

    try {
      // Send payment cancelled notification to webview
      if (this._view) {
        this._view.webview.postMessage({
          type: 'paymentCancelled',
          data: {
            sessionId: data.sessionId,
            message: data.message || 'Payment was cancelled. You can try again anytime.',
            timestamp: data.timestamp,
          },
        });
      }
    } catch (error) {
      this._logger.error(`Error handling payment cancelled event: ${error}`);
    }
  }

  /**
   * Send user info to webview
   */
  private async _sendUserInfoToWebview() {
    if (!this._view) return;

    try {
      const isAuthenticated = await this._auth.isAuthenticated();

      if (isAuthenticated) {
        // First try to get user info from globalState
        let userInfo: any = null;
        let userInfoError: string | null = null;

        try {
          // Get current provider
          const currentProvider = this._auth.getCurrentProvider();

          if (currentProvider) {
            // Try to get user info from globalState first
            const userInfoKey = currentProvider.USER_INFO_KEY;
            userInfo = await this._context.globalState.get(userInfoKey);

            // If userInfo is not in globalState, try to get it from the provider
            if (!userInfo) {
              this._logger.debug('User info not found in globalState, fetching from provider');
              userInfo = await currentProvider.getUserInfo();

              // Save to globalState for future use
              if (userInfo) {
                await this._context.globalState.update(userInfoKey, userInfo);
              }
            } else {
              this._logger.debug('User info found in globalState');
            }
          }
        } catch (error) {
          this._logger.error(`Error getting user info from globalState or provider: ${error}`);
          userInfoError = error instanceof Error ? error.message : String(error);
        }

        // Send user info to webview
        this._view.webview.postMessage({
          type: 'updateUserInfo',
          data: {
            userInfo: userInfo,
            error: userInfoError,
            timestamp: Date.now(),
          },
        });
      } else {
        // Send empty user info if not authenticated
        this._view.webview.postMessage({
          type: 'updateUserInfo',
          data: {
            userInfo: null,
            timestamp: Date.now(),
          },
        });
      }
    } catch (error) {
      this._logger.error(`Error sending user info to webview: ${error}`);

      // Send error state to webview
      this._view?.webview.postMessage({
        type: 'updateUserInfo',
        data: {
          userInfo: null,
          error: 'Failed to retrieve user info',
          timestamp: Date.now(),
        },
      });
    }
  }
}
