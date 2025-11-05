import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { promisify } from 'util';
import { parseString } from 'xml2js';
import { getPrefixedLogger } from '../../../logger';
import { ProjectInfo } from '../../types';

const parseXML = promisify(parseString);
const logger = getPrefixedLogger('MavenParser');

export class MavenParser {
  /**
   * Find all pom.xml files in the workspace
   * This is a utility function that can be used by other modules
   */
  static async findAllPomFiles(): Promise<vscode.Uri[]> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      logger.warn('No workspace folders found while searching for pom.xml files');
      return [];
    }

    const primaryFolder = workspaceFolders[0];
    const includePattern = new vscode.RelativePattern(primaryFolder, '**/pom.xml');
    const folderUris = await vscode.workspace.findFiles(includePattern);

    const filtered = folderUris.filter((uri) => this.isLikelyProjectPom(primaryFolder.uri.fsPath, uri.fsPath));

    return filtered;
  }

  private static isLikelyProjectPom(workspaceRoot: string, pomPath: string): boolean {
    const normalizedRoot = path.resolve(workspaceRoot);
    const normalizedPomPath = path.resolve(pomPath);

    if (!normalizedPomPath.startsWith(normalizedRoot)) {
      return false;
    }

    const relativePath = path.relative(normalizedRoot, normalizedPomPath);
    if (!relativePath || relativePath.startsWith('..')) {
      return false;
    }

    const segments = relativePath.split(path.sep);
    const lowerSegments = segments.map((segment) => segment.toLowerCase());

    const excludedSegments = new Set(['node_modules', 'target', 'build', 'dist', 'out', '.git', '.idea', '.vscode', '.history', '.cache', '.m2', '.mvn', '.gradle', '.settings', '.metadata']);

    if (lowerSegments.some((segment) => excludedSegments.has(segment))) {
      return false;
    }

    if (lowerSegments.includes('meta-inf') && lowerSegments.includes('maven')) {
      return false;
    }

    return true;
  }

  /**
   * Find Maven projects by searching for pom.xml files
   */
  static async findMavenProjects(workspacePath: string): Promise<ProjectInfo[]> {
    const projects: ProjectInfo[] = [];
    // 使用新的静态函数来获取 pom.xml 文件
    const pomFiles = await this.findAllPomFiles();

    for (const pomFile of pomFiles) {
      const projectPath = path.dirname(pomFile.fsPath);
      const projectInfo = await this.parseMavenProject(projectPath, pomFile.fsPath);
      if (projectInfo) {
        projects.push(projectInfo);
      }
    }

    return projects;
  }

  /**
   * Parse Maven project information from pom.xml
   */
  static async parseMavenProject(projectPath: string, pomPath: string): Promise<ProjectInfo | null> {
    try {
      const pomContent = fs.readFileSync(pomPath, 'utf8');
      const result = (await parseXML(pomContent)) as any;

      const project = result.project;
      const artifactId = project.artifactId?.[0] || 'unknown';
      const version = project.version?.[0] || project.parent?.[0]?.version?.[0] || '1.0.0';
      const packaging = project.packaging?.[0] || 'jar';

      // Parse build section
      const buildInfo = this.parseBuildSection(project);

      // Extract all candidate artifactIds (current project + submodules)
      const candidateArtifactIds = await this.extractCandidateArtifactIds(project, projectPath);

      return {
        type: 'maven',
        rootPath: projectPath,
        configFile: pomPath,
        artifactId,
        version,
        packaging,
        candidateArtifactIds,
        ...buildInfo,
      };
    } catch (error) {
      logger.error(`Failed to parse Maven project at ${pomPath}: ${error}`);
      return null;
    }
  }

  /**
   * Parse build section from Maven project
   */
  static parseBuildSection(project: any): {
    hasBuildSection: boolean;
    finalName?: string;
    buildDirectory?: string;
  } {
    const buildSection = project.build?.[0];

    if (!buildSection) {
      return { hasBuildSection: false };
    }

    const finalName = buildSection.finalName?.[0];
    const buildDirectory = buildSection.directory?.[0] || 'target';

    return {
      hasBuildSection: true,
      finalName,
      buildDirectory,
    };
  }

  /**
   * Extract all candidate artifactIds from Maven project (current + submodules)
   */
  static async extractCandidateArtifactIds(project: any, projectPath: string): Promise<string[]> {
    const candidateIds: string[] = [];

    // Add current project's artifactId
    const currentArtifactId = project.artifactId?.[0];
    if (currentArtifactId) {
      candidateIds.push(currentArtifactId);
    }

    // Add submodule artifactIds
    const modules = project.modules?.[0]?.module;
    if (modules) {
      for (const module of modules) {
        const moduleArtifactId = await this.getModuleArtifactId(projectPath, module);
        if (moduleArtifactId) {
          candidateIds.push(moduleArtifactId);
        }
      }
    }

    return candidateIds;
  }

  /**
   * Get artifactId from submodule pom.xml
   */
  static async getModuleArtifactId(parentPath: string, moduleName: string): Promise<string | null> {
    try {
      const modulePomPath = path.join(parentPath, moduleName, 'pom.xml');

      if (!fs.existsSync(modulePomPath)) {
        return null;
      }

      const pomContent = fs.readFileSync(modulePomPath, 'utf8');
      const result = (await parseXML(pomContent)) as any;

      return result.project?.artifactId?.[0] || null;
    } catch (error) {
      logger.warn(`Failed to parse submodule pom.xml for ${moduleName}: ${error}`);
      return null;
    }
  }

  /**
   * Find Maven module root path by artifactId
   */
  static async findMavenModuleRootPath(project: ProjectInfo, artifactId: string): Promise<string> {
    try {
      const pomContent = fs.readFileSync(project.configFile, 'utf8');
      const result = (await parseXML(pomContent)) as any;

      const modules = result.project?.modules?.[0]?.module;
      if (!modules) {
        return project.rootPath;
      }

      // Search each module for matching artifactId
      for (const module of modules) {
        const modulePomPath = path.join(project.rootPath, module, 'pom.xml');
        if (fs.existsSync(modulePomPath)) {
          const moduleArtifactId = await this.getModuleArtifactId(project.rootPath, module);
          if (moduleArtifactId === artifactId) {
            return path.join(project.rootPath, module);
          }
        }
      }
    } catch (error) {
      logger.warn(`Failed to find Maven module root for ${artifactId}: ${error}`);
    }

    return project.rootPath;
  }

  static async getPomStructure(pomUri: vscode.Uri): Promise<{ modules: string[]; packaging?: string }> {
    try {
      const pomContent = await vscode.workspace.fs.readFile(pomUri);
      const result = (await parseXML(pomContent.toString())) as any;

      const rawModules = result.project?.modules?.[0]?.module ?? [];
      const modules = Array.isArray(rawModules)
        ? rawModules
            .map((module: any) => {
              if (typeof module === 'string') {
                return module.trim();
              }
              if (typeof module === 'object' && module?._) {
                return String(module._).trim();
              }
              return '';
            })
            .filter((module: string) => module.length > 0)
        : [];

      const packaging = result.project?.packaging?.[0];

      return {
        modules,
        packaging: typeof packaging === 'string' ? packaging.trim() : undefined,
      };
    } catch (error) {
      logger.warn(`Failed to parse pom structure for ${pomUri.fsPath}: ${error}`);
      return {
        modules: [],
      };
    }
  }
}
