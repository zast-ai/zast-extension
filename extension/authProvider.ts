import * as vscode from 'vscode';
import fetch from 'node-fetch';
import { randomBytes } from 'crypto';
import { ZastConfig } from './config';
import { getPrefixedLogger } from './logger';
import { WebviewCommunicationHub, MessageTypes } from './communication';

// Token response interfaces
interface TokenResponse {
  realAccessToken?: string;
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  expiresIn: number;
  refreshExpiresIn: number;
  forceChangePwd: boolean;
}

interface ClerkTokenResponse {
  id_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in: number;
  scope?: string;
  access_token?: string;
}

// Auth result interface
interface AuthResult {
  code: string | undefined;
  isClerk: boolean;
}

interface UserInfo {
  id: string;
  email: string;
  name: string;
}

/**
 * Abstract base class for authentication providers
 */
export abstract class BaseAuthProvider implements vscode.AuthenticationProvider, vscode.UriHandler {
  protected _sessionChangeEmitter = new vscode.EventEmitter<vscode.AuthenticationProviderAuthenticationSessionsChangeEvent>();
  protected _context: vscode.ExtensionContext | undefined;
  protected _tokenRefreshTimer: NodeJS.Timeout | undefined;
  protected _pendingAuth: Map<string, { resolve: (code: string | undefined) => void }> = new Map();
  protected _communicationHub?: WebviewCommunicationHub;
  protected logger = getPrefixedLogger('AuthProvider');

  // Common OAuth configuration
  protected readonly REDIRECT_URI_CURSOR = `cursor://${ZastConfig.EXTENSION_CONFIG.CLIENT_ID}/auth-callback`;
  protected readonly REDIRECT_URI_VSCODE = `vscode://${ZastConfig.EXTENSION_CONFIG.CLIENT_ID}/auth-callback`;

  // Abstract properties that must be implemented by subclasses
  protected abstract readonly PROVIDER_NAME: string;
  protected abstract readonly AUTH_TOKEN_KEY: string;
  public abstract readonly USER_INFO_KEY: string;
  protected abstract readonly ACCESS_TOKEN?: string;
  protected abstract readonly REFRESH_TOKEN_KEY: string;
  protected abstract readonly CLIENT_ID: string;
  protected readonly CLERK_CLIENT_ID?: string = undefined;
  protected abstract readonly AUTH_URL: string;
  protected abstract readonly TOKEN_URL: string;
  protected abstract readonly REFRESH_TOKEN_URL: string;
  protected abstract readonly SCOPES: string[];

  constructor() {}

  // Detect editor type and return appropriate redirect URI
  protected getRedirectUri(): string {
    // Check if running in Cursor
    if (this.isCursorEditor()) {
      return this.REDIRECT_URI_CURSOR;
    }
    // Default to VSCode
    return this.REDIRECT_URI_VSCODE;
  }

