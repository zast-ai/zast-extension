import type { Disposable, ExtensionContext, WebviewPanel } from 'vscode';
import { Uri, ViewColumn, window } from 'vscode';
import { setupHtml } from '../utils/setupHtml';
import { WebviewCommunicationHub, MessageTypes } from '../../communication';
import { getPrefixedLogger } from '../../logger';
import { ZastConfig } from '../../config';
import { MainPanel } from '../assessView/panel';
import { DiscoveryService } from '../../discovery/DiscoveryService';
import { TunnelManager } from '../../tunnel';

export class StartPanel {
  public static currentPanel: StartPanel | undefined;
  private readonly _panel: WebviewPanel;
  private _disposables: Disposable[] = [];
  private _context: ExtensionContext;
  private _communicationHub: WebviewCommunicationHub;
  private _discoveryService: DiscoveryService;
  private _tunnelManager: TunnelManager;
  private _logger = getPrefixedLogger('StartPanel');

  private constructor(panel: WebviewPanel, context: ExtensionContext, communicationHub: WebviewCommunicationHub, discoveryService: DiscoveryService, tunnelManager: TunnelManager) {
    this._panel = panel;
    this._context = context;
    this._communicationHub = communicationHub;
    this._discoveryService = discoveryService;
    this._tunnelManager = tunnelManager;

    // Listen for when the panel is disposed
    // This happens when the user closes the panel or when the panel is closed programmatically
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    // Update the content based on the current state
    this._update();
    this._panel.webview.html = setupHtml(this._panel.webview, this._context, 'start');

    // Register webview with communication hub
    this._communicationHub.registerWebview('start-panel', this._panel.webview, this);

    // Listen for progress updates from other parts of the extension
    this._communicationHub.addEventListener(MessageTypes.SYSTEM_MESSAGE, (message) => {
      if (message.data?.type === 'startProgressUpdate') {
        this._panel.webview.postMessage({
          type: 'startProgressUpdate',
          data: message.data,
        });
      }
    });

    // Handle messages from the webview
    this._panel.webview.onDidReceiveMessage(
      (message) => {
        this._logger.info(`StartPanel.onDidReceiveMessage called: ${JSON.stringify(message)}`);
        switch (message.type) {
          case 'startAssessment':
            this._handleStartAssessment();
            break;
          case 'saveStartProgress':
            this._handleSaveProgress(message.data.completedFeatures);
            break;
          case 'getStartProgress':
            this._handleGetProgress();
            break;
        }
      },
      null,
      this._disposables
    );

    // Load initial progress
    this._handleGetProgress();
  }

  public static render(context: ExtensionContext, communicationHub: WebviewCommunicationHub, discoveryService: DiscoveryService, tunnelManager: TunnelManager): StartPanel {
    const column = window.activeTextEditor ? window.activeTextEditor.viewColumn : undefined;

    // If we already have a panel, show it.
    if (StartPanel.currentPanel) {
      StartPanel.currentPanel._panel.reveal(column);
      return StartPanel.currentPanel;
    }

    // Otherwise, create a new panel.
    const panel = window.createWebviewPanel('startPanel', 'Getting Started - ZAST Express', column || ViewColumn.One, {
      // Enable javascript in the webview
      enableScripts: true,
      // And restrict the webview to only loading content from our extension's directory.
      localResourceRoots: [context.extensionUri, Uri.joinPath(context.extensionUri, 'assets')],
      retainContextWhenHidden: true,
    });

    console.log(`Assets path: ${panel.webview.asWebviewUri(Uri.joinPath(context.extensionUri, 'assets')).toString()}`);

    StartPanel.currentPanel = new StartPanel(panel, context, communicationHub, discoveryService, tunnelManager);

    return StartPanel.currentPanel;
  }

  public static revive(panel: WebviewPanel, context: ExtensionContext, communicationHub: WebviewCommunicationHub, discoveryService: DiscoveryService, tunnelManager: TunnelManager): StartPanel {
    StartPanel.currentPanel = new StartPanel(panel, context, communicationHub, discoveryService, tunnelManager);
    return StartPanel.currentPanel;
  }

