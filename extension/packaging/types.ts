export interface SourcePackageOptions {
  outputDir?: string; // Output directory
  compressionLevel?: number; // Compression level 1-9
  onProgress?: (progress: PackageProgress) => void; // Progress callback
}

export interface PackageProgress {
  processedFiles: number;
  totalFiles: number;
  percentage: number;
  currentFile: string;
  phase: 'compressing';
}

export interface PackageResult {
  success: boolean;
  zipFilePath: string;
  gitRoot: string;
  sourceDirectories: string[];
  includedFiles: number;
  excludedFiles: number;
  totalSize: number;
  compressedSize: number;
  compressionRatio: number;
  processingTime: number;
  errors: string[];
}
