import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { getPrefixedLogger } from '../../../logger';
import { ProjectInfo } from '../../types';

const logger = getPrefixedLogger('GradleParser');

export class GradleParser {
  /**
   * Find Gradle projects by searching for build.gradle files
   */
  static async findGradleProjects(workspacePath: string): Promise<ProjectInfo[]> {
    const projects: ProjectInfo[] = [];
    const gradleFiles = await vscode.workspace.findFiles('**/build.gradle', '**/node_modules/**');
    const gradleKtsFiles = await vscode.workspace.findFiles('**/build.gradle.kts', '**/node_modules/**');

    const allGradleFiles = [...gradleFiles, ...gradleKtsFiles];

    for (const gradleFile of allGradleFiles) {
      const projectPath = path.dirname(gradleFile.fsPath);
      const projectInfo = await this.parseGradleProject(projectPath, gradleFile.fsPath);
      if (projectInfo) {
        projects.push(projectInfo);
      }
    }

    return projects;
  }

  /**
   * Parse Gradle project information from build.gradle
   */
  static async parseGradleProject(projectPath: string, gradlePath: string): Promise<ProjectInfo | null> {
    try {
      const gradleContent = fs.readFileSync(gradlePath, 'utf8');

      // Simple regex-based parsing for basic information
      const artifactIdMatch = gradleContent.match(/(?:archiveBaseName|baseName)\s*=\s*['"]([^'"]+)['"]/);
      const versionMatch = gradleContent.match(/version\s*=\s*['"]([^'"]+)['"]/);

      const artifactId = artifactIdMatch?.[1] || path.basename(projectPath);
      const version = versionMatch?.[1] || '1.0.0';
      const packaging = gradleContent.includes("apply plugin: 'war'") || gradleContent.includes("id 'war'") ? 'war' : 'jar';

      // For Gradle, extract candidate artifactIds from subprojects
      const candidateArtifactIds = await this.extractGradleCandidateArtifactIds(projectPath, gradleContent);

      return {
        type: 'gradle',
        rootPath: projectPath,
        configFile: gradlePath,
        artifactId,
        version,
        packaging,
        candidateArtifactIds,
      };
    } catch (error) {
      logger.error(`Failed to parse Gradle project at ${gradlePath}: ${error}`);
      return null;
    }
  }

  /**
   * Extract candidate artifactIds from Gradle project (current + subprojects)
   */
  static async extractGradleCandidateArtifactIds(projectPath: string, gradleContent: string): Promise<string[]> {
    const candidateIds: string[] = [];

    // Add current project's artifactId
    const artifactIdMatch = gradleContent.match(/(?:archiveBaseName|baseName)\s*=\s*['"]([^'"]+)['"]/);
    const currentArtifactId = artifactIdMatch?.[1] || path.basename(projectPath);
    candidateIds.push(currentArtifactId);

    // Look for subprojects in settings.gradle
    const settingsGradlePath = path.join(projectPath, 'settings.gradle');
    if (fs.existsSync(settingsGradlePath)) {
      try {
        const settingsContent = fs.readFileSync(settingsGradlePath, 'utf8');
        const includeMatches = settingsContent.matchAll(/include\s*['"]([^'"]+)['"]/g);

        for (const match of includeMatches) {
          const subprojectName = match[1];
          // For Gradle, subproject names are often used as artifactIds
          candidateIds.push(subprojectName.replace(':', ''));
        }
      } catch (error) {
        logger.warn(`Failed to parse settings.gradle at ${settingsGradlePath}: ${error}`);
      }
    }

    return candidateIds;
  }

  /**
   * Find Gradle module root path by artifactId
   */
  static async findGradleModuleRootPath(project: ProjectInfo, artifactId: string): Promise<string> {
    try {
      const settingsGradlePath = path.join(project.rootPath, 'settings.gradle');
      if (!fs.existsSync(settingsGradlePath)) {
        return project.rootPath;
      }

      const settingsContent = fs.readFileSync(settingsGradlePath, 'utf8');
      const includeMatches = settingsContent.matchAll(/include\s*['"]([^'"]+)['"]/g);

      for (const match of includeMatches) {
        const subprojectName = match[1].replace(':', '');
        if (subprojectName === artifactId) {
          return path.join(project.rootPath, subprojectName);
        }
      }
    } catch (error) {
      logger.warn(`Failed to find Gradle module root for ${artifactId}: ${error}`);
    }

    return project.rootPath;
  }
}
