import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { getPrefixedLogger } from '../../../logger';
import { ExtendedProjectInfo, IProjectDiscoverer, UnifiedProjectInfo } from '../../types';
import { GitIgnoreFilter } from '../../../utils/gitignore';

// Python Project Discovery Strategy
export class PythonDiscoverer implements IProjectDiscoverer {
  public readonly language = 'python';
  private logger = getPrefixedLogger('PythonDiscoverer');

  /**
   * Phase 1: Scan and filter Python project configuration files
   */
  async scanCandidates(workspacePath: string): Promise<string[]> {
    this.logger.info('Scanning for Python projects...');

    const candidates: string[] = [];

    // Priority order: pyproject.toml > setup.py > setup.cfg > requirements.txt
    const configPatterns = [
      { pattern: '**/pyproject.toml', priority: 1 },
      { pattern: '**/setup.py', priority: 2 },
      { pattern: '**/setup.cfg', priority: 3 },
      { pattern: '**/requirements.txt', priority: 4 },
    ];

    // Exclude common non-source directories for Python projects
    const excludePattern = '**/{__pycache__,.venv,venv,build,dist,.tox,.pytest_cache,.coverage,node_modules}/**';

    for (const { pattern } of configPatterns) {
      const files = await vscode.workspace.findFiles(pattern, excludePattern);
      candidates.push(...files.map((file) => file.fsPath));
    }

    // Deduplicate by directory (keep highest priority config per directory)
    let deduplicatedCandidates = this.deduplicateByDirectory(candidates);
    this.logger.info(`Found ${deduplicatedCandidates.length} Python project candidates before gitignore filtering`);

    // Apply .gitignore filtering
    try {
      const gitIgnoreFilter = await GitIgnoreFilter.create(workspacePath, [
        '__pycache__/',
        '**/__pycache__/**',
        '*.pyc',
        '*.pyo',
        '*.pyd',
        '.venv/',
        'venv/',
        'env/',
        '.env/',
        'build/',
        'dist/',
        '*.egg-info/',
        '.tox/',
        '.pytest_cache/',
        '.coverage',
        'htmlcov/',
        '.mypy_cache/',
        '.git/',
      ]);

      if (gitIgnoreFilter) {
        const filteredCandidates = gitIgnoreFilter.filterFiles(deduplicatedCandidates);
        this.logger.info(`Filtered ${deduplicatedCandidates.length} candidates to ${filteredCandidates.length} using .gitignore rules`);
        deduplicatedCandidates = filteredCandidates;
      } else {
        this.logger.warn('No Git repository found, skipping .gitignore filtering');
      }
    } catch (error) {
      this.logger.warn(`Failed to apply .gitignore filtering: ${error}`);
    }

    this.logger.info(`Final candidate count: ${deduplicatedCandidates.length} Python project candidates`);
    return deduplicatedCandidates;
  }

  /**
   * Phase 2: Analyze Python project and enrich with signals
   */
  async analyzeProject(configPath: string): Promise<ExtendedProjectInfo | null> {
    try {
      const projectPath = path.dirname(configPath);
      const configFileName = path.basename(configPath);

      let projectInfo;
      switch (configFileName) {
        case 'pyproject.toml':
          projectInfo = await this.analyzePyprojectToml(configPath, projectPath);
          break;
        case 'setup.py':
          projectInfo = await this.analyzeSetupPy(configPath, projectPath);
          break;
        case 'setup.cfg':
          projectInfo = await this.analyzeSetupCfg(configPath, projectPath);
          break;
        case 'requirements.txt':
          projectInfo = await this.analyzeRequirementsTxt(configPath, projectPath);
          break;
        default:
          return null;
      }

      if (!projectInfo) return null;

      // Enrich with framework detection
      const framework = await this.detectFramework(projectPath, projectInfo);

      return {
        ...projectInfo,
        framework,
      } as ExtendedProjectInfo;
    } catch (error) {
      this.logger.error(`Failed to analyze Python project at ${configPath}: ${error}`);
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
      language: 'python',
      displayLabel,
    };
  }

  /**
   * Deduplicate candidates by directory, keeping highest priority config
   */
  private deduplicateByDirectory(candidates: string[]): string[] {
    const dirMap = new Map<string, { path: string; priority: number }>();

    for (const candidate of candidates) {
      const dir = path.dirname(candidate);
      const fileName = path.basename(candidate);

      let priority = 4; // Default for requirements.txt
      if (fileName === 'pyproject.toml') priority = 1;
      else if (fileName === 'setup.py') priority = 2;
      else if (fileName === 'setup.cfg') priority = 3;

      const existing = dirMap.get(dir);
      if (!existing || priority < existing.priority) {
        dirMap.set(dir, { path: candidate, priority });
      }
    }

    return Array.from(dirMap.values()).map((item) => item.path);
  }

