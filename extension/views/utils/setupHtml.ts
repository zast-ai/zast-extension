import type { ExtensionContext, Webview } from 'vscode';

export function setupHtml(webview: Webview, context: ExtensionContext, inputName: string) {
  return __getWebviewHtml__({
    serverUrl: `${process.env.VITE_DEV_SERVER_URL}/view-${inputName}.html`,
    webview,
    context,
    inputName: `view-${inputName}`,
  });
}