  // Detect if running in Cursor editor
  private isCursorEditor(): boolean {
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
      this.logger.warn(`Failed to detect editor type, defaulting to VSCode: ${error}`);
      return false;
    }
  }

  // Initialize the provider with context
  public initialize(context: vscode.ExtensionContext): void {
    if (this._context) {
      this.logger.debug(`${this.PROVIDER_NAME} provider already initialized`);
      return;
    }

    const editorType = this.isCursorEditor() ? 'Cursor' : 'VSCode';
    this.logger.info(`Initializing ${this.PROVIDER_NAME} authentication provider for ${editorType}`);
    this.logger.debug(`Selected redirect URI: ${this.getRedirectUri()}`);

    this._context = context;
    this._startTokenRefreshTimer();
    context.subscriptions.push(vscode.window.registerUriHandler(this));
    this.logger.info(`${this.PROVIDER_NAME} provider initialization completed`);
  }

  // Set communication hub for broadcasting events
  public setCommunicationHub(communicationHub: WebviewCommunicationHub): void {
    this._communicationHub = communicationHub;
  }

  // Handle session expiration
  protected async _handleSessionExpiration(): Promise<void> {
    if (!this._context) {
      this.logger.warn(`${this.PROVIDER_NAME} context not available for session expiration handling`);
      return;
    }

    this.logger.warn(`${this.PROVIDER_NAME} session expired, clearing tokens`);

    // Clear stored tokens
    await this._context.globalState.update(this.AUTH_TOKEN_KEY, undefined);
    await this._context.globalState.update(this.REFRESH_TOKEN_KEY, undefined);
    await this._context.globalState.update(`${this.AUTH_TOKEN_KEY}.expiresAt`, undefined);
    await this._context.globalState.update(`${this.REFRESH_TOKEN_KEY}.expiresAt`, undefined);

    // Broadcast session expiration event
    if (this._communicationHub) {
      this._communicationHub.broadcast({
        type: MessageTypes.AUTH_SESSION_EXPIRED,
        data: {
          isAuthenticated: false,
          provider: this.PROVIDER_NAME,
          message: `Your login session has expired. Please log in again.`,
        },
        source: 'auth-provider',
      });
    }

    // Show user notification
    vscode.window.showWarningMessage(`Your ${this.PROVIDER_NAME} login session has expired. Please log in again through the Zast.ai sidebar.`);
  }

  // URI Handler implementation
  handleUri(uri: vscode.Uri): vscode.ProviderResult<void> {
    this.logger.debug(`Handling URI callback: ${uri.toString()}`);

    if (uri.path === '/auth-callback') {
      const query = new URLSearchParams(uri.query);
      const code = query.get('code');
      const state = query.get('state');
      const error = query.get('error');

      if (error) {
        this.logger.error(`Authentication callback error: ${error}`);
        vscode.window.showErrorMessage(`Authentication failed: ${error}`);
        this._resolvePendingAuth(state, undefined);
        return;
      }

      if (state && this._pendingAuth.has(state)) {
        this.logger.info(`Authentication callback received with valid state: ${state}`);
        this._resolvePendingAuth(state, code || undefined);
      } else {
        this.logger.error(`Authentication callback with invalid or missing state: ${state}`);
        vscode.window.showErrorMessage('Invalid authentication state');
      }
    } else if (uri.path === '/payment-success') {
      this.logger.info('Payment success callback received');
      this._handlePaymentSuccess(uri);
    } else if (uri.path === '/payment-cancel') {
      this.logger.info('Payment cancel callback received');
      this._handlePaymentCancel(uri);
    }
  }

  protected _resolvePendingAuth(state: string | null, code: string | undefined): void {
    if (state && this._pendingAuth.has(state)) {
      const pendingData = this._pendingAuth.get(state);
      this._pendingAuth.delete(state);
      pendingData?.resolve(code);
    }
  }

  /**
   * Handle payment success callback
   */
  protected _handlePaymentSuccess(uri: vscode.Uri): void {
    this.logger.info('Processing payment success callback');

    try {
      const query = new URLSearchParams(uri.query);
      const sessionId = query.get('session_id');

      // Show success notification
      vscode.window.showInformationMessage('🎉 Payment successful! Your subscription has been updated.');

      // Broadcast payment success event
      if (this._communicationHub) {
        this._communicationHub.broadcast({
          type: MessageTypes.PAYMENT_SUCCESS,
          data: {
            sessionId,
            timestamp: Date.now(),
            message: 'Payment completed successfully',
          },
          source: 'auth-provider',
        });
      }

      this.logger.info(`Payment success processed for session: ${sessionId}`);
    } catch (error) {
      this.logger.error(`Error processing payment success: ${error}`);
      vscode.window.showErrorMessage(`Error processing payment success: ${error}`);
    }
  }

  /**
   * Handle payment cancel callback
   */
  protected _handlePaymentCancel(uri: vscode.Uri): void {
    this.logger.info('Processing payment cancel callback');

    try {
      const query = new URLSearchParams(uri.query);
      const sessionId = query.get('session_id');

      // Show cancel notification
      vscode.window.showWarningMessage('Payment was cancelled. You can try again anytime.');

      // Broadcast payment cancel event
      if (this._communicationHub) {
        this._communicationHub.broadcast({
          type: MessageTypes.PAYMENT_CANCELLED,
          data: {
            sessionId,
            timestamp: Date.now(),
            message: 'Payment was cancelled by user',
          },
          source: 'auth-provider',
        });
      }

      this.logger.info(`Payment cancel processed for session: ${sessionId}`);
    } catch (error) {
      this.logger.error(`Error processing payment cancel: ${error}`);
      vscode.window.showErrorMessage(`Error processing payment cancel: ${error}`);
    }
  }

  get onDidChangeSessions(): vscode.Event<vscode.AuthenticationProviderAuthenticationSessionsChangeEvent> {
    return this._sessionChangeEmitter.event;
  }

  async getSessions(scopes?: string[]): Promise<vscode.AuthenticationSession[]> {
    if (!this._context) {
      const error = `${this.PROVIDER_NAME} not initialized`;
      this.logger.error(error);
      throw new Error(error);
    }

    this.logger.debug(`Getting sessions for ${this.PROVIDER_NAME}`);
    const token = this.ACCESS_TOKEN ? await this._context.globalState.get<string>(this.ACCESS_TOKEN) : await this._context.globalState.get<string>(this.AUTH_TOKEN_KEY);
    const refreshToken = await this._context.globalState.get<string>(this.REFRESH_TOKEN_KEY);

    if (!token || !refreshToken) {
      this.logger.debug(`No stored tokens found for ${this.PROVIDER_NAME}`);
      return [];
    }

    // Check if token is expired and refresh if needed
    const expiresAt = await this._context.globalState.get<number>(`${this.AUTH_TOKEN_KEY}.expiresAt`);
    if (expiresAt && Date.now() > expiresAt) {
      try {
        await this.refreshToken();
        const newToken = await this._context.globalState.get<string>(this.AUTH_TOKEN_KEY);
        if (!newToken) {
          return [];
        }
        return this._createSessionArray(newToken, scopes);
      } catch (error) {
        this.logger.error(`Failed to refresh token: ${error}`);
        return [];
      }
    }

    return this._createSessionArray(token, scopes);
  }

  protected _createSessionArray(token: string, scopes?: string[]): vscode.AuthenticationSession[] {
    return [
      {
        id: `${this.PROVIDER_NAME.toLowerCase()}-session`,
        accessToken: token,
        account: {
          id: `${this.PROVIDER_NAME.toLowerCase()}-user`,
          label: `${this.PROVIDER_NAME} User`,
        },
        scopes: scopes || this.SCOPES,
      },
    ];
  }

  async createSession(scopes: string[]): Promise<vscode.AuthenticationSession> {
    if (!this._context) {
      const error = `${this.PROVIDER_NAME} not initialized`;
      this.logger.error(error);
      throw new Error(error);
    }

    this.logger.info(`Creating new session for ${this.PROVIDER_NAME}`);
    try {
      this.logger.debug('Getting authorization code');
      const code = await this._getAuthorizationCode();
      if (!code) {
        this.logger.warn('Authorization cancelled by user');
        throw new Error('Authorization cancelled');
      }

      this.logger.debug('Exchanging authorization code for tokens');
      const tokens = await this._exchangeCodeForTokens(code);

      // Store tokens
      this.logger.debug('Storing authentication tokens');

      if (this.ACCESS_TOKEN && tokens.realAccessToken) {
        await this._context.globalState.update(this.ACCESS_TOKEN, tokens.realAccessToken);
      }
      await this._context.globalState.update(this.AUTH_TOKEN_KEY, tokens.accessToken);
      await this._context.globalState.update(this.REFRESH_TOKEN_KEY, tokens.refreshToken);

      const accessToken = await this._context.globalState.get<string>(this.AUTH_TOKEN_KEY);

      if (accessToken !== tokens.accessToken) {
        this.logger.warn(`Access token mismatch: stored=${accessToken}, received=${tokens.accessToken}`);
      }

      // Calculate and store expiration time
      const expiresAt = Date.now() + tokens.expiresIn * 1000;
      await this._context.globalState.update(`${this.AUTH_TOKEN_KEY}.expiresAt`, expiresAt);

      // Update refresh token expiration time
      const refreshExpiresAt = Date.now() + tokens.refreshExpiresIn * 1000;
      await this._context.globalState.update(`${this.REFRESH_TOKEN_KEY}.expiresAt`, refreshExpiresAt);
      this.logger.debug(`Token expiration set: access=${new Date(expiresAt).toISOString()}, refresh=${new Date(refreshExpiresAt).toISOString()}`);

      const userInfo = await this.getUserInfo();

      const session: vscode.AuthenticationSession = {
        id: `${this.PROVIDER_NAME.toLowerCase()}-session`,
        accessToken: tokens.accessToken,
        account: {
          id: userInfo.id,
          label: userInfo.email ? `${userInfo.name} <${userInfo.email}>` : userInfo.name,
        },
        scopes: scopes,
      };

      this._sessionChangeEmitter.fire({
        added: [session],
        removed: [],
        changed: [],
      });

      this.logger.info(`Successfully created session for ${this.PROVIDER_NAME}`);
      vscode.window.showInformationMessage(`Successfully authenticated with ${this.PROVIDER_NAME}! 🎉`);
      return session;
    } catch (error) {
      this.logger.error(`Authentication failed: ${error}`);
      throw new Error(`Authentication failed: ${error}`);
    }
  }

  async removeSession(sessionId: string): Promise<void> {
    if (!this._context) {
      const error = `${this.PROVIDER_NAME} not initialized`;
      this.logger.error(error);
      throw new Error(error);
    }

    this.logger.info(`Removing session ${sessionId} for ${this.PROVIDER_NAME}`);
    await this._context.globalState.update(this.AUTH_TOKEN_KEY, undefined);
    await this._context.globalState.update(this.REFRESH_TOKEN_KEY, undefined);
    await this._context.globalState.update(`${this.AUTH_TOKEN_KEY}.expiresAt`, undefined);
    await this._context.globalState.update(`${this.REFRESH_TOKEN_KEY}.expiresAt`, undefined);
    if (this.ACCESS_TOKEN) {
      await this._context.globalState.update(this.ACCESS_TOKEN, undefined);
    }

    this.logger.debug(`Cleared all stored tokens for ${this.PROVIDER_NAME}`);

    this._sessionChangeEmitter.fire({
      added: [],
      removed: [
        {
          id: sessionId,
          accessToken: '',
          account: {
            id: `${this.PROVIDER_NAME.toLowerCase()}-user`,
            label: `${this.PROVIDER_NAME} User`,
          },
          scopes: [],
        },
      ],
      changed: [],
    });
  }

  protected async _getAuthorizationCode(): Promise<string | undefined> {
    return new Promise((resolve, reject) => {
      const state = randomBytes(16).toString('hex');
      this.logger.debug(`Generated auth state: ${state}`);

      // Store the resolver for this auth request
      this._pendingAuth.set(state, { resolve });

      // Build the authorization URL
      const authUrl =
        `${this.AUTH_URL}?` +
        new URLSearchParams({
          client_id: this.CLERK_CLIENT_ID || this.CLIENT_ID,
          redirect_uri: this.getRedirectUri(),
          response_type: 'code',
          scope: this.SCOPES.join(' '),
          state: state,
        }).toString();

      this.logger.debug(`Opening authorization URL: ${authUrl}`);

      // Open the browser for authentication
      vscode.env.openExternal(vscode.Uri.parse(authUrl)).then((success) => {
        if (success) {
          this.logger.info(`Browser opened successfully for ${this.PROVIDER_NAME} authentication`);
          const message = `Please complete ${this.PROVIDER_NAME} authentication in your browser. VSCode will automatically receive the callback.`;

          vscode.window.showInformationMessage(message, 'Cancel').then((selection) => {
            if (selection === 'Cancel') {
              this.logger.info('User cancelled authentication');
              this._resolvePendingAuth(state, undefined);
            }
          });
        } else {
          this.logger.error('Failed to open browser for authentication');
          this._resolvePendingAuth(state, undefined);
          reject(new Error('Failed to open browser for authentication'));
        }
      });

      // Timeout after 5 minutes
      setTimeout(() => {
        if (this._pendingAuth.has(state)) {
          this.logger.warn(`Authentication timeout for state: ${state}`);
          this._resolvePendingAuth(state, undefined);
          reject(new Error('Authentication timeout'));
        }
      }, 5 * 60 * 1000);
    });
  }

  // Abstract methods that must be implemented by subclasses
  protected abstract _exchangeCodeForTokens(code: string): Promise<TokenResponse>;
  public abstract refreshToken(): Promise<void>;
  public abstract getUserInfo(): Promise<UserInfo>;

  protected _startTokenRefreshTimer(): void {
    // Check every 10 minutes if token needs refresh
    this._tokenRefreshTimer = setInterval(async () => {
      try {
        if (!this._context) {
          this.logger.warn(`${this.PROVIDER_NAME} context not available, skipping token refresh check`);
          return;
        }

        const expiresAt = await this._context.globalState.get<number>(`${this.AUTH_TOKEN_KEY}.expiresAt`);
        const refreshExpiresAt = await this._context.globalState.get<number>(`${this.REFRESH_TOKEN_KEY}.expiresAt`);
        const refreshToken = await this._context.globalState.get<string>(this.REFRESH_TOKEN_KEY);

        if (refreshToken && expiresAt) {
          // Check if refresh token itself is expired
          if (refreshExpiresAt && Date.now() > refreshExpiresAt) {
            this.logger.info('Refresh token expired, clearing tokens');
            await this.removeSession(`${this.PROVIDER_NAME.toLowerCase()}-session`);
            vscode.window.showWarningMessage('Your login session has expired. Please log in again through the Zast.ai sidebar.');
            return;
          }

          // Refresh access token if it expires in the next 5 minutes
          const fiveMinutesFromNow = Date.now() + 5 * 60 * 1000;
          if (expiresAt < fiveMinutesFromNow) {
            await this.refreshToken();
            this.logger.info('Token refreshed automatically');
          }
        }
      } catch (error) {
        this.logger.error(`Automatic token refresh failed: ${error}`);
      }
    }, 1 * 60 * 1000); // 10 minutes
  }

  public dispose(): void {
    if (this._tokenRefreshTimer) {
      clearInterval(this._tokenRefreshTimer);
      this._tokenRefreshTimer = undefined;
    }
    this._context = undefined;
  }
}

