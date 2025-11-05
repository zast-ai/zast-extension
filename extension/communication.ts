import * as vscode from 'vscode';
import { getPrefixedLogger } from './logger';

// Message types for inter-webview communication
export interface WebviewMessage {
  type: string;
  data?: any;
  source?: string;
  target?: string;
  timestamp?: number;
}

// Event listener callback type
export type EventCallback = (message: WebviewMessage) => void;

// Interface for webview registration
export interface RegisteredWebview {
  id: string;
  webview: vscode.Webview;
  context?: any;
}

/**
 * Central communication hub for managing webview-to-webview communication
 * Provides event broadcasting, targeted messaging, and subscription management
 */
export class WebviewCommunicationHub {
  private static _instance: WebviewCommunicationHub;
  private _registeredWebviews: Map<string, RegisteredWebview> = new Map();
  private _eventListeners: Map<string, EventCallback[]> = new Map();
  private _logger = getPrefixedLogger('WebviewCommunicationHub');
  private constructor() {}

  /**
   * Get singleton instance
   */
  public static getInstance(): WebviewCommunicationHub {
    if (!WebviewCommunicationHub._instance) {
      WebviewCommunicationHub._instance = new WebviewCommunicationHub();
    }
    return WebviewCommunicationHub._instance;
  }

  /**
   * Register a webview with the communication hub
   */
  public registerWebview(id: string, webview: vscode.Webview, context?: any): void {
    this._logger.info(`Registering webview: ${id}`);

    this._registeredWebviews.set(id, {
      id,
      webview,
      context,
    });

    // Set up message handler for this webview
    webview.onDidReceiveMessage((message: WebviewMessage) => {
      // Add source information to the message
      message.source = id;
      message.timestamp = Date.now();

      // Handle internal communication messages
      if (message.type.startsWith('comm:')) {
        this._handleCommunicationMessage(message);
      }
    });

    // Notify all webviews about the new registration
    this.broadcast({
      type: 'comm:webview-registered',
      data: { webviewId: id },
      source: 'hub',
    });
  }

  /**
   * Unregister a webview from the communication hub
   */
  public unregisterWebview(id: string): void {
    this._logger.info(`Unregistering webview: ${id}`);

    this._registeredWebviews.delete(id);

    // Notify all webviews about the unregistration
    this.broadcast({
      type: 'comm:webview-unregistered',
      data: { webviewId: id },
      source: 'hub',
    });
  }

  /**
   * Broadcast a message to all registered webviews
   */
  public broadcast(message: WebviewMessage, excludeSource: boolean = true): void {
    this._logger.info(`Broadcasting message: ${message.type} ${JSON.stringify(message)}`);

    this._registeredWebviews.forEach((registeredWebview, id) => {
      // Skip the source webview if excludeSource is true
      if (excludeSource && message.source === id) {
        return;
      }

      try {
        registeredWebview.webview.postMessage(message);
      } catch (error) {
        this._logger.error(`Error sending message to webview ${id}: ${error}`);
      }
    });

    // Trigger event listeners
    this._triggerEventListeners(message);
  }

  /**
   * Send a message to a specific webview
   */
  public sendToWebview(targetId: string, message: WebviewMessage): void {
    this._logger.info(`Sending message to webview ${targetId}: ${message.type} ${JSON.stringify(message)}`);

    const target = this._registeredWebviews.get(targetId);
    if (!target) {
      this._logger.warn(`Webview ${targetId} not found`);
      return;
    }

    // Add target information to the message
    message.target = targetId;
    message.timestamp = Date.now();

    try {
      target.webview.postMessage(message);
    } catch (error) {
      this._logger.error(`Error sending message to webview ${targetId}: ${error}`);
    }

    // Trigger event listeners
    this._triggerEventListeners(message);
  }

  /**
   * Subscribe to specific message types
   */
  public addEventListener(eventType: string, callback: EventCallback): void {
    if (!this._eventListeners.has(eventType)) {
      this._eventListeners.set(eventType, []);
    }
    this._eventListeners.get(eventType)!.push(callback);
  }

