import * as vscode from 'vscode';
import { setupHtml } from '../utils/setupHtml';
import { ZastConfig } from '../../config';

export class HelpViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'help';

  private _view?: vscode.WebviewView;
  private _context: vscode.ExtensionContext;

  constructor(context: vscode.ExtensionContext) {
    this._context = context;
  }

  public resolveWebviewView(webviewView: vscode.WebviewView, context: vscode.WebviewViewResolveContext, _token: vscode.CancellationToken) {
    console.log('HelpViewProvider.resolveWebviewView called');
    this._view = webviewView;

    webviewView.webview.options = {
      // Allow scripts in the webview
      enableScripts: true,
      localResourceRoots: [this._context.extensionUri],
    };

    webviewView.webview.html = setupHtml(webviewView.webview, this._context, 'help');

    // Handle messages from webview
    webviewView.webview.onDidReceiveMessage((message) => {
      console.log('HelpViewProvider.onDidReceiveMessage called', message);
      switch (message.type) {
        case 'reportBug':
          this._handleReportBug();
          break;
        case 'getHelp':
          this._handleGetHelp();
          break;
        case 'emailSupport':
          this._handleEmailSupport();
          break;
      }
    });

    // Send initial configuration to webview
    this._sendConfigToWebview();
  }

  private _sendConfigToWebview() {
    if (!this._view) return;

    try {
      this._view.webview.postMessage({
        type: 'updateConfig',
        data: {
          reportUrl: ZastConfig.getReportUrl(),
          helpUrl: ZastConfig.getHelpUrl(),
          supportEmail: ZastConfig.getSupportEmail(),
        },
      });
    } catch (error) {
      console.error('Error sending config to help webview:', error);
    }
  }

  private _handleReportBug() {
    const reportUrl = ZastConfig.getReportUrl();
    vscode.env.openExternal(vscode.Uri.parse(reportUrl));
  }

  private _handleGetHelp() {
    const helpUrl = ZastConfig.getHelpUrl();
    vscode.env.openExternal(vscode.Uri.parse(helpUrl));
  }

  private _handleEmailSupport() {
    const supportEmail = ZastConfig.getSupportEmail();
    const subject = encodeURIComponent('Zast Express Support Request');
    const body = encodeURIComponent('Hi Zast Team,\n\nI need help with:\n\n[Please describe your issue here]\n\nThanks!');
    const mailtoUrl = `mailto:${supportEmail}?subject=${subject}&body=${body}`;
    vscode.env.openExternal(vscode.Uri.parse(mailtoUrl));
  }
}
