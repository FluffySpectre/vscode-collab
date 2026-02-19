import * as vscode from "vscode";
import {
  Message,
  MessageType,
  FileSaveRequestPayload,
  FileSavedPayload,
  createMessage,
} from "../network/protocol";

/**
 * DocumentSync handles file save delegation.
 *
 * - Client: intercepts saves and delegates to host via existing WebSocket protocol
 * - Host: handles FileSaveRequest (saves to disk, responds with FileSaved)
 */
export class DocumentSync implements vscode.Disposable {
  private disposables: vscode.Disposable[] = [];
  private sendFn: (msg: Message) => void;
  private isHost: boolean;
  private workspaceRoot: string;

  constructor(
    sendFn: (msg: Message) => void,
    isHost: boolean,
    workspaceRoot: string
  ) {
    this.sendFn = sendFn;
    this.isHost = isHost;
    this.workspaceRoot = workspaceRoot;
  }

  activate(): void {
    // Client: intercept save and forward to host
    if (!this.isHost) {
      this.disposables.push(
        vscode.workspace.onWillSaveTextDocument((e) => {
          if (e.document.uri.scheme !== "file") {
            return;
          }
          const filePath = this.toRelativePath(e.document.uri);
          if (!filePath) {
            return;
          }

          // Suppress the local save and ask the host to save instead
          e.waitUntil(
            Promise.resolve().then(() => {
              this.sendFn(
                createMessage(MessageType.FileSaveRequest, {
                  filePath,
                } as FileSaveRequestPayload)
              );
              return [];
            })
          );
        })
      );
    }
  }

  // Host: client requested a file save

  async handleFileSaveRequest(payload: FileSaveRequestPayload): Promise<void> {
    const uri = this.toAbsoluteUri(payload.filePath);
    try {
      const doc = await vscode.workspace.openTextDocument(uri);
      await doc.save();
      this.sendFn(
        createMessage(MessageType.FileSaved, {
          filePath: payload.filePath,
        } as FileSavedPayload)
      );
    } catch {
      // If save fails, silently ignore - client will keep dirty state
    }
  }

  // Client: host confirmed the file was saved

  async handleFileSaved(payload: FileSavedPayload): Promise<void> {
    const uri = this.toAbsoluteUri(payload.filePath);
    try {
      await vscode.commands.executeCommand("workbench.action.files.revert", uri);
    } catch {
      // Ignore if revert fails
    }
  }

  // Path Utilities

  private toRelativePath(uri: vscode.Uri): string | null {
    const wsFolder = vscode.workspace.workspaceFolders?.[0];
    if (!wsFolder) {
      return null;
    }

    const rootPath = wsFolder.uri.fsPath;
    const filePath = uri.fsPath;

    if (!filePath.startsWith(rootPath)) {
      return null;
    }

    return filePath.slice(rootPath.length + 1).replace(/\\/g, "/");
  }

  toAbsoluteUri(relativePath: string): vscode.Uri {
    const wsFolder = vscode.workspace.workspaceFolders![0];
    return vscode.Uri.joinPath(wsFolder.uri, relativePath);
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
  }
}