/**
 * Zast.ai Authentication Provider
 */
export class ZastAuthProvider extends BaseAuthProvider {
  private static _instance: ZastAuthProvider | undefined;
  protected logger = getPrefixedLogger('AuthProvider');

  protected readonly PROVIDER_NAME = '';
  protected readonly AUTH_TOKEN_KEY = '';
  protected readonly REFRESH_TOKEN_KEY = '';
  protected readonly CLIENT_ID = ZastConfig.EXTENSION_CONFIG.CLIENT_ID;
  public readonly USER_INFO_KEY = 'zast.userInfo';
  protected readonly ACCESS_TOKEN = 'zast.accessToken';
  protected readonly AUTH_URL = `${ZastConfig.getApiBaseUrl()}${ZastConfig.SELF_HOSTED_OAUTH_CONFIG.AUTH_URL}`;
  protected readonly TOKEN_URL = ZastConfig.SELF_HOSTED_OAUTH_CONFIG.TOKEN_URL;
  protected readonly REFRESH_TOKEN_URL = `${ZastConfig.getApiBaseUrl()}${ZastConfig.SELF_HOSTED_OAUTH_CONFIG.REFRESH_TOKEN_URL}`;
  protected readonly SCOPES = ZastConfig.SELF_HOSTED_OAUTH_CONFIG.SCOPES;

