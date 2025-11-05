import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { getPrefixedLogger } from '../../../logger';
import { ArtifactInfo, ExtendedProjectInfo, IProjectDiscoverer, ProjectInfo, UnifiedProjectInfo } from '../../types';
import { MavenParser } from './MavenParser';
import { GradleParser } from './GradleParser';
import { ArtifactLocator } from './ArtifactLocator';

export class JavaDiscoveryStrategy implements IProjectDiscoverer {
  public readonly language = 'java';
  private logger = getPrefixedLogger('JavaDiscoverer');

  // These methods are part of the interface but are not used directly in this strategy's flow.
  // The main entry point is the `discover` method.
  async scanCandidates(workspacePath: string): Promise<string[]> {
    return [];
  }
  async analyzeProject(configPath: string): Promise<ExtendedProjectInfo | null> {
    return null;
  }
  async createUnifiedInfo(projectInfo: ExtendedProjectInfo): Promise<UnifiedProjectInfo> {
    return {} as UnifiedProjectInfo;
  }

  public async discover(workspacePath: string): Promise<UnifiedProjectInfo[]> {
    this.logger.info('Starting Java project discovery...');
    const javaProjects: UnifiedProjectInfo[] = [];

    const projects = await this.discoverJavaProjects(workspacePath);
    this.logger.info(`Found ${projects.length} Java projects`);

    for (const project of projects) {
      this.logger.info(`Processing project: ${project.type} at ${project.rootPath}`);
      const artifacts = await ArtifactLocator.discoverProjectArtifacts(project, this.findSourceCodePaths);

      if (artifacts.length > 0) {
        const unifiedInfo = this.createUnifiedInfoFromArtifacts(project, artifacts);
        javaProjects.push(unifiedInfo);
      }
    }

    return javaProjects;
  }

  private createUnifiedInfoFromArtifacts(project: ProjectInfo, artifacts: ArtifactInfo[]): UnifiedProjectInfo {
    const firstArtifact = artifacts[0];
    const sourceDirectories = [...new Set(artifacts.flatMap((a) => a.sourceCodePaths))];

    const extendedInfo: ExtendedProjectInfo = {
      ...project,
      language: 'java',
      sourceDirectories,
      packageName: project.artifactId,
    };

    return {
      projectInfo: extendedInfo,
      moduleRootPath: project.rootPath,
      sourceCodePaths: sourceDirectories,
      language: 'java',
      artifacts: artifacts,
      displayLabel: `${project.artifactId || 'Unnamed Java Project'} [${project.type}]`,
    };
  }

  private async discoverJavaProjects(workspacePath: string): Promise<ProjectInfo[]> {
    const mavenProjects = await MavenParser.findMavenProjects(workspacePath);
    const gradleProjects = await GradleParser.findGradleProjects(workspacePath);
    return [...mavenProjects, ...gradleProjects];
  }

  private async findSourceCodePaths(moduleRootPath: string): Promise<string[]> {
    const sourceCodePaths: string[] = [];
    const standardSourceDirs = [
      'src/main/java',
      'src/main/resources',
      'src/test/java',
      'src/test/resources',
      'src/main/kotlin', // For Kotlin projects
      'src/test/kotlin',
    ];

    for (const sourceDir of standardSourceDirs) {
      const fullPath = path.join(moduleRootPath, sourceDir);
      if (fs.existsSync(fullPath)) {
        const stats = fs.statSync(fullPath);
        if (stats.isDirectory()) {
          sourceCodePaths.push(fullPath);
        }
      }
    }
    return sourceCodePaths;
  }
}
