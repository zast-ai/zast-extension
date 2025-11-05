import * as vscode from 'vscode';
import { ZastConfig } from './config';
import { BaseAuthProvider, ZastAuthProvider, ClerkAuthProvider } from './authProvider';
import { getPrefixedLogger } from './logger';
import { WebviewCommunicationHub, MessageTypes } from './communication';
import { SubscriptionManager } from './subscriptionManager';

// Legacy interface exports for backward compatibility
export interface TokenResponse {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  expiresIn: number;
  refreshExpiresIn: number;
  forceChangePwd: boolean;
}

export interface ClerkTokenResponse {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in: number;
  scope?: string;
}

/**
 * Main authentication manager that orchestrates multiple authentication providers (Singleton)
 */
export class ZastAuth {
  private static _instance: ZastAuth | undefined;
  private context: vscode.ExtensionContext;
  private logger = getPrefixedLogger('Auth');
  private communicationHub?: WebviewCommunicationHub;
  private subscriptionManager: SubscriptionManager;
  public static readonly AUTH_TOKEN_KEY = 'zast.authToken';
  public static readonly REFRESH_TOKEN_KEY = 'zast.refreshToken';

  // Provider IDs
  private static readonly ZAST_PROVIDER_ID = 'zast-auth';
  private static readonly CLERK_PROVIDER_ID = 'clerk-auth';

  // Authentication providers
  private zastAuthProvider!: ZastAuthProvider;
  private clerkAuthProvider!: ClerkAuthProvider;
  private currentProvider: BaseAuthProvider | undefined;
  private isInitialized: Promise<void> = Promise.resolve();

  // Private constructor for singleton pattern
  private constructor(context: vscode.ExtensionContext, communicationHub?: WebviewCommunicationHub) {
    this.context = context;
    this.communicationHub = communicationHub;
    this.subscriptionManager = SubscriptionManager.getInstance(context);
    if (communicationHub) {
      this.subscriptionManager.setCommunicationHub(communicationHub);
    }
    this.isInitialized = this.initialize();
  }

  // Get singleton instance
  public static getInstance(context: vscode.ExtensionContext, communicationHub?: WebviewCommunicationHub): ZastAuth {
    if (!ZastAuth._instance) {
      ZastAuth._instance = new ZastAuth(context, communicationHub);
    } else if (ZastAuth._instance.context !== context) {
      // If context is different, update it but keep the same instance
      ZastAuth._instance.context = context;
      ZastAuth._instance.communicationHub = communicationHub;
      // Re-initialize with new context if needed
      ZastAuth._instance.isInitialized = ZastAuth._instance.initialize();
    }
    return ZastAuth._instance;
  }

  // For testing or extension deactivation - reset singleton
  public static resetInstance(): void {
    if (ZastAuth._instance) {
      ZastAuth._instance = undefined;
    }
  }

  // Update communication hub reference
  public setCommunicationHub(communicationHub: WebviewCommunicationHub): void {
    this.communicationHub = communicationHub;

    // Pass communication hub to subscription manager
    this.subscriptionManager.setCommunicationHub(communicationHub);

    // Pass communication hub to providers
    if (this.zastAuthProvider) {
      this.zastAuthProvider.setCommunicationHub(communicationHub);
    }
    if (this.clerkAuthProvider) {
      this.clerkAuthProvider.setCommunicationHub(communicationHub);
    }
  }

  public async initialize(): Promise<void> {
    // Register only one authentication provider based on deployment configuration
    if (ZastConfig.isSaasEnabled(this.context)) {
      this.logger.info('Initializing Clerk authentication provider');
      this.clerkAuthProvider = ClerkAuthProvider.getInstance();
      // Initialize providers
      this.clerkAuthProvider.initialize(this.context);

      // If not self-hosted (SaaS), register Clerk provider
      vscode.authentication.registerAuthenticationProvider(ZastAuth.CLERK_PROVIDER_ID, 'Clerk', this.clerkAuthProvider);
      this.currentProvider = this.clerkAuthProvider;
      this.logger.info('Clerk authentication provider registered successfully');
    } else {
      this.logger.info('Initializing Zast.ai authentication provider');
      this.zastAuthProvider = ZastAuthProvider.getInstance();
      this.zastAuthProvider.initialize(this.context);
      // If self-hosted, register Zast.ai provider
      vscode.authentication.registerAuthenticationProvider(ZastAuth.ZAST_PROVIDER_ID, 'Zast.ai', this.zastAuthProvider);
      this.currentProvider = this.zastAuthProvider;
      this.logger.info('Zast.ai authentication provider registered successfully');
    }

    // Check if already authenticated and update subscription status if needed
    const isAuthenticated = await this.isAuthenticated();
    if (isAuthenticated) {
      this.logger.info('User is already authenticated, updating subscription status');
      this._fetchSubscriptionStatusAfterLogin().catch((error) => {
        this.logger.warn(`Failed to fetch subscription status during initialization: ${error}`);
      });
    }

    // Clean up singletons when extension is deactivated
    this.context.subscriptions.push({
      dispose: () => {
        ZastAuthProvider.resetInstance();
        ClerkAuthProvider.resetInstance();
      },
    });
  }

