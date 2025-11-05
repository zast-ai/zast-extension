// Frontend communication helper for webview-to-webview communication
import { vscodeApi } from './vscode';

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

/**
 * Frontend communication client for webview-to-webview communication
 * Provides easy-to-use API for sending messages and subscribing to events
 */
export class WebviewCommunicationClient {
  private vscode: any = vscodeApi;
  private eventListeners: Map<string, EventCallback[]> = new Map();

  constructor() {
    this.setupMessageListener();
  }

  /**
   * Setup message listener for incoming messages
   */
  private setupMessageListener(): void {
    window.addEventListener('message', (event) => {
      const message = event.data as WebviewMessage;

      // Handle communication events
      if (message.type === 'comm:event') {
        this.triggerEventListeners(message.data);
      } else if (message.type.startsWith('comm:')) {
        // Handle other communication messages
        this.triggerEventListeners(message);
      } else {
        // Handle regular messages
        this.triggerEventListeners(message);
      }
    });
  }

  /**
   * Broadcast a message to all webviews
   */
  public broadcast(message: WebviewMessage): void {
    this.vscode.postMessage({
      type: 'comm:broadcast',
      data: { message },
    });
  }

  /**
   * Send a message to a specific webview
   */
  public sendToWebview(targetId: string, message: WebviewMessage): void {
    this.vscode.postMessage({
      type: 'comm:send',
      data: { target: targetId, message },
    });
  }

  /**
   * Subscribe to specific message types
   */
  public addEventListener(eventType: string, callback: EventCallback): void {
    if (!this.eventListeners.has(eventType)) {
      this.eventListeners.set(eventType, []);
    }
    this.eventListeners.get(eventType)!.push(callback);

    // Subscribe to the event type from the communication hub
    this.vscode.postMessage({
      type: 'comm:subscribe',
      data: { eventType },
    });
  }

  /**
   * Unsubscribe from specific message types
   */
  public removeEventListener(eventType: string, callback: EventCallback): void {
    const listeners = this.eventListeners.get(eventType);
    if (listeners) {
      const index = listeners.indexOf(callback);
      if (index > -1) {
        listeners.splice(index, 1);
      }
    }
  }

  /**
   * Send a regular message to the extension
   */
  public sendMessage(message: WebviewMessage): void {
    this.vscode.postMessage(message);
  }

  /**
   * Trigger event listeners for a message
   */
  private triggerEventListeners(message: WebviewMessage): void {
    const listeners = this.eventListeners.get(message.type);
    if (listeners) {
      listeners.forEach((callback) => {
        try {
          callback(message);
        } catch (error) {
          console.error(`Error in event listener for ${message.type}:`, error);
        }
      });
    }
  }
}

// Create singleton instance
let communicationClient: WebviewCommunicationClient | null = null;

/**
 * Get the communication client instance
 */
export function getCommunicationClient(): WebviewCommunicationClient {
  if (!communicationClient) {
    communicationClient = new WebviewCommunicationClient();
  }
  return communicationClient;
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
  TUNNEL_PORT_UPDATED: 'tunnel:port-updated',

  // Artifact events
  ARTIFACTS_DISCOVERED: 'artifacts:discovered',
  ARTIFACTS_UPDATED: 'artifacts:updated',

  // General system events
  SYSTEM_STATUS_UPDATED: 'system:status-updated',
  SYSTEM_ERROR: 'system:error',
} as const;

