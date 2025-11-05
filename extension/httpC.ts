import * as vscode from 'vscode';
import { ZastAuth } from './auth';
import { ZastConfig } from './config';
import * as fs from 'fs';
import * as path from 'path';
import fetch from 'node-fetch';
import FormData from 'form-data';
import JSZip from 'jszip';

import { getPrefixedLogger } from './logger';
import { SubscriptionManager } from './subscriptionManager';

const logger = getPrefixedLogger('HttpC');

/**
 * HTTP 客户端配置接口
 */
interface HttpClientConfig {
  baseUrl: string;
  timeout?: number;
  retries?: number;
}

/**
 * HTTP 请求选项
 */
type ResponseType = 'json' | 'text' | 'buffer';

interface RequestOptions {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  headers?: Record<string, string>;
  body?: any;
  timeout?: number;
  isFormData?: boolean;
  responseType?: ResponseType;
}

/**
 * API 响应包装类型
 */
interface ApiResponse<T = any> {
  data: T;
  success: boolean;
  message?: string;
  total?: number;
}

/**
 * HTTP 客户端异常类
 */
class HttpClientError extends Error {
  constructor(message: string, public status?: number, public response?: any) {
    super(message);
    this.name = 'HttpClientError';
  }
}

/**
 * 统一的 HTTP 客户端类
 */
class HttpClient {
  private config: HttpClientConfig;
  private context: vscode.ExtensionContext;
  private subscriptionManager: SubscriptionManager;

  constructor(context: vscode.ExtensionContext, config?: Partial<HttpClientConfig>) {
    this.context = context;
    this.subscriptionManager = SubscriptionManager.getInstance(context);
    this.config = {
      baseUrl: ZastConfig.getApiBaseUrl(),
      timeout: 30000,
      retries: 3,
      ...config,
    };
  }

  /**
   * 获取认证头
   */
  private async getAuthHeaders(): Promise<Record<string, string>> {
    const authToken = await ZastAuth.getInstance(this.context).getAuthToken();
    if (!authToken) {
      throw new HttpClientError('Authentication token not available. Please login first.');
    }
    return {
      authorization: `Bearer ${authToken}`,
    };
  }

  /**
   * 统一的请求方法
   */
  private async request<T = any>(endpoint: string, options: RequestOptions): Promise<T> {
    const url = `${this.config.baseUrl}${endpoint}`;
    let lastError: any;

    for (let attempt = 0; attempt <= this.config.retries!; attempt++) {
      try {
        // 准备请求头
        const authHeaders = await this.getAuthHeaders();
        const headers = {
          ...authHeaders,
          ...options.headers,
        };

        // 如果不是 FormData，设置 Content-Type
        if (!options.isFormData && options.body && !headers['Content-Type']) {
          headers['content-type'] = 'application/json';
        }

        // 准备请求体
        let body = options.body;
        if (body && !options.isFormData && typeof body === 'object') {
          body = JSON.stringify(body);
        }

        logger.debug(`Making ${options.method} request to: ${url} (attempt ${attempt + 1})`);

        const response = await fetch(url, {
          method: options.method,
          headers,
          body,
        });

        // 处理响应
        return await this.handleResponse<T>(response, options.responseType);
      } catch (error) {
        lastError = error;
        logger.warn(`Request attempt ${attempt + 1} failed for ${options.method} ${url}: ${error}`);

        // 如果是最后一次尝试或者是认证错误，直接抛出错误
        if (attempt === this.config.retries || this.isAuthError(error)) {
          break;
        }

        // 等待后重试
        await this.delay(Math.pow(2, attempt) * 1000);
      }
    }

    logger.error(`All ${this.config.retries! + 1} attempts failed for ${options.method} ${url}`);
    throw this.handleError(lastError);
  }

  /**
   * 判断是否为认证错误
   */
  private isAuthError(error: any): boolean {
    return error instanceof HttpClientError && error.status === 401;
  }