  public async login(): Promise<void> {
    try {
      // Use the current provider that was set during initialization
      if (!this.currentProvider) {
        const error = 'No authentication provider available';
        this.logger.error(error);
        throw new Error(error);
      }

      const providerId = this.currentProvider === this.zastAuthProvider ? ZastAuth.ZAST_PROVIDER_ID : ZastAuth.CLERK_PROVIDER_ID;
      const providerName = this.currentProvider === this.zastAuthProvider ? 'Zast.ai' : 'Clerk';

      this.logger.info(`Attempting to login with ${providerName} provider`);

      // Try to get existing session first
      const existingSessions = await vscode.authentication.getSession(providerId, ['default'], { silent: true });

      if (existingSessions) {
        this.logger.info(`Found existing session for ${providerName}`);
        vscode.window.showInformationMessage(`Successfully logged in to ${providerName}`);

        // Broadcast login success events for existing session
        this._broadcastLoginSuccess(providerName);
        return;
      }

      // Create new session if no existing session
      this.logger.info(`Creating new session for ${providerName}`);
      const session = await vscode.authentication.getSession(providerId, ['default'], { createIfNone: true });

      if (session) {
        this.logger.info(`Successfully created new session for ${providerName}`);

        // Broadcast login success events for new session
        this._broadcastLoginSuccess(providerName);
        // vscode.window.showInformationMessage(`Successfully logged in to ${providerName}`);
      } else {
        this.logger.error('Authentication failed - no session created');
        vscode.window.showErrorMessage('Authentication failed');
      }
    } catch (error) {
      this.logger.error(`Authentication failed: ${error}`);
      vscode.window.showErrorMessage(`Authentication failed: ${error}`);
    }
  }

  public async logout(): Promise<void> {
    try {
      // Logout from the current provider
      if (!this.currentProvider) {
        this.logger.warn('No active authentication session to logout');
        vscode.window.showInformationMessage('No active authentication session');
        return;
      }

      const providerId = this.currentProvider === this.zastAuthProvider ? ZastAuth.ZAST_PROVIDER_ID : ZastAuth.CLERK_PROVIDER_ID;
      const providerName = this.currentProvider === this.zastAuthProvider ? 'Zast.ai' : 'Clerk';

      this.logger.info(`Attempting to logout from ${providerName} provider`);
      await this._logoutFromProvider(providerId, providerName);
      this.logger.info(`Successfully logged out from ${providerName}`);

      // Broadcast logout success and status change events
      if (this.communicationHub) {
        this.logger.info('Broadcasting logout events to all webviews');

        // Broadcast logout success event
        this.communicationHub.broadcast({
          type: MessageTypes.AUTH_LOGOUT_SUCCESS,
          data: { isAuthenticated: false, provider: providerName },
          source: 'auth-manager',
        });

        // Broadcast authentication status change event
        this.communicationHub.broadcast({
          type: MessageTypes.AUTH_STATUS_CHANGED,
          data: { isAuthenticated: false, provider: providerName },
          source: 'auth-manager',
        });
      } else {
        this.logger.warn('CommunicationHub not available for broadcasting logout events');
      }

      // this.currentProvider = undefined;
      // vscode.window.showInformationMessage(`Successfully logged out from ${providerName}`);
    } catch (error) {
      this.logger.error(`Logout failed: ${error}`);
      vscode.window.showErrorMessage(`Logout failed: ${error}`);
    }
  }

  private async _logoutFromProvider(providerId: string, providerName: string): Promise<void> {
    try {
      const sessions = await vscode.authentication.getSession(providerId, ['default'], { silent: true });
      if (sessions) {
        if (providerId === ZastAuth.ZAST_PROVIDER_ID) {
          await this.zastAuthProvider.removeSession(sessions.id);
        } else if (providerId === ZastAuth.CLERK_PROVIDER_ID) {
          await this.clerkAuthProvider.removeSession(sessions.id);
        }
      }
    } catch (error) {
      this.logger.warn(`Failed to logout from ${providerName}: ${error}`);
    }
  }

  private _broadcastLoginSuccess(providerName: string): void {
    if (this.communicationHub) {
      this.logger.info('Broadcasting login success events to all webviews');

      // Broadcast login success event
      this.communicationHub.broadcast({
        type: MessageTypes.AUTH_LOGIN_SUCCESS,
        data: { isAuthenticated: true, provider: providerName },
        source: 'auth-manager',
      });

      // Broadcast authentication status change event
      this.communicationHub.broadcast({
        type: MessageTypes.AUTH_STATUS_CHANGED,
        data: { isAuthenticated: true, provider: providerName },
        source: 'auth-manager',
      });

      // Fetch subscription status after successful login
      this._fetchSubscriptionStatusAfterLogin().catch((error) => {
        this.logger.warn(`Failed to fetch subscription status after login: ${error}`);
      });
    } else {
      this.logger.warn('CommunicationHub not available for broadcasting login success events');
    }
  }

