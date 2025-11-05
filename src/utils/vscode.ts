import { WebviewApi } from '@tomjs/vscode-webview';

const Interval = 10000;
const Timeout = Interval * 10;

// Exports class singleton to prevent multiple invocations of acquireVsCodeApi.
export const vscodeApi = new WebviewApi<string>();

export const showAlertDialog = (title: string, message: string) => {
  try {
    vscodeApi.post('showAlert', { title, message });
  } catch (error) {
    console.error('Error showing alert:', error);
  }
};

export const showConfirmDialog = async (title: string, message: string): Promise<boolean> => {
  try {
    const result = await vscodeApi.postAndReceive<{ confirmed: boolean }>('showConfirm', { title, message }, { interval: Interval, timeout: Timeout });
    return result.confirmed;
  } catch (error) {
    console.error('Error showing confirm:', error);
    return false;
  }
};
