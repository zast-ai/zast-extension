import * as vscode from 'vscode';

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

export interface LoggerOptions {
  enableConsole?: boolean;
  enableOutputChannel?: boolean;
  logLevel?: LogLevel;
  prefix?: string;
}

export class Logger {
  private static instance: Logger;
  private outputChannel: vscode.OutputChannel;
  private enableConsole: boolean = true;
  private enableOutputChannel: boolean = true;
  private logLevel: LogLevel = LogLevel.INFO;
  private prefix: string = '';

  private constructor() {
    this.outputChannel = vscode.window.createOutputChannel('Zast');
    this.loadConfiguration();
  }

  public static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  /**
   * Load configuration based on environment
   */
  private loadConfiguration(): void {
    // Check if we're in development mode
    const isDevelopment = process.env.NODE_ENV === 'development' || process.env.VSCODE_DEBUG_MODE === 'true' || process.env.NODE_ENV === 'dev';

    this.enableConsole = true;
    this.enableOutputChannel = true;

    // Set log level based on environment
    if (isDevelopment) {
      this.logLevel = LogLevel.DEBUG; // Show all logs in development
    } else {
      this.logLevel = LogLevel.INFO; // Only show INFO and above in production
    }
  }

  /**
   * Parse log level from string
   */
  private parseLogLevel(level: string): LogLevel {
    switch (level.toUpperCase()) {
      case 'DEBUG':
        return LogLevel.DEBUG;
      case 'INFO':
        return LogLevel.INFO;
      case 'WARN':
        return LogLevel.WARN;
      case 'ERROR':
        return LogLevel.ERROR;
      default:
        return LogLevel.INFO;
    }
  }

  /**
   * Get log level name
   */
  private getLogLevelName(level: LogLevel): string {
    switch (level) {
      case LogLevel.DEBUG:
        return 'DEBUG';
      case LogLevel.INFO:
        return 'INFO';
      case LogLevel.WARN:
        return 'WARN';
      case LogLevel.ERROR:
        return 'ERROR';
      default:
        return 'INFO';
    }
  }

  /**
   * Format log message
   */
  private formatMessage(level: LogLevel, message: string, prefix?: string): string {
    const timestamp = new Date().toISOString();
    const levelName = this.getLogLevelName(level);
    const prefixStr = prefix || this.prefix;
    const prefixPart = prefixStr ? `[${prefixStr}] ` : '';

    return `[${timestamp}] [${levelName}] ${prefixPart}${message}`;
  }

  /**
   * Log message with specified level
   */
  private log(level: LogLevel, message: string, prefix?: string): void {
    // Check if log level is enabled
    if (level < this.logLevel) {
      return;
    }

    const formattedMessage = this.formatMessage(level, message, prefix);

    // Output to console
    if (this.enableConsole) {
      switch (level) {
        case LogLevel.DEBUG:
          console.debug(formattedMessage);
          break;
        case LogLevel.INFO:
          console.log(formattedMessage);
          break;
        case LogLevel.WARN:
          console.warn(formattedMessage);
          break;
        case LogLevel.ERROR:
          console.error(formattedMessage);
          break;
      }
    }

    // Output to output channel
    if (this.enableOutputChannel) {
      this.outputChannel.appendLine(formattedMessage);
    }
  }

  /**
   * Debug level logging
   */
  public debug(message: string, prefix?: string): void {
    this.log(LogLevel.DEBUG, message, prefix);
  }

  /**
   * Info level logging
   */
  public info(message: string, prefix?: string): void {
    this.log(LogLevel.INFO, message, prefix);
  }

  /**
   * Warning level logging
   */
  public warn(message: string, prefix?: string): void {
    this.log(LogLevel.WARN, message, prefix);
  }

  /**
   * Error level logging
   */
  public error(message: string, prefix?: string): void {
    this.log(LogLevel.ERROR, message, prefix);
  }

  /**
   * Create a prefixed logger instance
   */
  public createPrefixedLogger(prefix: string): PrefixedLogger {
    return new PrefixedLogger(this, prefix);
  }

  /**
   * Show output channel
   */
  public show(): void {
    this.outputChannel.show();
  }

  /**
   * Clear output channel
   */
  public clear(): void {
    this.outputChannel.clear();
  }

  /**
   * Update configuration
   */
  public updateConfiguration(options: Partial<LoggerOptions>): void {
    if (options.enableConsole !== undefined) {
      this.enableConsole = options.enableConsole;
    }
    if (options.enableOutputChannel !== undefined) {
      this.enableOutputChannel = options.enableOutputChannel;
    }
    if (options.logLevel !== undefined) {
      this.logLevel = options.logLevel;
    }
    if (options.prefix !== undefined) {
      this.prefix = options.prefix;
    }
  }

  /**
   * Get current configuration
   */
  public getConfiguration(): LoggerOptions {
    return {
      enableConsole: this.enableConsole,
      enableOutputChannel: this.enableOutputChannel,
      logLevel: this.logLevel,
      prefix: this.prefix,
    };
  }
}

/**
 * Prefixed logger for specific modules
 */
export class PrefixedLogger {
  constructor(private logger: Logger, private prefix: string) {}

  public debug(message: string): void {
    this.logger.debug(message, this.prefix);
  }

  public info(message: string): void {
    this.logger.info(message, this.prefix);
  }

  public warn(message: string): void {
    this.logger.warn(message, this.prefix);
  }

  public error(message: string): void {
    this.logger.error(message, this.prefix);
  }

  public show(): void {
    this.logger.show();
  }

  public clear(): void {
    this.logger.clear();
  }
}

/**
 * Get global logger instance
 */
export function getLogger(): Logger {
  return Logger.getInstance();
}

/**
 * Get prefixed logger instance
 */
export function getPrefixedLogger(prefix: string): PrefixedLogger {
  return Logger.getInstance().createPrefixedLogger(prefix);
}

/**
 * Convenient logging functions
 */
export const log = {
  debug: (message: string, prefix?: string) => getLogger().debug(message, prefix),
  info: (message: string, prefix?: string) => getLogger().info(message, prefix),
  warn: (message: string, prefix?: string) => getLogger().warn(message, prefix),
  error: (message: string, prefix?: string) => getLogger().error(message, prefix),
  show: () => getLogger().show(),
  clear: () => getLogger().clear(),
};
