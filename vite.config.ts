import vscode from '@tomjs/vite-plugin-vscode';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';
import path from 'node:path';
import * as fs from 'fs';

// 获取目标区域配置
const targetRegion = process.env.TARGET_REGION || 'region_global';

// 扁平化分组配置的工具函数
function flattenConfig(config: any) {
  const flattened: any = {};

  // 处理 package 分组
  if (config.package) {
    Object.entries(config.package).forEach(([key, value]) => {
      flattened[key] = value;
    });
  }

  // 处理其他顶级字段
  if (config.apiBaseUrl) {
    flattened.apiBaseUrl = config.apiBaseUrl;
  }

  // 处理帮助和反馈相关字段
  if (config.reportUrl) {
    flattened.reportUrl = config.reportUrl;
  }
  if (config.helpUrl) {
    flattened.helpUrl = config.helpUrl;
  }
  if (config.supportEmail) {
    flattened.supportEmail = config.supportEmail;
  }

  // 处理 selfHostedConfig 分组
  if (config.selfHostedConfig) {
    Object.entries(config.selfHostedConfig).forEach(([key, value]) => {
      flattened[`selfHosted${key.charAt(0).toUpperCase() + key.slice(1)}`] = value;
    });
  }

  // 处理 saasConfig 分组
  if (config.saasConfig) {
    Object.entries(config.saasConfig).forEach(([key, value]) => {
      flattened[`saas${key.charAt(0).toUpperCase() + key.slice(1)}`] = value;
    });
  }

  return flattened;
}

// 读取并合并配置
function loadRegionConfig() {
  const configPath = path.resolve(__dirname, 'config');

  try {
    const baseConfigPath = path.join(configPath, 'base.json');
    const regionConfigPath = path.join(configPath, `${targetRegion}.json`);

    const baseConfig = fs.existsSync(baseConfigPath) ? JSON.parse(fs.readFileSync(baseConfigPath, 'utf-8')) : {};

    const regionConfig = fs.existsSync(regionConfigPath) ? JSON.parse(fs.readFileSync(regionConfigPath, 'utf-8')) : {};

    // 合并配置
    const mergedConfig = { ...baseConfig, ...regionConfig };

    // 扁平化分组配置，以便在代码中使用
    return flattenConfig(mergedConfig);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.warn(`⚠️  配置文件读取失败，使用默认配置: ${errorMessage}`);
    return {};
  }
}

const finalConfig = loadRegionConfig();

// 构建 define 对象，将配置注入到构建时
const define: Record<string, string> = {};
for (const [key, value] of Object.entries(finalConfig)) {
  // 直接定义常量，而不是使用 import.meta.env
  define[`__ZAST_CONFIG_${key.toUpperCase()}__`] = JSON.stringify(value);
  // 同时保持对前端代码的兼容性（如果需要的话）
  define[`import.meta.env.VITE_${key.toUpperCase()}`] = JSON.stringify(value);
}

console.log(`🚀 构建配置 - 目标区域: ${targetRegion}`);
console.log('📦 注入的配置变量:', Object.keys(define));

// https://vitejs.dev/config/
export default defineConfig({
  define, // 注入构建时配置
  plugins: [
    vue({
      template: {
        compilerOptions: {
          isCustomElement: (tag: string) => tag.startsWith('vscode-'),
        },
      },
    }),
    vscode({
      extension: {
        minify: false,
        define: define, // 将 Vite 的 define 配置传递给扩展构建
      },
      webview: {
        csp: `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src {{cspSource}} 'unsafe-inline'; script-src 'nonce-{{nonce}}' 'unsafe-eval';frame-src *;img-src * data:;">`,
      },
    }),
  ],
  build: {
    minify: false,
    rollupOptions: {
      input: [
        path.resolve(__dirname, 'view-assess.html'),
        path.resolve(__dirname, 'view-home.html'),
        path.resolve(__dirname, 'view-task.html'),
        path.resolve(__dirname, 'view-report.html'),
        path.resolve(__dirname, 'view-project-task.html'),
        path.resolve(__dirname, 'view-help.html'),
        path.resolve(__dirname, 'view-start.html'),
        path.resolve(__dirname, 'view-sbom.html'),
        path.resolve(__dirname, 'view-sbom-report.html'),
      ],
    },
  },
});
