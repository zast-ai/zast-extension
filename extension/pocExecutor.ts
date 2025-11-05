import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface PocExecutionResult {
  success: boolean;
  message: string;
  hasCodeRunner: boolean;
  tempFilePath?: string;
}

export class PocExecutor {
  private static readonly LANGUAGE_EXTENSIONS: Record<string, string> = {
    javascript: '.js',
    typescript: '.ts',
    python: '.py',
    java: '.java',
    csharp: '.cs',
    cpp: '.cpp',
    c: '.c',
    go: '.go',
    rust: '.rs',
    php: '.php',
    ruby: '.rb',
    shell: '.sh',
    bash: '.sh',
    powershell: '.ps1',
    sql: '.sql',
    html: '.html',
    css: '.css',
    json: '.json',
    xml: '.xml',
    yaml: '.yaml',
    dockerfile: '.dockerfile',
    makefile: '.makefile',
  };

  private static readonly LANGUAGE_PATTERNS: Record<string, RegExp[]> = {
    javascript: [/console\.log\(/, /function\s+\w+\s*\(/, /const\s+\w+\s*=/, /let\s+\w+\s*=/, /var\s+\w+\s*=/, /require\s*\(/, /import\s+.*from/],
    typescript: [/interface\s+\w+/, /type\s+\w+\s*=/, /:\s*\w+\s*=/, /as\s+\w+/, /import\s+.*from/],
    python: [/def\s+\w+\s*\(/, /class\s+\w+/, /import\s+\w+/, /from\s+\w+\s+import/, /print\s*\(/, /if\s+__name__\s*==\s*['"']__main__['"']/],
    java: [/public\s+class\s+\w+/, /public\s+static\s+void\s+main/, /System\.out\.println/, /import\s+java\./, /package\s+\w+/],
    csharp: [/using\s+System/, /namespace\s+\w+/, /public\s+class\s+\w+/, /Console\.WriteLine/, /static\s+void\s+Main/],
    cpp: [/#include\s*<.*>/, /using\s+namespace\s+std/, /int\s+main\s*\(/, /std::/, /cout\s*<<|cin\s*>>/],
    c: [/#include\s*<.*>/, /int\s+main\s*\(/, /printf\s*\(/, /scanf\s*\(/, /malloc\s*\(/],
    go: [/package\s+main/, /import\s+["`'].*["`']/, /func\s+main\s*\(/, /fmt\.Print/, /go\s+func/],
    rust: [/fn\s+main\s*\(/, /use\s+std::/, /println!\s*\(/, /let\s+mut\s+\w+/, /match\s+\w+/],
    php: [/<\?php/, /echo\s+/, /\$\w+\s*=/, /function\s+\w+\s*\(/, /class\s+\w+/],
    ruby: [/def\s+\w+/, /class\s+\w+/, /puts\s+/, /require\s+['"']\w+['"']/, /end\s*$/],
    shell: [/^#!/, /echo\s+/, /\$\w+/, /if\s+\[.*\]/, /for\s+\w+\s+in/],
    bash: [/^#!.*bash/, /echo\s+/, /\$\w+/, /if\s+\[.*\]/, /for\s+\w+\s+in/],
    powershell: [/Write-Host/, /Get-\w+/, /Set-\w+/, /\$\w+\s*=/, /param\s*\(/],
    sql: [/SELECT\s+.*FROM/i, /INSERT\s+INTO/i, /UPDATE\s+.*SET/i, /DELETE\s+FROM/i, /CREATE\s+TABLE/i],
  };

  /**
   * Check if code-runner extension is installed
   */
  public static async checkCodeRunnerExtension(): Promise<boolean> {
    try {
      const extension = vscode.extensions.getExtension('formulahendry.code-runner');
      return extension !== undefined && extension.isActive;
    } catch (error) {
      console.error('Error checking code-runner extension:', error);
      return false;
    }
  }

  /**
   * Detect programming language from script content
   */
  public static detectLanguage(script: string): string {
    // Clean and normalize the script
    const cleanScript = script.trim().toLowerCase();

    // Check for specific language patterns
    let maxScore = 0;
    let detectedLanguage = 'text';

    for (const [language, patterns] of Object.entries(this.LANGUAGE_PATTERNS)) {
      let score = 0;
      for (const pattern of patterns) {
        if (pattern.test(script)) {
          score++;
        }
      }

      if (score > maxScore) {
        maxScore = score;
        detectedLanguage = language;
      }
    }

    // If no pattern matched, try to detect by common keywords
    if (maxScore === 0) {
      if (cleanScript.includes('console.log') || cleanScript.includes('require(')) {
        detectedLanguage = 'javascript';
      } else if (cleanScript.includes('print(') || cleanScript.includes('def ')) {
        detectedLanguage = 'python';
      } else if (cleanScript.includes('system.out.println') || cleanScript.includes('public class')) {
        detectedLanguage = 'java';
      } else if (cleanScript.includes('echo ') || cleanScript.includes('#!/')) {
        detectedLanguage = 'shell';
      }
    }

    return detectedLanguage;
  }

  /**
   * Get file extension for a programming language
   */
  public static getFileExtension(language: string): string {
    return this.LANGUAGE_EXTENSIONS[language.toLowerCase()] || '.txt';
  }

  /**
   * Create a temporary file for the script
   */
  public static async createTempFile(script: string, language: string): Promise<string> {
    const extension = this.getFileExtension(language);
    const tempDir = os.tmpdir();
    const fileName = `poc_script_${Date.now()}_${Math.random().toString(36).substr(2, 9)}${extension}`;
    const filePath = path.join(tempDir, fileName);

    try {
      await fs.promises.writeFile(filePath, script, 'utf8');
      return filePath;
    } catch (error) {
      throw new Error(`Failed to create temporary file: ${error}`);
    }
  }

  /**
   * Clean up temporary file
   */
  public static async cleanupTempFile(filePath: string): Promise<void> {
    try {
      if (fs.existsSync(filePath)) {
        await fs.promises.unlink(filePath);
      }
    } catch (error) {
      console.warn('Warning: Failed to cleanup temporary file:', error);
    }
  }

  /**
   * Execute POC script using code-runner extension
   */
  public static async executePocScript(script: string): Promise<PocExecutionResult> {
    try {
      // Check if code-runner extension is installed
      const hasCodeRunner = await this.checkCodeRunnerExtension();

      if (!hasCodeRunner) {
        return {
          success: false,
          message: 'Code Runner extension is not installed or not active. Please install the "Code Runner" extension to execute POC scripts.',
          hasCodeRunner: false,
        };
      }

      // Detect language
      const language = this.detectLanguage(script);

      // Create temporary file
      const tempFilePath = await this.createTempFile(script, language);

      try {
        // Create URI for the temporary file
        const fileUri = vscode.Uri.file(tempFilePath);

        // Execute using code-runner
        await vscode.commands.executeCommand('code-runner.run', fileUri);

        return {
          success: true,
          message: `POC script executed successfully. Language detected: ${language}. Check the terminal for output.`,
          hasCodeRunner: true,
          tempFilePath,
        };
      } catch (executionError) {
        // Clean up temp file on execution error
        await this.cleanupTempFile(tempFilePath);

        throw new Error(`Failed to execute POC script: ${executionError}`);
      }
    } catch (error) {
      return {
        success: false,
        message: `Error executing POC script: ${error instanceof Error ? error.message : String(error)}`,
        hasCodeRunner: true,
      };
    }
  }

  /**
   * Execute POC script with automatic cleanup
   */
  public static async executePocScriptWithCleanup(script: string, cleanupDelayMs: number = 5000): Promise<PocExecutionResult> {
    const result = await this.executePocScript(script);

    // Schedule cleanup of temp file after a delay
    if (result.success && result.tempFilePath) {
      setTimeout(async () => {
        await this.cleanupTempFile(result.tempFilePath!);
      }, cleanupDelayMs);
    }

    return result;
  }
}
