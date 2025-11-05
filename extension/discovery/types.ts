export interface ProjectInfo {
  type: 'maven' | 'gradle';
  rootPath: string;
  configFile: string;
  artifactId?: string;
  version?: string;
  packaging?: string;
  candidateArtifactIds?: string[]; // All non-dependency artifactIds (current project + submodules)
  hasBuildSection?: boolean; // Whether the Maven pom.xml contains <build> section
  finalName?: string; // Custom finalName from <build> section
  buildDirectory?: string; // Custom build directory (default: target)
}

export interface ArtifactInfo {
  fileName: string;
  filePath: string;
  projectInfo: ProjectInfo;
  size: number;
  lastModified: Date;
  moduleRootPath: string; // The root path of the module that generated this artifact
  sourceCodePaths: string[]; // Array of source code directory paths
}

// Extended interfaces for multi-language support
export interface ExtendedProjectInfo {
  type: 'maven' | 'gradle' | 'javascript' | 'typescript' | 'python';
  language: 'java' | 'javascript' | 'python';
  rootPath: string;
  configFile: string;
  sourceDirectories: string[]; // Source code directories
  packageName?: string; // Project/package name
  framework?: string; // Framework type (react, vue, django, flask, etc.)
  workspaceType?: string; // Monorepo type (npm, yarn, lerna, etc.)
  subProjects?: ExtendedProjectInfo[]; // Sub-projects list
  entryPoints?: string[]; // Entry files

  // Java-specific fields (optional for other languages)
  artifactId?: string;
  version?: string;
  packaging?: string;
  candidateArtifactIds?: string[];
  hasBuildSection?: boolean;
  finalName?: string;
  buildDirectory?: string;
}

// Unified project info for both artifacts (Java) and source projects (JS/Python)
export interface UnifiedProjectInfo {
  projectInfo: ExtendedProjectInfo;
  moduleRootPath: string;
  sourceCodePaths: string[];
  language: 'java' | 'javascript' | 'python';
  artifacts?: ArtifactInfo[]; // Only for Java projects with build artifacts
  displayLabel: string; // For user selection UI
}

// User selection and packaging interfaces
export interface ProjectCandidate {
  id: string;
  unifiedInfo: UnifiedProjectInfo;
  selected: boolean;
  groupId?: string; // For grouping in UI (by git root, etc.)
}

// Strategy pattern interfaces for project discovery
export interface IProjectDiscoverer {
  readonly language: string;

  /**
   * Phase 1: Scan and filter potential project indicators
   */
  scanCandidates(workspacePath: string): Promise<string[]>;

  /**
   * Phase 2: Analyze and enrich project information with signals
   */
  analyzeProject(configPath: string): Promise<ExtendedProjectInfo | null>;

  /**
   * Phase 3: Create unified project info for user selection
   */
  createUnifiedInfo(projectInfo: ExtendedProjectInfo): Promise<UnifiedProjectInfo>;
}
