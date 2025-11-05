import * as vscode from 'vscode';

// 构建时配置接口
interface IBuildTimeConfig {
  name: string;
  displayName: string;
  description: string;
  publisher: string;
  title: string;
  apiBaseUrl: string;
  selfHostedOauthAuthUrl: string;
  selfHostedOauthRefreshTokenUrl: string;
  saasClientId: string;
  saasClientSecret: string;
  saasAuthUrl: string;
  saasTokenUrl: string;
  saasUserInfoUrl: string;
  saasScopes: string[];
  reportUrl: string;
  helpUrl: string;
  supportEmail: string;
}

// 用户运行时设置接口
interface IUserSettings {
  authToken: string;
  apiBaseUrl: string;
  isSelfHosted: boolean;
}

// 获取构建时配置 - 使用 Vite define 直接替换的常量
const getBuildTimeConfig = (): IBuildTimeConfig => {
  // 这些常量会在构建时被 Vite 的 define 配置直接替换为实际值
  return {
    name: __ZAST_CONFIG_NAME__,
    displayName: __ZAST_CONFIG_DISPLAYNAME__,
    description: __ZAST_CONFIG_DESCRIPTION__,
    publisher: __ZAST_CONFIG_PUBLISHER__,
    title: __ZAST_CONFIG_TITLE__,
    apiBaseUrl: __ZAST_CONFIG_APIBASEURL__,
    selfHostedOauthAuthUrl: __ZAST_CONFIG_SELFHOSTEDOAUTHAUTHURL__,
    selfHostedOauthRefreshTokenUrl: __ZAST_CONFIG_SELFHOSTEDOAUTHREFRESHTOKENURL__,
    saasClientId: __ZAST_CONFIG_SAASCLIENTID__,
    saasClientSecret: __ZAST_CONFIG_SAASCLIENTSECRET__,
    saasAuthUrl: __ZAST_CONFIG_SAASAUTHURL__,
    saasTokenUrl: __ZAST_CONFIG_SAASTOKENURL__,
    saasUserInfoUrl: __ZAST_CONFIG_SAASUSERINFOURL__,
    saasScopes: __ZAST_CONFIG_SAASSCOPES__,
    reportUrl: __ZAST_CONFIG_REPORTURL__,
    helpUrl: __ZAST_CONFIG_HELPURL__,
    supportEmail: __ZAST_CONFIG_SUPPORTEMAIL__,
  };
};

// 从 VS Code 工作区获取用户运行时配置
const getUserSettings = (): IUserSettings => {
  const settings = vscode.workspace.getConfiguration('project');
  return {
    authToken: settings.get<string>('authToken', ''),
    apiBaseUrl: settings.get<string>('apiBaseUrl', ''),
    isSelfHosted: settings.get<boolean>('isSelfHosted', false),
  };
};

class ConfigManager {
  public readonly build: IBuildTimeConfig;

  constructor() {
    this.build = getBuildTimeConfig();
  }

  public get user(): IUserSettings {
    // 每次访问都重新获取，以响应用户的实时更改
    return getUserSettings();
  }
}

const configManager = new ConfigManager();

export class ZastConfig {
  // API configuration - 使用构建时配置
  public static readonly API_CONFIG = {
    BASE_URL: configManager.build.apiBaseUrl,
  };

  public static readonly EXTENSION_CONFIG = {
    CLIENT_ID: `${configManager.build.publisher}.${configManager.build.name}`,
    TITLE: configManager.build.title,
  };

  // Get API base URL from VSCode settings or use build-time default
  public static getApiBaseUrl(): string {
    const userSettings = getUserSettings();
    return process.env.ZAST_API_BASE_URL || userSettings.apiBaseUrl || configManager.build.apiBaseUrl;
  }

  // Self-hosted OAuth configuration - 使用构建时配置
  public static readonly SELF_HOSTED_OAUTH_CONFIG = {
    CLIENT_ID: configManager.build.name,
    AUTH_URL: configManager.build.selfHostedOauthAuthUrl,
    TOKEN_URL: `${configManager.build.apiBaseUrl}/oauth/token`,
    REFRESH_TOKEN_URL: configManager.build.selfHostedOauthRefreshTokenUrl,
    SCOPES: ['read', 'write'],
  };

  // SaaS OAuth configuration - 使用构建时配置
  public static readonly SAAS_OAUTH_CONFIG = {
    CLIENT_ID: configManager.build.name,
    REAL_CLIENT_ID: configManager.build.saasClientId,
    CLIENT_SECRET: configManager.build.saasClientSecret,
    AUTH_URL: configManager.build.saasAuthUrl,
    TOKEN_URL: configManager.build.saasTokenUrl,
    USER_INFO_URL: configManager.build.saasUserInfoUrl,
    SCOPES: configManager.build.saasScopes,
  };

  // Check if using SaaS deployment (Clerk auth) vs self-hosted (internal auth)
  public static isSaasEnabled(context?: vscode.ExtensionContext): boolean {
    try {
      const userSettings = getUserSettings();

      // Use SaaS for cloud deployment (not self-hosted), use self-hosted for on-premises
      return !userSettings.isSelfHosted;
    } catch (error) {
      console.error('Failed to get deployment type config, defaulting to self-hosted auth:', error);
      return false;
    }
  }

  // Get help & feedback URLs
  public static getReportUrl(): string {
    return configManager.build.reportUrl;
  }

  public static getHelpUrl(): string {
    return configManager.build.helpUrl;
  }

  public static getSupportEmail(): string {
    return configManager.build.supportEmail;
  }

  // 获取配置管理器实例
  public static getConfigManager(): ConfigManager {
    return configManager;
  }
}

export { configManager };