  private constructor() {
    super();
  }

  public static getInstance(): ZastAuthProvider {
    if (!ZastAuthProvider._instance) {
      ZastAuthProvider._instance = new ZastAuthProvider();
    }
    return ZastAuthProvider._instance;
  }

  protected async _exchangeCodeForTokens(code: string): Promise<TokenResponse> {
    this.logger.debug('Exchanging Zast authorization code for tokens');
    try {
      const response = await fetch(this.REFRESH_TOKEN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/plain, */*',
          'Accept-Language': 'en-US,en;q=0.9,zh;q=0.8,zh-CN;q=0.7',
        },
        body: JSON.stringify({
          refreshToken: code,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(`Zast token exchange failed: ${response.status} ${errorText}`);
        throw new Error(`Zast token exchange failed: ${response.status} ${errorText}`);
      }

      const tokenResponse: TokenResponse = (await response.json()) as TokenResponse;
      this.logger.info('Successfully exchanged Zast authorization code for tokens');
      return tokenResponse;
    } catch (error) {
      this.logger.error(`Failed to exchange Zast code for tokens: ${error}`);
      throw new Error(`Failed to exchange Zast code for tokens: ${error}`);
    }
  }

  public async refreshToken(): Promise<void> {
    this.logger.debug('Starting Zast token refresh');
    if (!this._context) {
      const error = 'ZastAuthProvider not initialized';
      this.logger.error(error);
      throw new Error(error);
    }

    const refreshToken = await this._context.globalState.get<string>(this.REFRESH_TOKEN_KEY);

    if (!refreshToken) {
      const error = 'No refresh token available';
      this.logger.error(error);
      throw new Error(error);
    }

    try {
      const response = await fetch(this.REFRESH_TOKEN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/plain, */*',
          'Accept-Language': 'en-US,en;q=0.9,zh;q=0.8,zh-CN;q=0.7',
        },
        body: JSON.stringify({
          refreshToken: refreshToken,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(`Zast token refresh failed: ${response.status} ${errorText}`);

        // Handle session expiration (401 status)
        if (response.status === 401) {
          await this._handleSessionExpiration();
          throw new Error(`Authentication session expired: ${response.status} ${errorText}`);
        }

        throw new Error(`Zast token refresh failed: ${response.status} ${errorText}`);
      }

      const tokenResponse: TokenResponse = (await response.json()) as TokenResponse;

      // Update stored tokens
      this.logger.debug('Updating stored Zast tokens');
      await this._context.globalState.update(this.AUTH_TOKEN_KEY, tokenResponse.accessToken);
      await this._context.globalState.update(this.REFRESH_TOKEN_KEY, tokenResponse.refreshToken);

      // Update expiration time
      const expiresAt = Date.now() + tokenResponse.expiresIn * 1000;
      await this._context.globalState.update(`${this.AUTH_TOKEN_KEY}.expiresAt`, expiresAt);

      // Update refresh token expiration time
      const refreshExpiresAt = Date.now() + tokenResponse.refreshExpiresIn * 1000;
      await this._context.globalState.update(`${this.REFRESH_TOKEN_KEY}.expiresAt`, refreshExpiresAt);

      this.logger.info('Successfully refreshed Zast tokens');

      // Handle force password change flag
      if (tokenResponse.forceChangePwd) {
        this.logger.warn('User needs to change password');
        vscode.window.showWarningMessage('Your password needs to be changed. Please visit the Zast.ai website to update your password.', 'Open Website').then((selection) => {
          if (selection === 'Open Website') {
            vscode.env.openExternal(vscode.Uri.parse('https://zast.ai/profile'));
          }
        });
      }
    } catch (error) {
      this.logger.error(`Failed to refresh Zast token: ${error}`);
      throw new Error(`Failed to refresh Zast token: ${error}`);
    }
  }

  public async getUserInfo(): Promise<UserInfo> {
    return {} as any;
  }

  public static resetInstance(): void {
    if (ZastAuthProvider._instance) {
      ZastAuthProvider._instance.dispose();
      ZastAuthProvider._instance = undefined;
    }
  }
}

/**
 * Clerk Authentication Provider
 */
export class ClerkAuthProvider extends BaseAuthProvider {
  private static _instance: ClerkAuthProvider | undefined;
  protected logger = getPrefixedLogger('ClerkAuth');