  /**
   * Analyze pyproject.toml file
   */
  private async analyzePyprojectToml(configPath: string, projectPath: string): Promise<Partial<ExtendedProjectInfo> | null> {
    try {
      const content = fs.readFileSync(configPath, 'utf8');

      // Simple TOML parsing - in production, use a proper TOML parser
      const lines = content.split('\n');
      let projectName = path.basename(projectPath);
      let version = '1.0.0';

      // Extract basic info from [project] or [tool.poetry] sections
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        if (line.includes('name =')) {
          const match = line.match(/name\s*=\s*["']([^"']+)["']/);
          if (match) projectName = match[1];
        }

        if (line.includes('version =')) {
          const match = line.match(/version\s*=\s*["']([^"']+)["']/);
          if (match) version = match[1];
        }
      }

      return {
        type: 'python',
        language: 'python',
        rootPath: projectPath,
        configFile: configPath,
        sourceDirectories: [projectPath],
        packageName: projectName,
        version,
        workspaceType: 'poetry', // Assume poetry for pyproject.toml
      };
    } catch (error) {
      this.logger.warn(`Failed to parse pyproject.toml at ${configPath}: ${error}`);
      return null;
    }
  }

  /**
   * Analyze setup.py file
   */
  private async analyzeSetupPy(configPath: string, projectPath: string): Promise<Partial<ExtendedProjectInfo> | null> {
    try {
      const content = fs.readFileSync(configPath, 'utf8');

      // Extract basic info using regex (simplified approach)
      let projectName = path.basename(projectPath);
      let version = '1.0.0';

      const nameMatch = content.match(/name\s*=\s*["']([^"']+)["']/);
      if (nameMatch) projectName = nameMatch[1];

      const versionMatch = content.match(/version\s*=\s*["']([^"']+)["']/);
      if (versionMatch) version = versionMatch[1];

      return {
        type: 'python',
        language: 'python',
        rootPath: projectPath,
        configFile: configPath,
        sourceDirectories: [projectPath],
        packageName: projectName,
        version,
        workspaceType: 'setuptools',
      };
    } catch (error) {
      this.logger.warn(`Failed to parse setup.py at ${configPath}: ${error}`);
      return null;
    }
  }

  /**
   * Analyze setup.cfg file
   */
  private async analyzeSetupCfg(configPath: string, projectPath: string): Promise<Partial<ExtendedProjectInfo> | null> {
    try {
      const content = fs.readFileSync(configPath, 'utf8');

      let projectName = path.basename(projectPath);
      let version = '1.0.0';

      const nameMatch = content.match(/name\s*=\s*(.+)/);
      if (nameMatch) projectName = nameMatch[1].trim();

      const versionMatch = content.match(/version\s*=\s*(.+)/);
      if (versionMatch) version = versionMatch[1].trim();

      return {
        type: 'python',
        language: 'python',
        rootPath: projectPath,
        configFile: configPath,
        sourceDirectories: [projectPath],
        packageName: projectName,
        version,
        workspaceType: 'setuptools',
      };
    } catch (error) {
      this.logger.warn(`Failed to parse setup.cfg at ${configPath}: ${error}`);
      return null;
    }
  }

  /**
   * Analyze requirements.txt file (weak signal)
   */
  private async analyzeRequirementsTxt(configPath: string, projectPath: string): Promise<Partial<ExtendedProjectInfo> | null> {
    try {
      // Check if there are Python files in the same directory
      const pythonFiles = fs.readdirSync(projectPath).filter((file) => file.endsWith('.py'));

      if (pythonFiles.length === 0) {
        return null; // No Python files, probably not a project root
      }

      const projectName = path.basename(projectPath);

      return {
        type: 'python',
        language: 'python',
        rootPath: projectPath,
        configFile: configPath,
        sourceDirectories: [projectPath],
        packageName: projectName,
        workspaceType: 'plain',
      };
    } catch (error) {
      this.logger.warn(`Failed to analyze requirements.txt at ${configPath}: ${error}`);
      return null;
    }
  }

  /**
   * Detect Python framework
   */
  private async detectFramework(projectPath: string, projectInfo: Partial<ExtendedProjectInfo>): Promise<string | undefined> {
    // Check for Django
    if (fs.existsSync(path.join(projectPath, 'manage.py'))) {
      return 'django';
    }

    // Check for Flask/FastAPI by examining Python files
    const pythonFiles = this.findPythonFiles(projectPath);
    for (const file of pythonFiles.slice(0, 10)) {
      // Check first 10 files
      try {
        const content = fs.readFileSync(file, 'utf8');
        if (content.includes('from flask import') || content.includes('import flask')) {
          return 'flask';
        }
        if (content.includes('from fastapi import') || content.includes('import fastapi')) {
          return 'fastapi';
        }
      } catch (error) {
        // Ignore file read errors
      }
    }

    return undefined;
  }

  /**
   * Find Python files in project
   */
  private findPythonFiles(projectPath: string): string[] {
    const pythonFiles: string[] = [];

    try {
      const entries = fs.readdirSync(projectPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(projectPath, entry.name);

        if (entry.isFile() && entry.name.endsWith('.py')) {
          pythonFiles.push(fullPath);
        } else if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== '__pycache__') {
          pythonFiles.push(...this.findPythonFiles(fullPath));
        }
      }
    } catch (error) {
      // Ignore directory read errors
    }

    return pythonFiles;
  }

  /**
   * Create display label for user selection
   */
  private createDisplayLabel(projectInfo: ExtendedProjectInfo): string {
    const name = projectInfo.packageName || 'Unnamed Python Project';
    const frameworkLabel = projectInfo.framework ? ` (${projectInfo.framework})` : '';
    const typeLabel = projectInfo.workspaceType ? ` [${projectInfo.workspaceType}]` : '';

    return `${name}${frameworkLabel}${typeLabel}`;
  }
}
