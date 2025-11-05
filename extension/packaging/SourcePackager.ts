import * as path from 'path';
import * as fs from 'fs';
import archiver from 'archiver';
import { getPrefixedLogger } from '../logger';
import { GitInfo, GitUtilities } from '../utils/git';
import { PackageResult, SourcePackageOptions } from './types';

// Source code packaging interface
export interface ISourcePackager {
  packageSources(sourceDirectories: string[], gitInfo: GitInfo, options?: SourcePackageOptions): Promise<PackageResult>;
}

// Source code packaging implementation
export class SourceCodePackager implements ISourcePackager {
  private logger = getPrefixedLogger('Packager');

  /**
   * Package source directories into a ZIP file
   */
  async packageSources(sourceDirectories: string[], gitInfo: GitInfo, options: SourcePackageOptions = {}): Promise<PackageResult> {
    const startTime = Date.now();
    this.logger.info(`Starting to package ${sourceDirectories.length} source directories`);

    if (!gitInfo.gitRoot) {
      throw new Error('Git root is required for packaging');
    }

    // Get valid files using git ls-files for each source directory
    this.logger.info('Getting valid files using git ls-files...');
    const validFiles = await this.getValidFilesFromDirectories(sourceDirectories, gitInfo.gitRoot);

    // Create ZIP package
    this.logger.info(`Creating ZIP package with ${validFiles.length} files...`);
    const packageResult = await this.createZipPackage(validFiles, sourceDirectories, gitInfo, options);

    const result: PackageResult = {
      ...packageResult,
      processingTime: Date.now() - startTime,
      includedFiles: validFiles.length,
      excludedFiles: 0,
      errors: packageResult.errors,
    };

    this.logger.info(`Packaging completed in ${result.processingTime}ms`);
    this.logger.info(`Included: ${result.includedFiles} files`);

    return result;
  }

  /**
   * Get valid files from source directories using git ls-files
   */
  private async getValidFilesFromDirectories(sourceDirectories: string[], gitRoot: string): Promise<string[]> {
    const allFiles: string[] = [];

    for (const sourceDir of sourceDirectories) {
      try {
        const files = await GitUtilities.getValidFiles(gitRoot, sourceDir);
        allFiles.push(...files);
        this.logger.info(`Found ${files.length} valid files in ${sourceDir}`);
      } catch (error) {
        this.logger.error(`Failed to get valid files from ${sourceDir}: ${error}`);
      }
    }

    // Remove duplicates
    return [...new Set(allFiles)];
  }

  /**
   * Create ZIP package with filtered files using archiver
   */
  private async createZipPackage(
    files: string[],
    sourceDirectories: string[],
    gitInfo: GitInfo,
    options: SourcePackageOptions
  ): Promise<Omit<PackageResult, 'processingTime' | 'includedFiles' | 'excludedFiles'>> {
    return new Promise((resolve, reject) => {
      try {
        const outputPath = this.generateOutputPath(gitInfo.gitRoot!, options);
        const outputDir = path.dirname(outputPath);

        // Ensure output directory exists
        if (!fs.existsSync(outputDir)) {
          fs.mkdirSync(outputDir, { recursive: true });
        }

        // Create write stream for the ZIP file
        const output = fs.createWriteStream(outputPath);
        const archive = archiver('zip', {
          zlib: { level: options.compressionLevel || 6 }, // Compression level
        });

        let totalSize = 0;
        const errors: string[] = [];

        // Handle archive events
        archive.on('error', (err) => {
          reject(new Error(`Archive error: ${err.message}`));
        });

        archive.on('warning', (err) => {
          if (err.code === 'ENOENT') {
            this.logger.warn(`Archive warning: ${err.message}`);
          } else {
            reject(new Error(`Archive warning: ${err.message}`));
          }
        });

        output.on('close', () => {
          try {
            const compressedSize = fs.statSync(outputPath).size;
            const compressionRatio = totalSize > 0 ? Math.round((1 - compressedSize / totalSize) * 100) : 0;

            this.logger.info(`ZIP package created: ${outputPath}`);
            this.logger.info(`Total size: ${totalSize} bytes, Compressed: ${compressedSize} bytes, Ratio: ${compressionRatio}%`);

            resolve({
              success: true,
              zipFilePath: outputPath,
              gitRoot: gitInfo.gitRoot!,
              sourceDirectories,
              totalSize,
              compressedSize,
              compressionRatio,
              errors,
            });
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            reject(new Error(`Failed to finalize ZIP package: ${errorMessage}`));
          }
        });

        output.on('error', (err) => {
          reject(new Error(`Output stream error: ${err.message}`));
        });

        // Pipe archive data to the file
        archive.pipe(output);

        // Add files to archive
        let processed = 0;
        for (const file of files) {
          try {
            const normalizedFile = path.normalize(file);
            // Check if file exists and is a file
            if (!fs.existsSync(normalizedFile)) {
              const errorMessage = `File not found: ${normalizedFile}`;
              errors.push(errorMessage);
              this.logger.warn(errorMessage);
              continue;
            }

            const stats = fs.statSync(normalizedFile);
            if (!stats.isFile()) {
              const errorMessage = `Skipping non-file: ${normalizedFile}`;
              errors.push(errorMessage);
              this.logger.warn(errorMessage);
              continue;
            }
            totalSize += stats.size;

            // Calculate relative path from git root and ensure cross-platform compatibility for zip
            const relativePath = path.relative(gitInfo.gitRoot!, normalizedFile);
            const zipPath = relativePath.split(path.sep).join('/');

            // Add file to archive
            archive.file(normalizedFile, { name: zipPath });

            // Report progress
            processed++;
            if (options.onProgress && processed % 50 === 0) {
              options.onProgress({
                processedFiles: processed,
                totalFiles: files.length,
                percentage: Math.round((processed / files.length) * 100),
                currentFile: zipPath,
                phase: 'compressing',
              });
            }
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            errors.push(`Failed to add file ${file}: ${errorMessage}`);
            this.logger.warn(`Failed to add file ${file}: ${errorMessage}`);
          }
        }

        // Finalize the archive
        archive.finalize();
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        reject(new Error(`Failed to create ZIP package: ${errorMessage}`));
      }
    });
  }

  /**
   * Generate output file path
   */
  private generateOutputPath(gitRoot: string, options: SourcePackageOptions): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const projectName = path.basename(gitRoot);
    const fileName = `sources-${projectName}-${timestamp}.zip`;

    const outputDir = options.outputDir || require('os').tmpdir();
    return path.join(outputDir, fileName);
  }
}
