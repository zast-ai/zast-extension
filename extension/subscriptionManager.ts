import * as vscode from 'vscode';
import { getPrefixedLogger } from './logger';
import { WebviewCommunicationHub, MessageTypes } from './communication';

const logger = getPrefixedLogger('SubscriptionManager');

/**
 * Subscription category types
 */
export type SubscriptionCategory = 'trial' | 'none' | 'pro' | 'enterprise';

/**
 * Subscription status interface
 */
export interface SubscriptionStatus {
  category: SubscriptionCategory;
  activeSubscriptionId?: string;
  exceedCreditLimit: boolean;
  creditsUsage: number;
  firstTierLimit: number;
}

/**
 * Default subscription status
 */
const DEFAULT_SUBSCRIPTION_STATUS: SubscriptionStatus = {
  category: 'none',
  exceedCreditLimit: false,
  creditsUsage: 0,
  firstTierLimit: 0,
};

/**
 * Subscription Manager (Singleton)
 * Manages subscription status storage and notifications
 */
export class SubscriptionManager {
  private static _instance: SubscriptionManager | undefined;
  private context: vscode.ExtensionContext;
  private communicationHub?: WebviewCommunicationHub;
  private _currentStatus: SubscriptionStatus | undefined;

  // Storage keys
  private static readonly SUBSCRIPTION_STATUS_KEY = 'zast.subscription.status';