  /**
   * 延迟函数
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * 统一的响应处理
   */
  private async handleResponse<T>(response: any, responseType: ResponseType = 'json'): Promise<T> {
    let arrayBuffer: ArrayBuffer | undefined;
    let buffer: Buffer | undefined;
    let responseText: string | undefined;

    if (responseType === 'buffer') {
      arrayBuffer = await response.arrayBuffer();
      buffer = Buffer.from(arrayBuffer);
    } else if (responseType === 'text') {
      responseText = await response.text();
    } else {
      responseText = await response.text();
    }

    if (!response.ok) {
      if (!responseText && buffer) {
        responseText = buffer.toString('utf-8');
      }
      // Check for subscription error (HTTP 500 with errCode 1010)
      if (response.status === 500) {
        try {
          const errorData = JSON.parse(responseText);
          if (errorData && errorData.data && errorData.data.errCode === 1010) {
            logger.warn('Detected subscription error (errCode: 1010), handling subscription status');

            // Handle subscription error asynchronously
            this.subscriptionManager.handleSubscriptionError().catch((error) => {
              logger.error(`Failed to handle subscription error: ${error}`);
            });

            throw new HttpClientError('Subscription error: Please check your subscription status', response.status, responseText);
          }
        } catch (parseError) {
          // If we can't parse the error response, continue with normal error handling
          logger.debug(`Could not parse error response for subscription check: ${parseError}`);
        }
      }

      throw new HttpClientError(`HTTP ${response.status}: ${response.statusText}`, response.status, responseText);
    }

    if (responseType === 'buffer' && buffer) {
      return buffer as unknown as T;
    }

    if (responseType === 'text' && responseText !== undefined) {
      logger.debug(`Response text: ${responseText}`);
      return responseText as unknown as T;
    }

    if (responseText === undefined) {
      responseText = await response.text();
    }

    try {
      const data = JSON.parse(responseText);
      logger.debug(`Response data: ${JSON.stringify(data)}`);
      return data as T;
    } catch (parseError) {
      throw new HttpClientError(`Failed to parse response: ${parseError}`, response.status, responseText);
    }
  }

  /**
   * 统一的错误处理
   */
  private handleError(error: any): HttpClientError {
    if (error instanceof HttpClientError) {
      // Handle 401 authentication error
      if (error.status === 401) {
        this.handleAuthenticationError();
      }
      return error;
    }

    if (error.code === 'ECONNRESET' || error.code === 'ECONNREFUSED') {
      return new HttpClientError('Network connection failed. Please check your internet connection.');
    }

    if (error.name === 'AbortError') {
      return new HttpClientError('Request timeout. Please try again.');
    }

    return new HttpClientError(`Request failed: ${error.message}`);
  }

  /**
   * 处理认证错误
   */
  private handleAuthenticationError(): void {
    try {
      // Get the current authentication provider and trigger session expiration
      const auth = ZastAuth.getInstance(this.context);
      // Note: We can't directly call handleSessionExpiration here because it's not exposed
      // Instead, we'll clear the session through the auth manager
      auth.logout().catch((logoutError) => {
        logger.error(`Failed to logout after authentication error: ${logoutError}`);
      });
    } catch (error) {
      logger.error(`Error handling authentication error: ${error}`);
    }
  }

  /**
   * GET 请求
   */
  async get<T = any>(endpoint: string, headers?: Record<string, string>): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'GET',
      headers,
    });
  }

  /**
   * POST 请求
   */
  async post<T = any>(endpoint: string, data?: any, headers?: Record<string, string>): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'POST',
      body: data,
      headers,
    });
  }

  /**
   * PUT 请求
   */
  async put<T = any>(endpoint: string, data?: any, headers?: Record<string, string>): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'PUT',
      body: data,
      headers,
    });
  }

  /**
   * DELETE 请求
   */
  async delete<T = any>(endpoint: string, headers?: Record<string, string>): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'DELETE',
      headers,
    });
  }

  /**
   * 上传文件请求
   */
  async uploadFile<T = any>(endpoint: string, filePath: string, fieldName: string = 'file', responseType: ResponseType = 'json'): Promise<T> {
    const formData = new FormData();
    const fileStream = fs.createReadStream(filePath);
    const fileName = path.basename(filePath);

    fileStream.on('error', (error) => {
      logger.error(`File stream error: ${error}`);
      throw error;
    });

    formData.append(fieldName, fileStream, fileName);

    return this.request<T>(endpoint, {
      method: 'POST',
      body: formData,
      headers: formData.getHeaders(),
      isFormData: true,
      responseType,
    });
  }
}

