import * as vscode from 'vscode';
import { getPrefixedLogger } from '../logger';
import { IProjectDiscoverer, UnifiedProjectInfo } from './types';
import { JavaScriptDiscoverer } from './strategies/javascript/jsDiscoveryStrategy';
import { PythonDiscoverer } from './strategies/python/pyDiscoveryStrategy';
import { JavaDiscoveryStrategy } from './strategies/java/JavaDiscoveryStrategy';

export class DiscoveryService {
  private static instance: DiscoveryService;
  private discoveredProjects: UnifiedProjectInfo[] = [];
  private logger = getPrefixedLogger('DiscoveryService');

  private readonly discoverers = new Map<string, IProjectDiscoverer | JavaDiscoveryStrategy>([
    ['javascript', new JavaScriptDiscoverer()],
    ['python', new PythonDiscoverer()],
    ['java', new JavaDiscoveryStrategy()],
  ]);

  private constructor() {}

  public static getInstance(): DiscoveryService {
    if (!DiscoveryService.instance) {
      DiscoveryService.instance = new DiscoveryService();
    }
    return DiscoveryService.instance;
  }

  public async discoverAllProjects(): Promise<UnifiedProjectInfo[]> {
    this.logger.info('Starting multi-language project discovery...');
    this.discoveredProjects = [];

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      this.logger.warn('No workspace folders found');
      return [];
    }

    const workspacePath = workspaceFolders[0].uri.fsPath;
    this.logger.info(`Scanning workspace: ${workspacePath}`);

    const allProjects: UnifiedProjectInfo[] = [];

    for (const [language, discoverer] of this.discoverers) {
      try {
        this.logger.info(`Discovering ${language} projects...`);
        if (discoverer instanceof JavaDiscoveryStrategy) {
          const projects = await discoverer.discover(workspacePath);
          allProjects.push(...projects);
        } else {
          const candidates = await discoverer.scanCandidates(workspacePath);
          for (const candidate of candidates) {
            const projectInfo = await discoverer.analyzeProject(candidate);
            if (projectInfo) {
              const unifiedInfo = await discoverer.createUnifiedInfo(projectInfo);
              allProjects.push(unifiedInfo);
            }
          }
        }
      } catch (error) {
        this.logger.error(`Failed to discover ${language} projects: ${error}`);
      }
    }

    this.discoveredProjects = allProjects;

    this.logger.info(`Discovery completed. Found ${this.discoveredProjects.length} projects total`);
    return this.discoveredProjects;
  }

  public getDiscoveredProjects(): UnifiedProjectInfo[] {
    return this.discoveredProjects;
  }

  public clearDiscoveredProjects(): void {
    this.discoveredProjects = [];
  }
}