  private constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.loadCachedStatus();
  }

  /**
   * Get singleton instance
   */
  public static getInstance(context: vscode.ExtensionContext): SubscriptionManager {
    if (!SubscriptionManager._instance) {
      SubscriptionManager._instance = new SubscriptionManager(context);
    } else if (SubscriptionManager._instance.context !== context) {
      SubscriptionManager._instance.context = context;
      SubscriptionManager._instance.loadCachedStatus();
    }
    return SubscriptionManager._instance;
  }

  /**
   * Set communication hub for broadcasting events
   */
  public setCommunicationHub(communicationHub: WebviewCommunicationHub): void {
    this.communicationHub = communicationHub;
  }

  /**
   * Reset singleton instance
   */
  public static resetInstance(): void {
    SubscriptionManager._instance = undefined;
  }

  /**
   * Load stored subscription status from VSCode globalState
   */
  private async loadCachedStatus(): Promise<void> {
    try {
      const stored = await this.context.globalState.get<SubscriptionStatus>(SubscriptionManager.SUBSCRIPTION_STATUS_KEY);
      if (stored) {
        this._currentStatus = stored;
        logger.debug(`Loaded stored subscription status: ${stored.category}`);
      } else {
        this._currentStatus = { ...DEFAULT_SUBSCRIPTION_STATUS };
        logger.debug('No stored subscription status found, using default');
      }
    } catch (error) {
      logger.error(`Failed to load stored subscription status: ${error}`);
      this._currentStatus = { ...DEFAULT_SUBSCRIPTION_STATUS };
    }
  }

  /**
   * Get current subscription status (from storage or API if forceRefresh)
   */
  public async getSubscriptionStatus(forceRefresh: boolean = false): Promise<SubscriptionStatus> {
    // If forcing refresh or no current status, fetch from API
    if (forceRefresh || !this._currentStatus) {
      logger.debug('Fetching fresh subscription status from API');
      return await this.refreshSubscriptionStatus();
    }

    // Return stored status
    logger.debug('Returning stored subscription status');
    return this._currentStatus;
  }

  /**
   * Refresh subscription status from API and store it
   */
  public async refreshSubscriptionStatus(): Promise<SubscriptionStatus> {
    try {
      // We'll import these functions only when needed to avoid circular dependencies
      const { fetchActiveSubscriptionCategory, fetchExceedCreditLimit } = await import('./httpC');

      // Fetch both subscription category and credit limit status
      const [categoryResponse, creditLimitResponse] = await Promise.all([
        fetchActiveSubscriptionCategory(this.context).catch((error) => {
          logger.warn(`Failed to fetch subscription category: ${error}`);
          return { category: 'none' as SubscriptionCategory };
        }),
        fetchExceedCreditLimit(this.context).catch((error) => {
          logger.warn(`Failed to fetch credit limit: ${error}`);
          return {
            activeSubscriptionId: undefined,
            exceedCreditLimit: false,
            creditsUsage: 0,
            firstTierLimit: 0,
          };
        }),
      ]);

      const newStatus: SubscriptionStatus = {
        category: categoryResponse.category,
        activeSubscriptionId: creditLimitResponse.activeSubscriptionId,
        exceedCreditLimit: creditLimitResponse.exceedCreditLimit,
        creditsUsage: creditLimitResponse.creditsUsage,
        firstTierLimit: creditLimitResponse.firstTierLimit,
      };

      // Update stored status
      await this.updateSubscriptionStatus(newStatus);

      logger.info(`Successfully refreshed subscription status: ${newStatus.category}`);
      return newStatus;
    } catch (error) {
      logger.error(`Failed to refresh subscription status: ${error}`);

      // Return stored status if available, otherwise default
      if (this._currentStatus) {
        return this._currentStatus;
      } else {
        const defaultStatus = { ...DEFAULT_SUBSCRIPTION_STATUS };
        await this.updateSubscriptionStatus(defaultStatus);
        return defaultStatus;
      }
    }
  }

  /**
   * Update subscription status and save to VSCode storage
   */
  private async updateSubscriptionStatus(status: SubscriptionStatus): Promise<void> {
    try {
      const previousStatus = this._currentStatus;
      this._currentStatus = status;

      // Save to persistent storage
      await this.context.globalState.update(SubscriptionManager.SUBSCRIPTION_STATUS_KEY, status);

      // Broadcast status change if category changed
      if (previousStatus && previousStatus.category !== status.category) {
        this.broadcastStatusChange(status);
        logger.info(`Subscription category changed: ${previousStatus.category} -> ${status.category}`);
      }

      // Broadcast credit limit status if exceedCreditLimit changed
      if (previousStatus && previousStatus.exceedCreditLimit !== status.exceedCreditLimit) {
        this.broadcastCreditLimitChange(status);
        logger.info(`Credit limit status changed: ${previousStatus.exceedCreditLimit} -> ${status.exceedCreditLimit}`);
      }
    } catch (error) {
      logger.error(`Failed to update subscription status: ${error}`);
    }
  }

  /**
   * Get subscription category only
   */
  public async getSubscriptionCategory(forceRefresh: boolean = false): Promise<SubscriptionCategory> {
    const status = await this.getSubscriptionStatus(forceRefresh);
    return status.category;
  }

  /**
   * Check if user has exceeded credit limit
   */
  public async hasExceededCreditLimit(forceRefresh: boolean = false): Promise<boolean> {
    const status = await this.getSubscriptionStatus(forceRefresh);
    return status.exceedCreditLimit;
  }

  /**
   * Check if user has active subscription (not 'none' or 'trial' with credits)
   */
  public async hasActiveSubscription(forceRefresh: boolean = false): Promise<boolean> {
    const status = await this.getSubscriptionStatus(forceRefresh);
    return status.category === 'pro' || status.category === 'enterprise' || (status.category === 'trial' && !status.exceedCreditLimit);
  }

  /**
   * Handle subscription error (e.g., from HTTP client when errCode = 1010)
   */
  public async handleSubscriptionError(): Promise<void> {
    logger.warn('Subscription error detected, refreshing status');

    try {
      // Force refresh subscription status
      await this.refreshSubscriptionStatus();

      // Broadcast subscription error event
      this.broadcastSubscriptionError();
    } catch (error) {
      logger.error(`Failed to handle subscription error: ${error}`);
    }
  }

  /**
   * Broadcast subscription status change event
   */
  private broadcastStatusChange(status: SubscriptionStatus): void {
    if (this.communicationHub) {
      this.communicationHub.broadcast({
        type: MessageTypes.SUBSCRIPTION_STATUS_CHANGED,
        data: {
          category: status.category,
          exceedCreditLimit: status.exceedCreditLimit,
          creditsUsage: status.creditsUsage,
          firstTierLimit: status.firstTierLimit,
        },
        source: 'subscription-manager',
      });
    }
  }

  /**
   * Broadcast credit limit change event
   */
  private broadcastCreditLimitChange(status: SubscriptionStatus): void {
    if (this.communicationHub) {
      this.communicationHub.broadcast({
        type: MessageTypes.SUBSCRIPTION_CREDIT_LIMIT_CHANGED,
        data: {
          exceedCreditLimit: status.exceedCreditLimit,
          creditsUsage: status.creditsUsage,
          firstTierLimit: status.firstTierLimit,
        },
        source: 'subscription-manager',
      });
    }
  }

  /**
   * Broadcast subscription error event
   */
  private broadcastSubscriptionError(): void {
    if (this.communicationHub) {
      this.communicationHub.broadcast({
        type: MessageTypes.SUBSCRIPTION_ERROR,
        data: {
          message: 'Subscription status needs to be updated due to API error',
          errorCode: 1010,
        },
        source: 'subscription-manager',
      });
    }
  }

  /**
   * Clear stored subscription status
   */
  public async clearStorage(): Promise<void> {
    try {
      this._currentStatus = { ...DEFAULT_SUBSCRIPTION_STATUS };
      await this.context.globalState.update(SubscriptionManager.SUBSCRIPTION_STATUS_KEY, undefined);
      logger.info('Subscription status storage cleared');
    } catch (error) {
      logger.error(`Failed to clear subscription status storage: ${error}`);
    }
  }

  /**
   * Get current stored status without API call
   */
  public getCurrentStoredStatus(): SubscriptionStatus {
    return this._currentStatus || { ...DEFAULT_SUBSCRIPTION_STATUS };
  }
}
