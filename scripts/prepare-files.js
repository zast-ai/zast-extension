const fs = require('fs-extra');
const path = require('path');

// 获取目标区域，默认为国际版
const targetRegion = process.env.TARGET_REGION || 'region_global';

console.log(`准备文件用于区域: ${targetRegion}`);

// 深度合并对象的工具函数
function deepMerge(target, source) {
  const result = { ...target };

  for (const key in source) {
    if (source.hasOwnProperty(key)) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        // 递归合并对象
        result[key] = deepMerge(result[key] || {}, source[key]);
      } else {
        // 直接覆盖原始值、数组或 null/undefined
        result[key] = source[key];
      }
    }
  }

  return result;
}

// 扁平化分组配置的工具函数
function flattenConfig(config) {
  const flattened = {};

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

// 处理模板字符串的简单替换
function processTemplate(template, config) {
  let result = JSON.stringify(template, null, 2);

  Object.entries(config).forEach(([key, value]) => {
    // 处理完整的占位符 "{{key}}" （用于整个值的替换）
    const quotedPlaceholder = `"{{${key}}}"`;
    let quotedReplacement;

    if (Array.isArray(value)) {
      quotedReplacement = JSON.stringify(value, null, 2);
    } else if (typeof value === 'object') {
      quotedReplacement = JSON.stringify(value, null, 2);
    } else if (typeof value === 'string') {
      quotedReplacement = `"${value}"`;
    } else {
      quotedReplacement = String(value);
    }

    // 替换带引号的占位符
    result = result.replace(new RegExp(quotedPlaceholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), quotedReplacement);

    // 处理字符串内的占位符 {{key}} （用于字符串内部的替换）
    const inlinePlaceholder = `{{${key}}}`;
    const inlineReplacement = String(value);

    // 替换字符串内的占位符
    result = result.replace(new RegExp(inlinePlaceholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), inlineReplacement);
  });

  return JSON.parse(result);
}

async function prepareFiles() {
  try {
    const rootDir = process.cwd();
    const configDir = path.join(rootDir, 'config');
    const regionalAssetsDir = path.join(rootDir, 'regional-assets', targetRegion);

    // 1. 读取配置文件
    const baseConfigPath = path.join(configDir, 'base.json');
    const regionConfigPath = path.join(configDir, `${targetRegion}.json`);

    console.log('baseConfigPath', baseConfigPath);
    console.log('regionConfigPath', regionConfigPath);

    if (!fs.existsSync(baseConfigPath)) {
      throw new Error(`基础配置文件不存在: ${baseConfigPath}`);
    }

    if (!fs.existsSync(regionConfigPath)) {
      throw new Error(`区域配置文件不存在: ${regionConfigPath}`);
    }

    const baseConfig = await fs.readJson(baseConfigPath);
    const regionConfig = await fs.readJson(regionConfigPath);

    // 合并配置
    const mergedConfig = { ...baseConfig, ...regionConfig };

    // 扁平化分组配置，以便在模板中使用
    const finalConfig = flattenConfig(mergedConfig);

    console.log('最终配置:', finalConfig);

    // 2. 生成 package.json - 直接使用原始 package.json 进行合并
    const packageJsonPath = path.join(rootDir, 'package.json');
    const packageTemplatePath = path.join(rootDir, 'package.template.json');

    if (!fs.existsSync(packageJsonPath)) {
      throw new Error(`原始 package.json 文件不存在: ${packageJsonPath}`);
    }

    if (!fs.existsSync(packageTemplatePath)) {
      throw new Error(`Package 模板文件不存在: ${packageTemplatePath}`);
    }

    // 读取原始 package.json
    const originalPackage = await fs.readJson(packageJsonPath);

    // 读取并处理模板 package.json
    const templatePackage = await fs.readJson(packageTemplatePath);
    const processedTemplate = processTemplate(templatePackage, finalConfig);

    // 深度合并：原始 package.json + 处理后的模板
    // 模板内容会覆盖原始文件中的对应字段
    const finalPackage = deepMerge(originalPackage, processedTemplate);

    // 写回 package.json
    await fs.writeJson(packageJsonPath, finalPackage, { spaces: 2 });
    console.log(`✅ 已更新 package.json 文件`);

    // 3. 复制 README.md
    const regionalReadmePath = path.join(regionalAssetsDir, 'README.md');
    const targetReadmePath = path.join(rootDir, 'README.md');

    if (fs.existsSync(regionalReadmePath)) {
      await fs.copy(regionalReadmePath, targetReadmePath);
      console.log(`✅ 已复制 README.md 文件 (${targetRegion})`);
    } else {
      console.warn(`⚠️  区域性 README.md 文件不存在: ${regionalReadmePath}`);
    }

    // 4. 复制 assets 目录
    const regionalAssetsAssetsDir = path.join(regionalAssetsDir, 'assets');
    const targetAssetsDir = path.join(rootDir, 'assets');

    if (fs.existsSync(regionalAssetsAssetsDir)) {
      // 清空目标 assets 目录并复制新内容
      await fs.emptyDir(targetAssetsDir);
      await fs.copy(regionalAssetsAssetsDir, targetAssetsDir);
      console.log(`✅ 已复制 assets 目录 (${targetRegion})`);
    } else {
      console.warn(`⚠️  区域性 assets 目录不存在: ${regionalAssetsAssetsDir}`);
    }

    console.log(`🎉 文件准备完成，目标区域: ${targetRegion}`);
  } catch (error) {
    console.error('❌ 文件准备失败:', error.message);
    process.exit(1);
  }
}

// 执行文件准备
prepareFiles();
