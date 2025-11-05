import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ArtifactInfo, ProjectInfo } from '../../types';
import { MavenParser } from './MavenParser';

// Helper class to locate build artifacts (jar, war) for a given project
export class ArtifactLocator {
  /**
   * Discover artifacts for a specific project
   */
  static async discoverProjectArtifacts(project: ProjectInfo, findSourceCodePaths: (moduleRootPath: string) => Promise<string[]>): Promise<ArtifactInfo[]> {
    const allArtifacts: ArtifactInfo[] = [];

    // Strategy 1: Static analysis (preferred)
    const staticArtifacts = await this.discoverArtifactsByStatic(project, findSourceCodePaths);
    allArtifacts.push(...staticArtifacts);

    // Strategy 2: File scanning (comprehensive)
    // if (staticArtifacts.length === 0) {
    const scannedArtifacts = await this.discoverArtifactsByScanning(project, findSourceCodePaths);
    allArtifacts.push(...scannedArtifacts);
    // }

    // Deduplicate artifacts based on file path
    const deduplicatedArtifacts = this.deduplicateArtifacts(allArtifacts);

    return deduplicatedArtifacts;
  }

  /**
   * Discover artifacts using static analysis
   */
  private static async discoverArtifactsByStatic(project: ProjectInfo, findSourceCodePaths: (moduleRootPath: string) => Promise<string[]>): Promise<ArtifactInfo[]> {
    const artifacts: ArtifactInfo[] = [];

    if (project.type === 'maven') {
      const buildDir = project.buildDirectory || 'target';
      const targetDir = path.join(project.rootPath, buildDir);

      // Get all possible artifact names
      const possibleArtifactNames = this.generatePossibleArtifactNames(project);

      // Check each possible artifact name
      for (const artifactName of possibleArtifactNames) {
        const expectedPath = path.join(targetDir, artifactName);

        if (fs.existsSync(expectedPath)) {
          const stats = fs.statSync(expectedPath);

          // Extract artifactId from file name to find correct module
          const artifactId = this.extractArtifactIdFromFileName(artifactName, project.candidateArtifactIds || []);
          const moduleRootPath = artifactId ? await MavenParser.findMavenModuleRootPath(project, artifactId) : project.rootPath;
          const sourceCodePaths = await findSourceCodePaths(moduleRootPath);

          artifacts.push({
            fileName: artifactName,
            filePath: expectedPath,
            projectInfo: project,
            size: stats.size,
            lastModified: stats.mtime,
            moduleRootPath,
            sourceCodePaths,
          });
        }
      }
    } else if (project.type === 'gradle') {
      // ... (Gradle static discovery logic will be added here)
    }

    return artifacts;
  }

  /**
   * Discover artifacts using file scanning
   */
  private static async discoverArtifactsByScanning(project: ProjectInfo, findSourceCodePaths: (moduleRootPath: string) => Promise<string[]>): Promise<ArtifactInfo[]> {
    const artifacts: ArtifactInfo[] = [];

    let searchPattern: string;
    if (project.type === 'maven') {
      const buildDir = project.buildDirectory || 'target';
      searchPattern = `${buildDir}/**/*.{jar,war}`;
    } else {
      searchPattern = 'build/libs/**/*.{jar,war}';
    }

    const projectUri = vscode.Uri.file(project.rootPath);
    const relativePattern = new vscode.RelativePattern(projectUri, searchPattern);
    const files = await vscode.workspace.findFiles(relativePattern);

    for (const file of files) {
      const fileName = path.basename(file.fsPath);

      if (this.isDeploymentArtifact(fileName) && this.isLikelyProjectArtifact(fileName, project)) {
        const stats = fs.statSync(file.fsPath);

        const artifactId = this.extractArtifactIdFromFileName(fileName, project.candidateArtifactIds || []);
        const moduleRootPath = artifactId ? await MavenParser.findMavenModuleRootPath(project, artifactId) : project.rootPath;
        const sourceCodePaths = await findSourceCodePaths(moduleRootPath);

        artifacts.push({
          fileName,
          filePath: file.fsPath,
          projectInfo: project,
          size: stats.size,
          lastModified: stats.mtime,
          moduleRootPath,
          sourceCodePaths,
        });
      }
    }

    return artifacts;
  }