  protected readonly PROVIDER_NAME = 'Clerk';
  protected readonly AUTH_TOKEN_KEY = 'clerk.authToken';
  protected readonly REFRESH_TOKEN_KEY = 'clerk.refreshToken';
  public readonly USER_INFO_KEY = 'clerk.userInfo';
  protected readonly ACCESS_TOKEN = 'clerk.accessToken';
  protected readonly CLIENT_ID: string;
  protected readonly CLERK_CLIENT_ID: string = ZastConfig.SAAS_OAUTH_CONFIG.REAL_CLIENT_ID;
  protected readonly AUTH_URL = ZastConfig.SAAS_OAUTH_CONFIG.AUTH_URL;
  protected readonly TOKEN_URL = ZastConfig.SAAS_OAUTH_CONFIG.TOKEN_URL;
  protected readonly REFRESH_TOKEN_URL = ZastConfig.SAAS_OAUTH_CONFIG.TOKEN_URL;
  protected readonly SCOPES = ZastConfig.SAAS_OAUTH_CONFIG.SCOPES;

  private constructor() {
    super();
    this.CLIENT_ID = ZastConfig.EXTENSION_CONFIG.CLIENT_ID;
    this.TOKEN_URL = ZastConfig.SAAS_OAUTH_CONFIG.TOKEN_URL;
  }