// 导出数据类型
export interface TableData {
  taskId: string;
  lang: string;
  projectName: string;
  taskStatus: 'CREATED' | 'RUNNING' | 'FINISHED' | 'FAILED' | 'SUCCESS';
  createdAt: string;
  updatedAt: string;
  errCode?: number;
  errDetail?: string;
  resultsStat: {
    total: number;
    lowCount: number;
    highCount: number;
    mediumCount: number;
    criticalCount: number;
    purchased: number;
  };
}

export interface TaskDetail extends TableData {
  analysisResults?: any[];
  sourceCode?: string;
  metrics?: object;
}

export interface TaskCreationResponse {
  taskId: string;
  status: string;
  createdAt: string;
}

interface TaskDetailResponse {
  taskId: string;
  lang: string;
  projectName: string;
  taskStatus: 'CREATED' | 'RUNNING' | 'FINISHED' | 'FAILED' | 'SUCCESS';
  createdAt: string;
  updatedAt: string;
  executedAt?: string;
  createdBy?: string;
  sourceCode?: string;
  tokenUsed?: number;
  params?: {
    originRequestData?: {
      javaPackage: string;
      browserBoxId?: string | null;
      primarySourceCode?: string | null;
      sandboxHomePageUrl: string;
      javaPackageFileName: string;
      sandboxTargetServiceUrl: string;
    };
    poc?: {
      sandboxUrl: string;
      browserBoxId?: string | null;
      useLocalPython?: boolean;
    };
    pf?: {
      buildTargetFile: string;
    };
  };
  resultsStat?: {
    total: number;
    detail?: any[];
    lowCount: number;
    highCount: number;
    mediumCount: number;
    criticalCount: number;
    purchased: number;
  };
}

export interface Issue {
  ovId: number;
  vulId: string;
  category: string;
  description: string;
  cweId: string;
  taskId: string;
  purchaseStatus: string;
  price: number;
  severity: string;
}

export interface PocDetail {
  ovId: number;
  vulId: string;
  taskId: string;
  taskLang: string;
  category: string;
  description: string;
  cweId: string;
  severity: string;
  source: {
    file: string;
    method: string;
    message: string;
    location: {
      file_uri: string;
      end_column: number;
      start_line: number;
      start_column: number;
    };
    code_snippet: string;
  };
  sink: {
    file: string;
    method: string;
    message: string;
    location: {
      file_uri: string;
      end_column: number;
      start_line: number;
      start_column: number;
    };
    code_snippet: string;
  };
  apiPath: string;
  apiMethod: string;
  location: string;
  verifyResult: string;
  pocScript: string;
  pocScriptOutput: string;
  purchaseStatus: string;
  componentTask: boolean;
}

// 创建 HTTP 客户端实例
function createHttpClient(context: vscode.ExtensionContext): HttpClient {
  return new HttpClient(context);
}

// 导出类和接口供外部使用
export { HttpClient, HttpClientError, HttpClientConfig, RequestOptions, ApiResponse };

// 重构后的 API 方法
export async function fetchJobList(context: vscode.ExtensionContext): Promise<TableData[]> {
  try {
    const client = createHttpClient(context);
    const response = await client.post<{
      data: TableData[];
      total: number;
    }>('/oxpecker/api/v1/tasks/search', {
      page: 0,
      size: 10,
    });

    return response.data.map((item) => ({
      taskId: item.taskId,
      lang: item.lang,
      projectName: item.projectName,
      taskStatus: item.taskStatus as any,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      errCode: item.errCode,
      errDetail: item.errDetail,
      resultsStat: {
        total: item.resultsStat?.total || 0,
        lowCount: item.resultsStat?.lowCount || 0,
        highCount: item.resultsStat?.highCount || 0,
        mediumCount: item.resultsStat?.mediumCount || 0,
        criticalCount: item.resultsStat?.criticalCount || 0,
        purchased: item.resultsStat?.purchased || 0,
      },
    }));
  } catch (error) {
    logger.error(`Error fetching job list: ${error}`);
    vscode.window.showErrorMessage(`Failed to fetch job list: ${error}`);
    return [];
  }
}

export async function uploadFile(context: vscode.ExtensionContext, filePath: string): Promise<any> {
  try {
    const client = createHttpClient(context);
    return await client.uploadFile('/oxpecker/api/v1/files/upload', filePath);
  } catch (error) {
    logger.error(`Error uploading file: ${error}`);
    vscode.window.showErrorMessage(`Failed to upload file: ${error}`);
    throw error;
  }
}

/**
 * Get current project information (name and language)
 */
