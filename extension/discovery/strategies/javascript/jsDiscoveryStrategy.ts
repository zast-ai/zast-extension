import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { getPrefixedLogger } from '../../../logger';
import { ExtendedProjectInfo, IProjectDiscoverer, UnifiedProjectInfo } from '../../types';
import { GitIgnoreFilter } from '../../../utils/gitignore';

// JavaScript/TypeScript Project Discovery Strategy
export class JavaScriptDiscoverer implements IProjectDiscoverer {
  public readonly language = 'javascript';
  private logger = getPrefixedLogger('JSDiscoverer');

  /**
   * Phase 1: Scan and filter package.json files
   */
  async scanCandidates(workspacePath: string): Promise<string[]> {
    this.logger.info('Scanning for JavaScript/TypeScript projects...');

    // Find all package.json files, excluding node_modules
    const packageFiles = await vscode.workspace.findFiles('**/package.json', '**/node_modules/**');

    let candidates = packageFiles.map((file) => file.fsPath);
    this.logger.info(`Found ${candidates.length} package.json files before gitignore filtering`);

    // Apply .gitignore filtering
    try {
      const gitIgnoreFilter = await GitIgnoreFilter.create(workspacePath, [
        'node_modules/',
        '*/node_modules/',
        '**/node_modules/**',
        '.git/',
        'dist/',
        'build/',
        'coverage/',
        '.nyc_output/',
        'tmp/',
        'temp/',
      ]);

      if (gitIgnoreFilter) {
        const filteredCandidates = gitIgnoreFilter.filterFiles(candidates);
        this.logger.info(`Filtered ${candidates.length} candidates to ${filteredCandidates.length} using .gitignore rules`);
        candidates = filteredCandidates;
      } else {
        this.logger.warn('No Git repository found, skipping .gitignore filtering');
      }
    } catch (error) {
      this.logger.warn(`Failed to apply .gitignore filtering: ${error}`);
    }

    this.logger.info(`Final candidate count: ${candidates.length} package.json files`);
    return candidates;
  }

  /**
   * Phase 2: Analyze package.json and enrich with signals
   */
  async analyzeProject(configPath: string): Promise<ExtendedProjectInfo | null> {
    try {
      const projectPath = path.dirname(configPath);
      const packageContent = JSON.parse(fs.readFileSync(configPath, 'utf8'));

      // Basic project info extraction
      const projectName = packageContent.name || path.basename(projectPath);
      const version = packageContent.version || '1.0.0';

      // Detect TypeScript
      const isTypeScript = await this.detectTypeScript(projectPath);

      // Detect framework and workspace type
      const workspaceType = this.detectMonorepoType(packageContent, projectPath);

      return {
        type: isTypeScript ? 'typescript' : 'javascript',
        language: 'javascript',
        rootPath: projectPath,
        configFile: configPath,
        sourceDirectories: [projectPath], // Use project root as source directory
        packageName: projectName,
        version,
        workspaceType,
        entryPoints: this.extractEntryPoints(packageContent),
      } as ExtendedProjectInfo;
    } catch (error) {
      this.logger.error(`Failed to analyze JS project at ${configPath}: ${error}`);
      return null;
    }
  }

  /**
   * Phase 3: Create unified info for user selection
   */
  async createUnifiedInfo(projectInfo: ExtendedProjectInfo): Promise<UnifiedProjectInfo> {
    const displayLabel = this.createDisplayLabel(projectInfo);

    return {
      projectInfo,
      moduleRootPath: projectInfo.rootPath,
      sourceCodePaths: projectInfo.sourceDirectories,
      language: 'javascript',
      displayLabel,
    };
  }

  /**
   * Detect if project uses TypeScript
   */
  private async detectTypeScript(projectPath: string): Promise<boolean> {
    const indicators = ['tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json'];

    for (const indicator of indicators) {
      if (fs.existsSync(path.join(projectPath, indicator))) {
        return true;
      }
    }

    return false;
  }

  /**
   * Detect monorepo type
   */
  private detectMonorepoType(packageJson: any, projectPath: string): string | undefined {
    // Check package.json workspaces
    if (packageJson.workspaces) return 'npm';

    // Check for monorepo config files
    const monorepoFiles = {
      'lerna.json': 'lerna',
      'nx.json': 'nx',
      'pnpm-workspace.yaml': 'pnpm',
      'rush.json': 'rush',
    };

    for (const [file, type] of Object.entries(monorepoFiles)) {
      if (fs.existsSync(path.join(projectPath, file))) {
        return type;
      }
    }

    return undefined;
  }

  /**
   * Extract entry points from package.json
   */
  private extractEntryPoints(packageJson: any): string[] {
    const entryPoints: string[] = [];

    const entryFields = ['main', 'module', 'browser', 'types', 'typings'];
    for (const field of entryFields) {
      if (packageJson[field] && typeof packageJson[field] === 'string') {
        entryPoints.push(packageJson[field]);
      }
    }

    return entryPoints;
  }

  /**
   * Create display label for user selection
   */
  private createDisplayLabel(projectInfo: ExtendedProjectInfo): string {
    const name = projectInfo.packageName || 'Unnamed Project';
    const typeLabel = projectInfo.type === 'typescript' ? 'TS' : 'JS';
    const frameworkLabel = projectInfo.framework ? ` (${projectInfo.framework})` : '';

    return `${name} [${typeLabel}]${frameworkLabel}`;
  }
}