  /**
   * Fetch subscription status after successful login
   */
  private async _fetchSubscriptionStatusAfterLogin(): Promise<void> {
    try {
      this.logger.info('Fetching subscription status after successful login');

      // Force refresh subscription status from API
      await this.subscriptionManager.refreshSubscriptionStatus();

      this.logger.info('Successfully fetched subscription status after login');
    } catch (error) {
      this.logger.error(`Error fetching subscription status after login: ${error}`);
      // Don't throw here as login is already successful, subscription status is non-critical
    }
  }

  public async isAuthenticated(): Promise<boolean> {
    try {
      await this.isInitialized;
      // Check if authenticated with the current provider
      if (!this.currentProvider) {
        this.logger.debug('No current authentication provider available');
        return false;
      }

      const providerId = this.currentProvider === this.zastAuthProvider ? ZastAuth.ZAST_PROVIDER_ID : ZastAuth.CLERK_PROVIDER_ID;
      const providerName = this.currentProvider === this.zastAuthProvider ? 'Zast.ai' : 'Clerk';

      this.logger.debug(`Checking authentication status for ${providerName}`);
      const session = await vscode.authentication.getSession(providerId, ['default'], { silent: true });
      const isAuth = !!session;
      this.logger.debug(`Authentication status for ${providerName}: ${isAuth}`);
      return isAuth;
    } catch (error) {
      this.logger.error(`Error checking authentication status: ${error}`);
      return false;
    }
  }

  public async getAuthToken(): Promise<string | undefined> {
    try {
      // Get token from the current provider
      if (!this.currentProvider) {
        this.logger.debug('No current authentication provider available for token retrieval');
        return undefined;
      }

      const providerId = this.currentProvider === this.zastAuthProvider ? ZastAuth.ZAST_PROVIDER_ID : ZastAuth.CLERK_PROVIDER_ID;
      const providerName = this.currentProvider === this.zastAuthProvider ? 'Zast.ai' : 'Clerk';

      this.logger.debug(`Retrieving auth token for ${providerName}`);
      const session = await vscode.authentication.getSession(providerId, ['default'], { silent: true });
      const hasToken = !!session?.accessToken;
      this.logger.debug(`Auth token retrieval for ${providerName}: ${hasToken ? 'success' : 'no token available'}`);
      return session?.accessToken;
    } catch (error) {
      this.logger.error(`Error retrieving auth token: ${error}`);
      return undefined;
    }
  }

  public async refreshToken(): Promise<void> {
    // Refresh token using the current provider
    if (!this.currentProvider) {
      // Try to determine current provider based on available sessions
      const isAuth = await this.isAuthenticated();
      if (!isAuth || !this.currentProvider) {
        throw new Error('No active authentication session found');
      }
    }

    try {
      await this.currentProvider.refreshToken();
    } catch (error) {
      throw new Error(`Token refresh failed: ${error}`);
    }
  }

  // Utility methods for backward compatibility
  public async getZastAuthToken(): Promise<string | undefined> {
    try {
      const session = await vscode.authentication.getSession(ZastAuth.ZAST_PROVIDER_ID, ['default'], { silent: true });
      return session?.accessToken;
    } catch {
      return undefined;
    }
  }

  public async getClerkAuthToken(): Promise<string | undefined> {
    if (!ZastConfig.isSaasEnabled(this.context)) {
      return undefined;
    }

    try {
      const session = await vscode.authentication.getSession(ZastAuth.CLERK_PROVIDER_ID, ['default'], { silent: true });
      return session?.accessToken;
    } catch {
      return undefined;
    }
  }

  public async isZastAuthenticated(): Promise<boolean> {
    try {
      const session = await vscode.authentication.getSession(ZastAuth.ZAST_PROVIDER_ID, ['default'], { silent: true });
      return !!session;
    } catch {
      return false;
    }
  }

  public async isClerkAuthenticated(): Promise<boolean> {
    if (!ZastConfig.isSaasEnabled(this.context)) {
      return false;
    }

    try {
      const session = await vscode.authentication.getSession(ZastAuth.CLERK_PROVIDER_ID, ['default'], { silent: true });
      return !!session;
    } catch {
      return false;
    }
  }

  // Get the current provider instance for advanced usage
  public getCurrentProvider(): BaseAuthProvider | undefined {
    return this.currentProvider;
  }

  public getZastProvider(): ZastAuthProvider {
    return this.zastAuthProvider;
  }

  public getClerkProvider(): ClerkAuthProvider {
    return this.clerkAuthProvider;
  }

  // Get the subscription manager instance
  public getSubscriptionManager(): SubscriptionManager {
    return this.subscriptionManager;
  }
}