  public static getInstance(): ClerkAuthProvider {
    if (!ClerkAuthProvider._instance) {
      ClerkAuthProvider._instance = new ClerkAuthProvider();
    }
    return ClerkAuthProvider._instance;
  }

  protected async _exchangeCodeForTokens(code: string): Promise<TokenResponse> {
    this.logger.debug('Exchanging Clerk authorization code for tokens');
    try {
      if (!this.CLERK_CLIENT_ID) {
        const error = 'Clerk client ID is not configured';
        this.logger.error(error);
        throw new Error(error);
      }

      const response = await fetch(this.TOKEN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: this.CLERK_CLIENT_ID,
          client_secret: ZastConfig.SAAS_OAUTH_CONFIG.CLIENT_SECRET,
          code: code,
          redirect_uri: this.getRedirectUri(),
          scope: this.SCOPES.join(' '),
        }).toString(),
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(`Clerk token exchange failed: ${response.status} ${errorText}`);
        throw new Error(`Clerk token exchange failed: ${response.status} ${errorText}`);
      }

      const clerkResponse: ClerkTokenResponse = (await response.json()) as ClerkTokenResponse;

      if (clerkResponse.access_token) {
        await this.getUserInfo(clerkResponse.access_token);
      }

      this.logger.info('Successfully exchanged Clerk authorization code for tokens');
      // Convert Clerk response to our standard format
      return {
        realAccessToken: clerkResponse.access_token,
        accessToken: clerkResponse.id_token,
        refreshToken: clerkResponse.refresh_token || '',
        tokenType: clerkResponse.token_type,
        expiresIn: clerkResponse.expires_in,
        refreshExpiresIn: clerkResponse.expires_in * 10, // Clerk refresh tokens typically last longer
        forceChangePwd: false,
      };
    } catch (error) {
      this.logger.error(`Failed to exchange Clerk code for tokens: ${error}`);
      throw new Error(`Failed to exchange Clerk code for tokens: ${error}`);
    }
  }

  public async refreshToken(): Promise<void> {
    this.logger.debug('Starting Clerk token refresh');
    if (!this._context) {
      const error = 'ClerkAuthProvider not initialized';
      this.logger.error(error);
      throw new Error(error);
    }

    const refreshToken = await this._context.globalState.get<string>(this.REFRESH_TOKEN_KEY);

    if (!refreshToken) {
      const error = 'No refresh token available';
      this.logger.error(error);
      throw new Error(error);
    }

    try {
      const response = await fetch(this.REFRESH_TOKEN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: new URLSearchParams({
          client_id: this.CLERK_CLIENT_ID,
          client_secret: ZastConfig.SAAS_OAUTH_CONFIG.CLIENT_SECRET,
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          scope: this.SCOPES.join(' '),
        }).toString(),
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(`Clerk token refresh failed: ${response.status} ${errorText}`);

        // Handle session expiration (401 status)
        if (response.status === 401) {
          await this._handleSessionExpiration();
          throw new Error(`Authentication session expired: ${response.status} ${errorText}`);
        }

        throw new Error(`Clerk token refresh failed: ${response.status} ${errorText}`);
      }

      const clerkResponse: ClerkTokenResponse = (await response.json()) as ClerkTokenResponse;
      // const accessToken = (clerkResponse as any).access_token;

      // if (accessToken) {
      //   const userInfoResponse = await fetch('https://clerk.zast.ai/oauth/userinfo', {
      //     headers: {
      //       Authorization: `Bearer ${accessToken}`,
      //     },
      //   });

      //   if (userInfoResponse.ok) {
      //     const userInfo = await userInfoResponse.json();
      //     this.logger.info(`Clerk user info: ${JSON.stringify(userInfo)}`);
      //   } else {
      //     this.logger.error(`Failed to get Clerk user info: ${userInfoResponse.status} ${userInfoResponse.statusText}`);
      //   }
      // }

      // Update stored tokens
      this.logger.debug('Updating stored Clerk tokens');
      if (clerkResponse.id_token) {
        await this._context.globalState.update(this.AUTH_TOKEN_KEY, clerkResponse.id_token);
        // await this.getUserInfo(clerkResponse.id_token);
      }

      if ((clerkResponse as any).access_token) {
        await this._context.globalState.update(this.ACCESS_TOKEN, (clerkResponse as any).access_token);
        await this.getUserInfo((clerkResponse as any).access_token);
      }

      if (clerkResponse.refresh_token) {
        await this._context.globalState.update(this.REFRESH_TOKEN_KEY, clerkResponse.refresh_token);
      }

      // Update expiration time
      const expiresAt = Date.now() + clerkResponse.expires_in * 1000;
      await this._context.globalState.update(`${this.AUTH_TOKEN_KEY}.expiresAt`, expiresAt);

      // Update refresh token expiration time
      const refreshExpiresAt = Date.now() + clerkResponse.expires_in * 10 * 1000;
      await this._context.globalState.update(`${this.REFRESH_TOKEN_KEY}.expiresAt`, refreshExpiresAt);

      this.logger.info('Successfully refreshed Clerk tokens');
    } catch (error) {
      this.logger.error(`Failed to refresh Clerk token: ${error}`);
      throw new Error(`Failed to refresh Clerk token: ${error}`);
    }
  }

  public async getUserInfo(token?: string): Promise<UserInfo> {
    const accessToken = token || (await this._context?.globalState.get<string>(this.ACCESS_TOKEN));

    if (!accessToken) {
      const error = 'No access token available';
      this.logger.error(error);
      throw new Error(error);
    }

    const userInfo = await fetch(ZastConfig.SAAS_OAUTH_CONFIG.USER_INFO_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: new URLSearchParams({
        scope: this.SCOPES.join(' '),
      }).toString(),
    });

    if (!userInfo.ok) {
      const error = 'Failed to get Clerk user info';
      this.logger.error(error);
      throw new Error(error);
    }

    const userInfoResponse = (await userInfo.json()) as any;

    const info = {
      id: userInfoResponse.user_id,
      email: userInfoResponse.email,
      name: userInfoResponse.name,
    } as UserInfo;

    await this._context?.globalState.update(this.USER_INFO_KEY, info);

    return info;
  }

  public static resetInstance(): void {
    if (ClerkAuthProvider._instance) {
      ClerkAuthProvider._instance.dispose();
      ClerkAuthProvider._instance = undefined;
    }
  }
}
