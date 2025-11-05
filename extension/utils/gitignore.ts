import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import ignore from 'ignore';
import { getPrefixedLogger } from '../logger';
import { GitUtilities } from './git';

// GitIgnore filter utility for filtering files based on .gitignore rules
export class GitIgnoreFilter {
  private static logger = getPrefixedLogger('GitIgnoreFilter');
  private ignoreInstance: ReturnType<typeof ignore>;
  private gitRoot: string;

  private constructor(gitRoot: string) {
    this.gitRoot = path.resolve(gitRoot);
    this.ignoreInstance = ignore();
  }

  /**
   * Create a GitIgnoreFilter instance for a given directory
   */
  static async create(startPath: string, additionalPatterns: string[] = []): Promise<GitIgnoreFilter | null> {
    try {
      const gitRoot = await GitUtilities.findGitRoot(startPath);
      if (!gitRoot) {
        this.logger.warn(`No Git repository found for path: ${startPath}`);
        return null;
      }

      const filter = new GitIgnoreFilter(gitRoot);
      await filter.loadGitIgnoreRules(additionalPatterns);
      return filter;
    } catch (error) {
      this.logger.error(`Failed to create GitIgnoreFilter: ${error}`);
      return null;
    }
  }

  /**
   * Load .gitignore rules from the Git repository
   */
  private async loadGitIgnoreRules(additionalPatterns: string[] = []): Promise<void> {
    try {
      // Find all .gitignore files using VSCode API
      const gitignoreFiles = await this.findGitIgnoreFiles();

      // Load patterns from each .gitignore file
      for (const gitignoreFile of gitignoreFiles) {
        try {
          const content = fs.readFileSync(gitignoreFile, 'utf8');
          this.ignoreInstance.add(content);
          GitIgnoreFilter.logger.info(`Loaded .gitignore rules from: ${gitignoreFile}`);
        } catch (error) {
          GitIgnoreFilter.logger.warn(`Failed to read .gitignore file ${gitignoreFile}: ${error}`);
        }
      }

      // Add additional patterns
      if (additionalPatterns.length > 0) {
        this.ignoreInstance.add(additionalPatterns);
        GitIgnoreFilter.logger.info(`Added ${additionalPatterns.length} additional ignore patterns`);
      }

      // Add default patterns that are commonly ignored
      const defaultPatterns = [
        '.git/',
        'node_modules/',
        '__pycache__/',
        '*.pyc',
        'target/',
        'build/',
        'dist/',
        '.venv/',
        'venv/',
        '.env',
        '*.class',
        '*.jar',
        '*.war',
        '.DS_Store',
        'Thumbs.db',
        '*.log',
      ];

      this.ignoreInstance.add(defaultPatterns);
      GitIgnoreFilter.logger.info('Added default ignore patterns');
    } catch (error) {
      GitIgnoreFilter.logger.error(`Failed to load .gitignore rules: ${error}`);
    }
  }

  /**
   * Find .gitignore file in the Git root directory
   */
  private async findGitIgnoreFiles(): Promise<string[]> {
    try {
      // Check if .gitignore exists in the git root directory
      const gitignoreFilePath = path.join(this.gitRoot, '.gitignore');

      if (fs.existsSync(gitignoreFilePath)) {
        GitIgnoreFilter.logger.info(`Found .gitignore file in git root: ${gitignoreFilePath}`);
        return [gitignoreFilePath];
      } else {
        GitIgnoreFilter.logger.info('No .gitignore file found in git root directory');
        return [];
      }
    } catch (error) {
      GitIgnoreFilter.logger.warn(`Failed to find .gitignore file: ${error}`);
      return [];
    }
  }

  /**
   * Check if a file should be ignored based on .gitignore rules
   */
  isIgnored(filePath: string): boolean {
    try {
      const absolutePath = path.resolve(filePath);

      // Get relative path from git root
      const relativePath = path.relative(this.gitRoot, absolutePath);

      // Normalize path separators for cross-platform compatibility
      const normalizedPath = relativePath.replace(/\\/g, '/');

      const { ignored, rule } = this.ignoreInstance.checkIgnore(normalizedPath);
      GitIgnoreFilter.logger.info(`Ignored: ${ignored}, Rule: ${rule}`);
      return ignored;
    } catch (error) {
      GitIgnoreFilter.logger.warn(`Failed to check ignore status for ${filePath}: ${error}`);
      return false;
    }
  }

  /**
   * Filter an array of file paths, removing ignored files
   */
  filterFiles(filePaths: string[]): string[] {
    const filtered: string[] = [];

    for (const filePath of filePaths) {
      if (!this.isIgnored(filePath)) {
        filtered.push(filePath);
      }
    }

    GitIgnoreFilter.logger.info(`Filtered ${filePaths.length} files to ${filtered.length} files`);
    return filtered;
  }

  /**
   * Filter files with detailed results
   */
  filterFilesWithDetails(filePaths: string[]): { included: string[]; excluded: string[]; stats: { total: number; included: number; excluded: number } } {
    const included: string[] = [];
    const excluded: string[] = [];

    for (const filePath of filePaths) {
      if (this.isIgnored(filePath)) {
        excluded.push(filePath);
      } else {
        included.push(filePath);
      }
    }

    const stats = {
      total: filePaths.length,
      included: included.length,
      excluded: excluded.length,
    };

    GitIgnoreFilter.logger.info(`Filter results: ${stats.included} included, ${stats.excluded} excluded out of ${stats.total} total`);

    return { included, excluded, stats };
  }

  /**
   * Get the Git root directory
   */
  getGitRoot(): string {
    return this.gitRoot;
  }
}

/**
 * Utility function to quickly filter files using .gitignore rules
 */
export async function filterWithGitIgnore(filePaths: string[], startPath: string, additionalPatterns: string[] = []): Promise<string[]> {
  const filter = await GitIgnoreFilter.create(startPath, additionalPatterns);
  if (!filter) {
    // If no git repository found, return all files
    return filePaths;
  }

  return filter.filterFiles(filePaths);
}

/**
 * Utility function to check if a single file is ignored
 */
export async function isFileIgnored(filePath: string, startPath: string, additionalPatterns: string[] = []): Promise<boolean> {
  const filter = await GitIgnoreFilter.create(startPath, additionalPatterns);
  if (!filter) {
    // If no git repository found, consider file as not ignored
    return false;
  }

  return filter.isIgnored(filePath);
}