export async function getCurrentProjectInfo(context: vscode.ExtensionContext): Promise<{
  projectName: string;
  lang: string;
}> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    // Fallback to extension name if no workspace
    return {
      projectName: 'unknown-project',
      lang: 'JAVA',
    };
  }

  const workspaceFolder = workspaceFolders[0];
  const workspacePath = workspaceFolder.uri.fsPath;

  // Get project name from multiple sources (priority order)
  let projectName = await getProjectNameFromSources(workspacePath);

  // Detect language by checking for project files
  let detectedLang = await detectProjectLanguage();

  logger.info(`Detected project: ${projectName}, language: ${detectedLang}`);

  return {
    projectName,
    lang: detectedLang,
  };
}

/**
 * Get project name from various sources
 */
async function getProjectNameFromSources(workspacePath: string): Promise<string> {
  try {
    // 1. Try to get from package.json
    const packageJsonFiles = await vscode.workspace.findFiles('**/package.json', '**/node_modules/**');
    if (packageJsonFiles.length > 0) {
      try {
        const packageJsonContent = await vscode.workspace.fs.readFile(packageJsonFiles[0]);
        const packageJson = JSON.parse(packageJsonContent.toString());
        if (packageJson.name) {
          return packageJson.name;
        }
      } catch (error) {
        logger.error(`Error reading package.json: ${error}`);
      }
    }

    // 2. Try to get from Maven pom.xml
    const pomFiles = await vscode.workspace.findFiles('**/pom.xml', '**/node_modules/**');
    if (pomFiles.length > 0) {
      try {
        const pomContent = await vscode.workspace.fs.readFile(pomFiles[0]);
        const pomStr = pomContent.toString();
        const artifactIdMatch = pomStr.match(/<artifactId>(.*?)<\/artifactId>/);
        if (artifactIdMatch && artifactIdMatch[1]) {
          return artifactIdMatch[1];
        }
      } catch (error) {
        logger.error(`Error reading pom.xml: ${error}`);
      }
    }

    // 3. Try to get from Gradle build.gradle
    const gradleFiles = await vscode.workspace.findFiles('**/build.gradle*', '**/node_modules/**');
    if (gradleFiles.length > 0) {
      try {
        const gradleContent = await vscode.workspace.fs.readFile(gradleFiles[0]);
        const gradleStr = gradleContent.toString();
        const archiveBaseNameMatch = gradleStr.match(/(?:archiveBaseName|baseName)\s*=\s*['"]([^'"]+)['"]/);
        if (archiveBaseNameMatch && archiveBaseNameMatch[1]) {
          return archiveBaseNameMatch[1];
        }
      } catch (error) {
        logger.error(`Error reading build.gradle: ${error}`);
      }
    }

    // 4. Fallback to workspace folder name
    return path.basename(workspacePath);
  } catch (error) {
    logger.error(`Error getting project name: ${error}`);
    return path.basename(workspacePath);
  }
}

/**
 * Detect project language based on project files
 */
async function detectProjectLanguage(): Promise<string> {
  try {
    // Check for Java projects (Maven/Gradle)
    const pomFiles = await vscode.workspace.findFiles('**/pom.xml', '**/node_modules/**');
    const gradleFiles = await vscode.workspace.findFiles('**/build.gradle*', '**/node_modules/**');

    if (pomFiles.length > 0 || gradleFiles.length > 0) {
      return 'JAVA';
    }

    // Check for Python projects
    const pythonFiles = await vscode.workspace.findFiles('**/*.py', '**/node_modules/**');
    const requirementsTxt = await vscode.workspace.findFiles('**/requirements.txt', '**/node_modules/**');
    const pipfile = await vscode.workspace.findFiles('**/Pipfile', '**/node_modules/**');

    if (pythonFiles.length > 0 || requirementsTxt.length > 0 || pipfile.length > 0) {
      return 'PYTHON';
    }

    // Check for Node.js projects
    const packageJsonFiles = await vscode.workspace.findFiles('**/package.json', '**/node_modules/**');
    if (packageJsonFiles.length > 0) {
      return 'NODEJS';
    }

    // Check for Go projects
    const goFiles = await vscode.workspace.findFiles('**/*.go', '**/node_modules/**');
    const goMod = await vscode.workspace.findFiles('**/go.mod', '**/node_modules/**');

    if (goFiles.length > 0 || goMod.length > 0) {
      return 'GO';
    }

    // Check for C# projects
    const csharpFiles = await vscode.workspace.findFiles('**/*.cs', '**/node_modules/**');
    const csprojFiles = await vscode.workspace.findFiles('**/*.csproj', '**/node_modules/**');

    if (csharpFiles.length > 0 || csprojFiles.length > 0) {
      return 'CSHARP';
    }

    // Check for PHP projects
    const phpFiles = await vscode.workspace.findFiles('**/*.php', '**/node_modules/**');
    const composerJson = await vscode.workspace.findFiles('**/composer.json', '**/node_modules/**');

    if (phpFiles.length > 0 || composerJson.length > 0) {
      return 'PHP';
    }

    // Default to JAVA if no specific language detected
    return 'JAVA';
  } catch (error) {
    logger.error(`Error detecting project language: ${error}`);
    return 'JAVA';
  }
}