  /**
   * Check if a file is a deployment artifact (filter out sources, javadoc, etc.)
   */
  private static isDeploymentArtifact(fileName: string): boolean {
    const excludePatterns = [/-sources\.jar$/, /-javadoc\.jar$/, /-test.*\.jar$/, /^original-.*\.jar$/];
    return !excludePatterns.some((pattern) => pattern.test(fileName));
  }

  /**
   * Check if a file is likely a project artifact
   */
  private static isLikelyProjectArtifact(fileName: string, project: ProjectInfo): boolean {
    const nameWithoutExtension = fileName.replace(/\.(jar|war)$/, '');

    if (project.finalName && nameWithoutExtension === project.finalName) {
      return true;
    }

    if (project.candidateArtifactIds && this.matchesCandidateArtifactIds(fileName, project.candidateArtifactIds)) {
      return true;
    }

    const versionPattern = /.*-\d+(\.\d+)*(-\w+)?$/;
    if (versionPattern.test(nameWithoutExtension)) {
      return true;
    }

    const excludePatterns = [/^spring-boot-devtools/, /^maven-/, /^junit/, /^mockito/, /^slf4j/, /^logback/, /^jackson/];
    return !excludePatterns.some((pattern) => pattern.test(nameWithoutExtension));
  }

  private static matchesCandidateArtifactIds(fileName: string, candidateArtifactIds: string[]): boolean {
    const nameWithoutExtension = fileName.replace(/\.(jar|war)$/, '');
    return candidateArtifactIds.some((artifactId) => {
      return nameWithoutExtension === artifactId || nameWithoutExtension.startsWith(artifactId + '-') || nameWithoutExtension.startsWith(artifactId + '_');
    });
  }

  private static generatePossibleArtifactNames(project: ProjectInfo): string[] {
    const names: string[] = [];
    const packaging = project.packaging || 'jar';
    if (project.finalName) {
      names.push(`${project.finalName}.${packaging}`);
    }
    if (project.artifactId && project.version) {
      names.push(`${project.artifactId}-${project.version}.${packaging}`);
    }
    if (project.artifactId) {
      names.push(`${project.artifactId}.${packaging}`);
    }
    if (project.candidateArtifactIds && project.version) {
      for (const candidateId of project.candidateArtifactIds) {
        names.push(`${candidateId}-${project.version}.${packaging}`);
        names.push(`${candidateId}.${packaging}`);
      }
    }
    return [...new Set(names)];
  }

  private static extractArtifactIdFromFileName(fileName: string, candidateArtifactIds: string[]): string | null {
    const nameWithoutExtension = fileName.replace(/\.(jar|war)$/, '');
    for (const artifactId of candidateArtifactIds) {
      if (nameWithoutExtension === artifactId || nameWithoutExtension.startsWith(artifactId + '-') || nameWithoutExtension.startsWith(artifactId + '_')) {
        return artifactId;
      }
    }
    return null;
  }

  private static deduplicateArtifacts(artifacts: ArtifactInfo[]): ArtifactInfo[] {
    const artifactMap = new Map<string, ArtifactInfo>();
    for (const artifact of artifacts) {
      const normalizedPath = path.resolve(artifact.filePath);
      if (!artifactMap.has(normalizedPath)) {
        artifactMap.set(normalizedPath, artifact);
      } else {
        const existing = artifactMap.get(normalizedPath)!;
        const better = this.selectBetterArtifact(existing, artifact);
        artifactMap.set(normalizedPath, better);
      }
    }
    return Array.from(artifactMap.values());
  }

  private static selectBetterArtifact(artifact1: ArtifactInfo, artifact2: ArtifactInfo): ArtifactInfo {
    if (artifact1.sourceCodePaths.length !== artifact2.sourceCodePaths.length) {
      return artifact1.sourceCodePaths.length > artifact2.sourceCodePaths.length ? artifact1 : artifact2;
    }
    const artifact1IsProjectRoot = artifact1.moduleRootPath === artifact1.projectInfo.rootPath;
    const artifact2IsProjectRoot = artifact2.moduleRootPath === artifact2.projectInfo.rootPath;
    if (artifact1IsProjectRoot !== artifact2IsProjectRoot) {
      return artifact1IsProjectRoot ? artifact2 : artifact1;
    }
    return artifact1;
  }
}