// Helper functions for common operations
export const Communication = {
  /**
   * Subscribe to authentication status changes
   */
  onAuthStatusChanged: (callback: (data: { isAuthenticated: boolean }) => void) => {
    const client = getCommunicationClient();
    client.addEventListener(MessageTypes.AUTH_STATUS_CHANGED, (message) => {
      callback(message.data);
    });
  },

  /**
   * Subscribe to login success events
   */
  onLoginSuccess: (callback: (data: { isAuthenticated: boolean; provider: string }) => void) => {
    const client = getCommunicationClient();
    client.addEventListener(MessageTypes.AUTH_LOGIN_SUCCESS, (message) => {
      callback(message.data);
    });
  },

  /**
   * Subscribe to logout success events
   */
  onLogoutSuccess: (callback: (data: { isAuthenticated: boolean; provider: string }) => void) => {
    const client = getCommunicationClient();
    client.addEventListener(MessageTypes.AUTH_LOGOUT_SUCCESS, (message) => {
      callback(message.data);
    });
  },

  /**
   * Subscribe to session expired events
   */
  onSessionExpired: (callback: (data: { isAuthenticated: boolean; provider: string; message?: string }) => void) => {
    const client = getCommunicationClient();
    client.addEventListener(MessageTypes.AUTH_SESSION_EXPIRED, (message) => {
      callback(message.data);
    });
  },

  /**
   * Subscribe to assessment events
   */
  onAssessmentStarted: (callback: (data: { timestamp: number }) => void) => {
    const client = getCommunicationClient();
    client.addEventListener(MessageTypes.ASSESSMENT_STARTED, (message) => {
      callback(message.data);
    });
  },

  onAssessmentCompleted: (callback: (data: { taskId: string; timestamp: number }) => void) => {
    const client = getCommunicationClient();
    client.addEventListener(MessageTypes.ASSESSMENT_COMPLETED, (message) => {
      callback(message.data);
    });
  },

  onAssessmentFailed: (callback: (data: { error: string; timestamp: number }) => void) => {
    const client = getCommunicationClient();
    client.addEventListener(MessageTypes.ASSESSMENT_FAILED, (message) => {
      callback(message.data);
    });
  },

  /**
   * Subscribe to tunnel events
   */
  onTunnelCreated: (callback: (data: { url: string; port: number }) => void) => {
    const client = getCommunicationClient();
    client.addEventListener(MessageTypes.TUNNEL_CREATED, (message) => {
      callback(message.data);
    });
  },

  onTunnelStopped: (callback: (data: { port: number }) => void) => {
    const client = getCommunicationClient();
    client.addEventListener(MessageTypes.TUNNEL_STOPPED, (message) => {
      callback(message.data);
    });
  },

  onTunnelPortUpdated: (callback: (data: { port: number }) => void) => {
    const client = getCommunicationClient();
    client.addEventListener(MessageTypes.TUNNEL_PORT_UPDATED, (message) => {
      callback(message.data);
    });
  },

  /**
   * Subscribe to task events
   */
  onTaskCreated: (callback: (data: { taskId: string; createdAt: number }) => void) => {
    const client = getCommunicationClient();
    client.addEventListener(MessageTypes.TASK_CREATED, (message) => {
      callback(message.data);
    });
  },

  onTaskStatsUpdated: (callback: (data: any) => void) => {
    const client = getCommunicationClient();
    client.addEventListener(MessageTypes.TASK_STATS_UPDATED, (message) => {
      callback(message.data);
    });
  },

  /**
   * Subscribe to artifact events
   */
  onArtifactsDiscovered: (callback: (data: { artifactList: any[] }) => void) => {
    const client = getCommunicationClient();
    client.addEventListener(MessageTypes.ARTIFACTS_DISCOVERED, (message) => {
      callback(message.data);
    });
  },

  /**
   * Broadcast a message to all webviews
   */
  broadcast: (type: string, data?: any) => {
    const client = getCommunicationClient();
    client.broadcast({ type, data });
  },

  /**
   * Send a message to a specific webview
   */
  sendTo: (targetId: string, type: string, data?: any) => {
    const client = getCommunicationClient();
    client.sendToWebview(targetId, { type, data });
  },

  /**
   * Send a regular message to the extension
   */
  sendMessage: (type: string, data?: any) => {
    const client = getCommunicationClient();
    client.sendMessage({ type, data });
  },
};