export async function createTask(
  context: vscode.ExtensionContext,
  params: {
    projectName: string;
    lang: string;
    javaPackage?: string;
    primarySourceCode?: string;
    sandboxTargetServiceUrl: string;
    sandboxHomePageUrl: string;
    sandboxAuthInfos: {
      roleName: string;
      loginUrl: string;
      originRequestData: any;
    }[];
    sourceCodeInfos?: {
      type: 'BACKEND';
      sourceCode: string;
      fileName: 'src';
    }[];
  }
): Promise<TaskCreationResponse> {
  try {
    const client = createHttpClient(context);

    // Get current project information dynamically
    // const projectInfo = await getCurrentProjectInfo(context);

    const taskData = {
      ...params,
      projectName: params.projectName,
      lang: params.lang,
    };

    return await client.post<TaskCreationResponse>('/oxpecker/api/v2/tasks', taskData);
  } catch (error) {
    logger.error(`Error creating task: ${error}`);
    logger.error(`Error creating task: ${JSON.stringify(error)}`);
    throw error;
  }
}

export async function fetchTaskDetail(context: vscode.ExtensionContext, taskId: string): Promise<TaskDetailResponse> {
  try {
    const client = createHttpClient(context);
    return await client.get<TaskDetailResponse>(`/oxpecker/api/v1/tasks/${taskId}`);
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to fetch task detail: ${error}`);
    logger.error(`Error fetching task detail: ${error}`);
    throw error;
  }
}

export async function fetchIssuesList(context: vscode.ExtensionContext, taskId: string): Promise<{ data: Issue[]; total: number }> {
  try {
    const client = createHttpClient(context);
    const response = await client.post<{
      data: Issue[];
      total: number;
    }>(`/oxpecker/api/v1/tasks/${taskId}/results/search`, {
      page: 0,
      size: 100,
      filters: [],
      sorts: ['severity'],
    });
    return {
      data: response.data || [],
      total: response.total || 0,
    };
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to fetch issues list: ${error}`);
    logger.error(`Error fetching issues list: ${error}`);
    return {
      data: [],
      total: 0,
    };
  }
}