  public dispose(): void {
    StartPanel.currentPanel = undefined;

    // Clean up our resources
    this._panel.dispose();

    // Unregister webview from communication hub
    this._communicationHub.unregisterWebview('start-panel');

    while (this._disposables.length) {
      const disposable = this._disposables.pop();
      if (disposable) {
        disposable.dispose();
      }
    }
  }

  private _update(): void {
    const webview = this._panel.webview;
    this._panel.title = 'Getting Started - ZAST Express';
    this._panel.webview.html = setupHtml(webview, this._context, 'start');
  }

  private async _handleStartAssessment() {
    try {
      this._logger.info('Starting security assessment from start panel');

      // Broadcast assessment start event
      this._communicationHub.broadcast({
        type: MessageTypes.ASSESSMENT_STARTED,
        data: { timestamp: Date.now(), source: 'start-panel' },
        source: 'start-panel',
      });

      // Render the MainPanel directly
      MainPanel.render(this._context, this._discoveryService, this._tunnelManager, null, this._communicationHub);

      // Optionally close the start panel after starting assessment
      this.dispose();
    } catch (error) {
      this._logger.error(`Error starting assessment: ${error}`);
      window.showErrorMessage(`Failed to start assessment: ${error}`);

      // Broadcast assessment failure event
      this._communicationHub.broadcast({
        type: MessageTypes.ASSESSMENT_FAILED,
        data: { error: (error as Error).message, timestamp: Date.now() },
        source: 'start-panel',
      });
    }
  }

  private async _handleSaveProgress(completedFeatures: string) {
    try {
      this._logger.info(`Saving start panel progress: ${JSON.stringify(completedFeatures)}`);
      await this._context.globalState.update('zast.startPageProgress', JSON.parse(completedFeatures));

      // Check if all features are completed
      const allCompleted = Object.values(JSON.parse(completedFeatures)).every((feature) => feature);
      if (allCompleted) {
        this._logger.info('All onboarding features completed');

        // Mark onboarding as completed
        await StartPanel.markOnboardingCompleted(this._context);

        // Show completion notification
        const result = await window.showInformationMessage("Congratulations! You've completed the ZAST Express getting started guide.", 'Start Assessment', 'Close');

        if (result === 'Start Assessment') {
          this._handleStartAssessment();
          this.dispose();
        } else if (result === 'Close') {
          this.dispose();
        }
      }
    } catch (error) {
      this._logger.error(`Error saving start progress: ${error}`);
    }
  }

  private async _handleGetProgress() {
    try {
      const savedProgress = this._context.globalState.get<{ [key: string]: boolean }>('zast.startPageProgress');
      this._logger.info(`Loading start panel progress: ${JSON.stringify(savedProgress)}`);

      if (this._panel) {
        this._panel.webview.postMessage({
          type: 'loadStartProgress',
          data: {
            baseUrl: this._panel.webview.asWebviewUri(Uri.joinPath(this._context.extensionUri, 'dist/webview')).toString(),
            completedFeatures: savedProgress,
          },
        });
      }
    } catch (error) {
      this._logger.error(`Error getting start progress: ${error}`);
    }
  }

  /**
   * Check if start panel should be shown (first time user)
   */
  public static async shouldShowStartPanel(context: ExtensionContext): Promise<boolean> {
    const onboardingCompleted = context.globalState.get<boolean>('zast.onboardingCompleted', false);

    // Show start panel if onboarding not completed
    return !onboardingCompleted;
  }

  /**
   * Reset start panel state (for testing or user request)
   */
  public static async resetStartPanelState(context: ExtensionContext): Promise<void> {
    await context.globalState.update('zast.startPageProgress', undefined);
    await context.globalState.update('zast.onboardingCompleted', false);
  }

  /**
   * Mark onboarding as completed
   */
  public static async markOnboardingCompleted(context: ExtensionContext): Promise<void> {
    await context.globalState.update('zast.onboardingCompleted', true);
  }
}