  /**
   * Unsubscribe from specific message types
   */
  public removeEventListener(eventType: string, callback: EventCallback): void {
    const listeners = this._eventListeners.get(eventType);
    if (listeners) {
      const index = listeners.indexOf(callback);
      if (index > -1) {
        listeners.splice(index, 1);
      }
    }
  }

  /**
   * Get list of registered webview IDs
   */
  public getRegisteredWebviews(): string[] {
    return Array.from(this._registeredWebviews.keys());
  }

  /**
   * Check if a webview is registered
   */
  public isWebviewRegistered(id: string): boolean {
    return this._registeredWebviews.has(id);
  }

  /**
   * Handle internal communication messages
   */
  private _handleCommunicationMessage(message: WebviewMessage): void {
    switch (message.type) {
      case 'comm:broadcast':
        // Re-broadcast message from one webview to all others
        if (message.data && message.data.message) {
          this.broadcast({
            ...message.data.message,
            source: message.source,
          });
        }
        break;

      case 'comm:send':
        // Send message from one webview to another
        if (message.data && message.data.target && message.data.message) {
          this.sendToWebview(message.data.target, {
            ...message.data.message,
            source: message.source,
          });
        }
        break;

      case 'comm:subscribe':
        // Handle subscription requests from webviews
        if (message.data && message.data.eventType) {
          this.addEventListener(message.data.eventType, (msg) => {
            if (message.source) {
              this.sendToWebview(message.source!, {
                type: 'comm:event',
                data: msg,
              });
            }
          });
        }
        break;
    }
  }

  /**
   * Trigger event listeners for a message
   */
  private _triggerEventListeners(message: WebviewMessage): void {
    const listeners = this._eventListeners.get(message.type);
    if (listeners) {
      listeners.forEach((callback) => {
        try {
          callback(message);
        } catch (error) {
          this._logger.error(`Error in event listener for ${message.type}: ${error}`);
        }
      });
    }
  }

  /**
   * Reset instance for testing or cleanup
   */
  public static resetInstance(): void {
    WebviewCommunicationHub._instance = null as any;
  }
}

// Export commonly used message types for convenience
export const MessageTypes = {
  // Authentication events
  AUTH_STATUS_CHANGED: 'auth:status-changed',
  AUTH_LOGIN_SUCCESS: 'auth:login-success',
  AUTH_LOGOUT_SUCCESS: 'auth:logout-success',
  AUTH_SESSION_EXPIRED: 'auth:session-expired',

  // Assessment events
  ASSESSMENT_STARTED: 'assessment:started',
  ASSESSMENT_COMPLETED: 'assessment:completed',
  ASSESSMENT_FAILED: 'assessment:failed',

  // Task events
  TASK_CREATED: 'task:created',
  TASK_UPDATED: 'task:updated',
  TASK_STATS_UPDATED: 'task:stats-updated',
  TASK_LIST_UPDATED: 'task:list-updated',
  TASK_STATUS_CHANGED: 'task:status-changed',

  // Tunnel events
  TUNNEL_CREATED: 'tunnel:created',
  TUNNEL_STOPPED: 'tunnel:stopped',
  TUNNEL_CREATION_FAILED: 'tunnel:creation-failed',
  TUNNEL_PORT_UPDATED: 'tunnel:port-updated',

  // Artifact events
  ARTIFACTS_DISCOVERED: 'artifacts:discovered',
  ARTIFACTS_UPDATED: 'artifacts:updated',

  // Report events
  REPORTS_UPDATED: 'reports:updated',

  // Subscription events
  SUBSCRIPTION_STATUS_CHANGED: 'subscription:status-changed',
  SUBSCRIPTION_CREDIT_LIMIT_CHANGED: 'subscription:credit-limit-changed',
  SUBSCRIPTION_ERROR: 'subscription:error',

  // Payment events
  PAYMENT_SUCCESS: 'payment:success',
  PAYMENT_CANCELLED: 'payment:cancelled',

  // General system events
  SYSTEM_STATUS_UPDATED: 'system:status-updated',
  SYSTEM_ERROR: 'system:error',
  SYSTEM_MESSAGE: 'system:message',
} as const;