export async function fetchPocDetail(context: vscode.ExtensionContext, taskId: string, vulId: string): Promise<PocDetail> {
  try {
    const client = createHttpClient(context);
    return await client.get<PocDetail>(`/oxpecker/api/v1/tasks/${taskId}/results/${vulId}`);
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to fetch POC detail: ${error}`);
    logger.error(`Error fetching POC detail: ${error}`);
    throw error;
  }
}

export async function fetchBrowserUrl(context: vscode.ExtensionContext): Promise<string> {
  try {
    const client = createHttpClient(context);
    const response = await client.post<{ url: string }>('/oxpecker/api/v1/browsers ');
    logger.debug(`fetchBrowserUrl response: ${response.url}`);
    return response.url;
  } catch (error) {
    logger.error(`Error fetching browser URL: ${error}`);
    vscode.window.showErrorMessage(`Failed to fetch browser URL: ${error}`);
    throw error;
  }
}

export async function fetchNetworkDiagnostics(context: vscode.ExtensionContext, testUrl: string): Promise<{ id: string }> {
  try {
    const client = createHttpClient(context);
    return await client.post<{ id: string }>('/oxpecker/api/v1/network-diagnostics', { testUrl });
  } catch (error) {
    logger.error(`Error fetching network diagnostics: ${error}`);
    // vscode.window.showErrorMessage(`Failed to fetch network diagnostics: ${error}`);
    throw error;
  }
}

type NetworkDiagnosticsNextStageResponse = {
  diagId: string;
  testUrl: string;
  status: 'IN_PROGRESS' | 'FINISHED';
  stageCount: number;
  nextStage: number;
  stages: {
    stageName: string;
    description: string;
    status: 'PASS' | 'FAIL';
    resultInfo: string;
  }[];
};

export async function fetchNetworkDiagnosticsNextStage(context: vscode.ExtensionContext, id: string): Promise<NetworkDiagnosticsNextStageResponse> {
  try {
    const client = createHttpClient(context);
    return await client.get<NetworkDiagnosticsNextStageResponse>(`/oxpecker/api/v1/network-diagnostics/${id}/next-stage`);
  } catch (error) {
    logger.error(`Error fetching network diagnostics next stage: ${error}`);
    vscode.window.showErrorMessage(`Failed to fetch network diagnostics next stage: ${error}`);
    throw error;
  }
}

/**
 * /biz/api/v1/subscribe/stripe/exceed-credit-limit
 * 获取用户是否超过信用额度
 * demo result:
 * {
      "activeSubscriptionId": "****",
      "exceedCreditLimit": false,
      "creditsUsage": 0,
      "firstTierLimit": 0
    }
 */
type ExceedCreditLimitResponse = {
  activeSubscriptionId?: string;
  exceedCreditLimit: boolean;
  creditsUsage: number;
  firstTierLimit: number;
};

export async function fetchExceedCreditLimit(context: vscode.ExtensionContext): Promise<ExceedCreditLimitResponse> {
  try {
    const client = createHttpClient(context);
    return await client.get<ExceedCreditLimitResponse>('/biz/api/v1/subscribe/stripe/exceed-credit-limit');
  } catch (error) {
    logger.error(`Error fetching exceed credit limit: ${error}`);
    throw error;
  }
}

/**
 * 查看和取消订阅
 * /biz/api/v1/subscribe/stripe/create-portal-session
 * demo result:
 * {
      "url": "https://billing.stripe.com/p/login/test_aEUg190000000000000000000"
    }
 */
type CreatePortalSessionResponse = {
  url: string;
};

export async function fetchCreatePortalSession(context: vscode.ExtensionContext): Promise<CreatePortalSessionResponse> {
  try {
    const client = createHttpClient(context);
    return await client.post<CreatePortalSessionResponse>('/biz/api/v1/subscribe/stripe/create-portal-session', {});
  } catch (error) {
    logger.error(`Error fetching create portal session: ${error}`);
    throw error;
  }
}

/**
 * 查看订阅状态
 * biz/api/v1/subscribe/stripe/active-subscription-category
 * demo result:
 * {
      "category": "FREE"
    }
 */
type ActiveSubscriptionCategoryResponse = {
  category: 'trial' | 'none' | 'pro' | 'enterprise';
};

export async function fetchActiveSubscriptionCategory(context: vscode.ExtensionContext): Promise<ActiveSubscriptionCategoryResponse> {
  try {
    const client = createHttpClient(context);
    return await client.get<ActiveSubscriptionCategoryResponse>('/biz/api/v1/subscribe/stripe/active-subscription-category');
  } catch (error) {
    logger.error(`Error fetching active subscription category: ${error}`);
    throw error;
  }
}

/**
 * 创建支付订单
 * /biz/api/v1/subscribe/stripe/create-checkout-session
 * demo result:
 * {
      "url": "https://buy.stripe.com/test_aEUg190000000000000000000"
    }
 */
type CreateCheckoutSessionResponse = {
  url: string;
};

export async function fetchCreateCheckoutSession(
  context: vscode.ExtensionContext,
  params: {
    category: 'pro' | 'enterprise';
    successUrl?: string;
    cancelUrl?: string;
  }
): Promise<CreateCheckoutSessionResponse> {
  try {
    const client = createHttpClient(context);
    return await client.post<CreateCheckoutSessionResponse>('/biz/api/v1/subscribe/stripe/create-checkout-session', params);
  } catch (error) {
    logger.error(`Error fetching create checkout session: ${error}`);
    throw error;
  }
}

/**
 * Get current subscription status using SubscriptionManager
 */
export async function getSubscriptionStatus(context: vscode.ExtensionContext, forceRefresh: boolean = false) {
  const subscriptionManager = SubscriptionManager.getInstance(context);
  return await subscriptionManager.getSubscriptionStatus(forceRefresh);
}

/**
 * Get subscription category only
 */
export async function getSubscriptionCategory(context: vscode.ExtensionContext, forceRefresh: boolean = false) {
  const subscriptionManager = SubscriptionManager.getInstance(context);
  return await subscriptionManager.getSubscriptionCategory(forceRefresh);
}

/**
 * Check if user has exceeded credit limit
 */
export async function hasExceededCreditLimit(context: vscode.ExtensionContext, forceRefresh: boolean = false) {
  const subscriptionManager = SubscriptionManager.getInstance(context);
  return await subscriptionManager.hasExceededCreditLimit(forceRefresh);
}

/**
 * Check if user has active subscription
 */
export async function hasActiveSubscription(context: vscode.ExtensionContext, forceRefresh: boolean = false) {
  const subscriptionManager = SubscriptionManager.getInstance(context);
  return await subscriptionManager.hasActiveSubscription(forceRefresh);
}

/**
 * Refresh subscription status from API
 */
export async function refreshSubscriptionStatus(context: vscode.ExtensionContext) {
  const subscriptionManager = SubscriptionManager.getInstance(context);
  return await subscriptionManager.refreshSubscriptionStatus();
}

/**
 * curl --request POST \
  --url https://test.entropool.ai/oxpecker/api/v1/sca/static-analyze/mvn \
  --header 'Authorization: Bearer ****' \
  --header 'Content-Type: multipart/form-data' \
  --form file=@/xxx/projects/zast/zast/oxpecker-server/pom.xml
 */

type Severity = 1 | 2 | 3 | 4;

interface Reference {
  Title: string;
  Url: string;
}

interface AdditionalData {
  type: 'OssIssueData';
  key: string;
  title: string;
  name: string;
  version: string;
  packageManager: string;
  packageName: string;
  from: string[];
  fixedIn: string[];
  upgradePath: string[];
  isUpgradable: boolean;
  CVSSv3: string;
  cvssScore: number;
  exploit: string;
  isPatchable: boolean;
  description: string;
  references: Reference[];
  remediation: string;
}

export interface ScaResult {
  ID: string;
  Severity: Severity;
  IssueType: 3;
  IsIgnored: false;
  IsNew: false;
  Message: string;
  FormattedMessage: string;
  AffectedFilePath: string;
  Product: 'SBOM Analyzer';
  Ecosystem: string;
  CVEs: string[];
  CWEs: string[];
  additionalData: AdditionalData;
}

export type ScaReport = ScaResult[];

async function parseScaReportFromZip(zipBuffer: Buffer): Promise<ScaReport> {
  try {
    const zip = await JSZip.loadAsync(zipBuffer);
    const jsonFile = Object.values(zip.files).find((file) => !file.dir && file.name.toLowerCase().endsWith('.json'));

    if (!jsonFile) {
      throw new Error('SBOM analysis archive does not contain a JSON report.');
    }

    const fileContent = await jsonFile.async('string');
    return JSON.parse(fileContent) as ScaReport;
  } catch (error) {
    logger.error(`Failed to parse SBOM analysis archive: ${error}`);
    throw error;
  }
}

export async function sbomAnalyze(context: vscode.ExtensionContext, filePath: string): Promise<ScaReport> {
  try {
    const client = createHttpClient(context);

    const zipBuffer = await client.uploadFile<Buffer>('/oxpecker/api/v1/sca/static-analyze/mvn', filePath, 'file', 'buffer');
    return await parseScaReportFromZip(zipBuffer);
  } catch (error) {
    logger.error(`Error uploading file for SBOM analysis: ${error}`);
    vscode.window.showErrorMessage(`Failed to upload file for SBOM analysis: ${error}`);
    throw error;
  }
}

export async function sbomAnalyzeZip(context: vscode.ExtensionContext, filePath: string): Promise<ScaReport> {
  try {
    const client = createHttpClient(context);
    const zipBuffer = await client.uploadFile<Buffer>('/oxpecker/api/v1/sca/static-analyze/mvn/zip', filePath, 'file', 'buffer');
    return await parseScaReportFromZip(zipBuffer);
  } catch (error) {
    logger.error(`Error uploading file for SBOM analysis zip: ${error}`);
    vscode.window.showErrorMessage(`Failed to upload file for SBOM analysis zip: ${error}`);
    throw error;
  }
}
