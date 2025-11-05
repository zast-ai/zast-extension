import * as path from 'path';
import * as fs from 'fs';
import { promisify } from 'util';
import { exec } from 'child_process';
import { getPrefixedLogger } from '../logger';

const execAsync = promisify(exec);

// Git utilities for finding Git root and getting valid files
export interface GitInfo {
  gitRoot: string | null;
}

// Git utilities for finding Git root and getting valid files
export class GitUtilities {
  private static logger = getPrefixedLogger('GitUtils');

  /**
   * Find Git root directory from any starting path using git command
   */
  static async findGitRoot(startPath: string): Promise<string | null> {
    try {
      // Method 1: Use git command (preferred)
      const gitRoot = await this.findGitRootWithCommand(startPath);
      if (gitRoot) {
        return gitRoot;
      }
    } catch (error) {
      this.logger.warn(`Git command failed, falling back to file system search: ${error}`);
    }

    // Method 2: Fallback to file system search
    return await this.findGitRootWithFileSystem(startPath);
  }

  /**
   * Find Git root using git rev-parse command
   */
  private static async findGitRootWithCommand(startPath: string): Promise<string | null> {
    try {
      const normalizedPath = path.resolve(startPath);

      // Execute git command in the target directory
      const { stdout, stderr } = await execAsync('git rev-parse --show-toplevel', {
        cwd: normalizedPath,
        timeout: 5000, // 5 second timeout
      });

      if (stderr) {
        this.logger.warn(`Git command stderr: ${stderr}`);
      }

      const gitRoot = stdout.trim();

      // Verify the result is a valid directory
      if (gitRoot && fs.existsSync(gitRoot) && fs.statSync(gitRoot).isDirectory()) {
        return path.resolve(gitRoot);
      }

      return null;
    } catch (error) {
      // Command failed - likely not in a git repository or git not available
      return null;
    }
  }

  /**
   * Find Git root using file system traversal (fallback method)
   */
  private static async findGitRootWithFileSystem(startPath: string): Promise<string | null> {
    let currentPath = path.resolve(startPath);
    const rootPath = path.parse(currentPath).root;

    while (currentPath !== rootPath) {
      const gitPath = path.join(currentPath, '.git');
      try {
        const stats = fs.statSync(gitPath);
        if (stats.isDirectory() || stats.isFile()) {
          return currentPath;
        }
      } catch (error) {
        // .git doesn't exist, continue searching
      }

      currentPath = path.dirname(currentPath);
    }

    return null;
  }

  /**
   * Get valid files in a target directory using git ls-files command
   */
  static async getValidFiles(gitRoot: string, targetPath?: string): Promise<string[]> {
    try {
      const normalizedGitRoot = path.resolve(gitRoot);

      // Build git ls-files command
      // -c: show cached files (tracked files)
      // -o: show other files (untracked files)
      // --exclude-standard: exclude files specified in .gitignore and other standard ignore files
      let command = 'git ls-files -co --exclude-standard';

      // If targetPath is provided, add it as a path filter
      if (targetPath) {
        const normalizedTargetPath = path.resolve(targetPath);

        // Ensure target path is within git root
        if (!normalizedTargetPath.toLowerCase().startsWith(normalizedGitRoot.toLowerCase())) {
          this.logger.warn(`Target path ${targetPath} is not within Git root ${gitRoot}`);
          return [];
        }

        // Get relative path from git root for the command
        const relativePath = path.relative(normalizedGitRoot, normalizedTargetPath);
        if (relativePath) {
          command += ` -- "${relativePath}"`;
        }
      }

      // Execute git command in the git root directory
      const { stdout, stderr } = await execAsync(command, {
        cwd: normalizedGitRoot,
        timeout: 30000, // 30 second timeout
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer for large repositories
      });

      if (stderr) {
        this.logger.warn(`Git ls-files stderr: ${stderr}`);
      }

      // Parse output and convert to absolute paths
      const files = stdout
        .trim()
        .split('\n')
        .filter((line) => line.trim()) // Remove empty lines
        .map((relativePath) => path.resolve(normalizedGitRoot, relativePath))
        .filter((filePath) => {
          // Verify file exists and is actually a file
          try {
            const stats = fs.statSync(filePath);
            return stats.isFile();
          } catch (error) {
            this.logger.warn(`File not accessible: ${filePath}`);
            return false;
          }
        });

      this.logger.info(`Found ${files.length} valid files in ${targetPath || gitRoot}`);
      return files;
    } catch (error) {
      this.logger.error(`Failed to get valid files: ${error}`);
      return [];
    }
  }

  /**
   * Get Git info for a source directory
   */
  static async getGitInfo(sourceDirectory: string): Promise<GitInfo> {
    const gitRoot = await this.findGitRoot(sourceDirectory);

    return {
      gitRoot,
    };
  }
}
