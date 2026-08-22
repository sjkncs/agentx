/**
 * IDE-Resident Workflow - IDE 集成工作流
 * 
 * 提供在 IDE 中运行 Harness Core 的能力:
 * - 文件监听
 * - 选择区跟踪
 * - 上下文管理
 * - 工作流集成
 */

import { EventEmitter } from "node:events";
import { existsSync, readFileSync, watchFile, unwatchFile } from "node:fs";
import path from "node:path";
import type {
  CursorSdkAdapter,
} from "./cursor-adapter.js";
import type {
  CursorFileContext,
  CursorIdeContext,
  CursorSelection,
  CursorPosition,
} from "./cursor-types.js";

/**
 * 工作流事件
 */
export interface IdeWorkflowEvents {
  "file:opened": [file: CursorFileContext];
  "file:changed": [file: CursorFileContext];
  "file:closed": [path: string];
  "selection:change": [selection: CursorSelection, file: string];
  "cursor:move": [position: CursorPosition, file: string];
  "context:updated": [context: CursorIdeContext];
  "error": [error: Error];
}

/**
 * 文件观察器
 */
interface FileWatcher {
  path: string;
  context: CursorFileContext;
}

/**
 * IDE 集成工作流
 */
export class IdeResidentWorkflow extends EventEmitter<IdeWorkflowEvents> {
  protected adapter: CursorSdkAdapter;
  protected openFiles: Map<string, CursorFileContext> = new Map();
  protected currentSelection?: CursorSelection;
  protected currentCursor?: CursorPosition;
  protected watchers: Map<string, FileWatcher> = new Map();
  
  constructor(adapter: CursorSdkAdapter) {
    super();
    this.adapter = adapter;
    
    // Forward adapter events
    adapter.on("error", (err) => this.emit("error", err));
    adapter.on("stream", (event) => {
      // Handle stream events for file edits
      if (event.type === "edit" && event.edit) {
        this.emit("file:changed", {
          path: event.edit.path,
          content: event.edit.newContent,
          language: this.detectLanguage(event.edit.path),
          modified: true,
        });
      }
    });
  }
  
  // ============================================================================
  // Workflow Operations
  // ============================================================================
  
  /**
   * 启动工作流
   */
  async start(): Promise<void> {
    if (!this.adapter.isConnected()) {
      await this.adapter.connect();
    }
    
    // Initialize with current context
    const context = await this.adapter.getContext();
    if (context) {
      for (const file of context.openFiles) {
        this.openFile(file);
      }
      this.emit("context:updated", context);
    }
  }
  
  /**
   * 停止工作流
   */
  async stop(): Promise<void> {
    // Unwatch all files
    for (const [filePath] of this.watchers) {
      this.closeFile(filePath);
    }
    
    await this.adapter.disconnect();
  }
  
  // ============================================================================
  // File Management
  // ============================================================================
  
  /**
   * 打开文件
   */
  openFile(file: CursorFileContext): void {
    this.openFiles.set(file.path, file);
    
    // Watch file for changes
    if (existsSync(file.path)) {
      try {
        const watcher: FileWatcher = { path: file.path, context: file };
        watchFile(file.path, { interval: 100 }, () => {
          this.handleFileChange(file.path);
        });
        this.watchers.set(file.path, watcher);
      } catch (err) {
        // File watching might not work in all environments
      }
    }
    
    this.emit("file:opened", file);
  }
  
  /**
   * 关闭文件
   */
  closeFile(path: string): void {
    this.openFiles.delete(path);
    
    const watcher = this.watchers.get(path);
    if (watcher) {
      try {
        unwatchFile(path);
      } catch {
        // Ignore
      }
      this.watchers.delete(path);
    }
    
    this.emit("file:closed", path);
  }
  
  /**
   * 读取文件
   */
  readFile(path: string): CursorFileContext | null {
    if (this.openFiles.has(path)) {
      return this.openFiles.get(path)!;
    }
    
    if (!existsSync(path)) return null;
    
    try {
      const content = readFileSync(path, "utf-8");
      const file: CursorFileContext = {
        path,
        content,
        language: this.detectLanguage(path),
        modified: false,
      };
      
      return file;
    } catch {
      return null;
    }
  }
  
  /**
   * 更新选择
   */
  updateSelection(selection: CursorSelection, file: string): void {
    this.currentSelection = selection;
    
    const fileContext = this.openFiles.get(file);
    if (fileContext) {
      fileContext.selection = selection;
    }
    
    this.emit("selection:change", selection, file);
  }
  
  /**
   * 更新光标位置
   */
  updateCursor(position: CursorPosition, file: string): void {
    this.currentCursor = position;
    this.emit("cursor:move", position, file);
  }
  
  // ============================================================================
  // Context Management
  // ============================================================================
  
  /**
   * 获取当前上下文
   */
  async getCurrentContext(): Promise<CursorIdeContext | undefined> {
    const baseContext = await this.adapter.getContext();
    if (!baseContext) return undefined;
    
    return {
      ...baseContext,
      openFiles: Array.from(this.openFiles.values()),
      cursor: this.currentCursor,
      currentFile: this.openFiles.values().next().value,
    };
  }
  
  /**
   * 获取当前选区
   */
  getCurrentSelection(): CursorSelection | undefined {
    return this.currentSelection;
  }
  
  /**
   * 获取当前光标位置
   */
  getCurrentCursor(): CursorPosition | undefined {
    return this.currentCursor;
  }
  
  /**
   * 获取打开的文件列表
   */
  getOpenFiles(): CursorFileContext[] {
    return Array.from(this.openFiles.values());
  }
  
  // ============================================================================
  // Private
  // ============================================================================
  
  /**
   * 处理文件变更
   */
  private handleFileChange(path: string): void {
    const file = this.readFile(path);
    if (!file) return;
    
    file.modified = true;
    this.openFiles.set(path, file);
    this.emit("file:changed", file);
  }
  
  /**
   * 检测文件语言
   */
  private detectLanguage(path: string): string {
    const ext = path.split(".").pop()?.toLowerCase() || "";
    const langMap: Record<string, string> = {
      "ts": "typescript",
      "tsx": "typescript",
      "js": "javascript",
      "jsx": "javascript",
      "py": "python",
      "rb": "ruby",
      "rs": "rust",
      "go": "go",
      "java": "java",
      "cpp": "cpp",
      "c": "c",
      "cs": "csharp",
      "php": "php",
      "sh": "shell",
      "bash": "shell",
      "json": "json",
      "yaml": "yaml",
      "yml": "yaml",
      "md": "markdown",
      "html": "html",
      "css": "css",
      "scss": "scss",
      "sql": "sql",
    };
    
    return langMap[ext] || "plaintext";
  }
}

/**
 * 创建 IDE 工作流
 */
export function createIdeResidentWorkflow(adapter: CursorSdkAdapter): IdeResidentWorkflow {
  return new IdeResidentWorkflow(adapter);
}