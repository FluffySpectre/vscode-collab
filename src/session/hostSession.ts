import * as vscode from "vscode";
import { PairProgServer } from "../network/server";
import { ShareDBServer } from "../network/sharedbServer";
import { BeaconBroadcaster } from "../network/beacon";
import {
  Message,
  MessageType,
  HelloPayload,
  WelcomePayload,
  CursorUpdatePayload,
  FollowUpdatePayload,
  FileSaveRequestPayload,
  createMessage,
  WhiteboardStrokePayload,
  ChatMessagePayload,
} from "../network/protocol";
import { DocumentSync } from "../sync/documentSync";
import { ShareDBBridge } from "../sync/sharedbBridge";
import { CursorSync } from "../sync/cursorSync";
import { FileOpsSync } from "../sync/fileOpsSync";
import { StatusBar } from "../ui/statusBar";
import { WhiteboardPanel } from "../ui/whiteboardPanel";

/**
 * HostSession manages the entire host-side lifecycle:
 *  1. Starts the WebSocket server
 *  2. Waits for a client to connect
 *  3. Performs initial sync (sends open file contents)
 *  4. Relays edits, cursors, and file operations
 */
export class HostSession implements vscode.Disposable {
  private server: PairProgServer;
  private sharedbServer: ShareDBServer | null = null;
  private sharedbBridge: ShareDBBridge | null = null;
  private documentSync: DocumentSync | null = null;
  private cursorSync: CursorSync | null = null;
  private fileOpsSync: FileOpsSync | null = null;
  private statusBar: StatusBar;
  private whiteboard?: WhiteboardPanel;
  private disposables: vscode.Disposable[] = [];

  private username: string;
  private address: string = "";
  private clientUsername: string = "";
  private broadcaster: BeaconBroadcaster | null = null;
  private isStopping = false;
  private _sendFn?: (msg: Message) => void;
  private _context: vscode.ExtensionContext;

  constructor(statusBar: StatusBar, context: vscode.ExtensionContext) {
    this.statusBar = statusBar;
    this._context = context;
    this.server = new PairProgServer();

    const config = vscode.workspace.getConfiguration("pairprog");
    this.username = config.get<string>("username") || this.getDefaultUsername();
  }

  // Start

  async start(): Promise<void> {
    const config = vscode.workspace.getConfiguration("pairprog");
    const port = config.get<number>("port") || 9876;

    // Start the server
    this.address = await this.server.start(port);
    this.sharedbServer = new ShareDBServer(this.server);
    this.statusBar.setHosting(this.address);

    const wsFolder = vscode.workspace.workspaceFolders?.[0];
    this.broadcaster = new BeaconBroadcaster({
      name: this.username,
      address: this.address,
      workspaceFolder: wsFolder?.name ?? "workspace",
    });
    this.broadcaster.on("error", (err: Error) => {
      console.warn("[PairProg Host] Beacon error:", err.message);
    });
    this.broadcaster.start();

    vscode.window.showInformationMessage(
      `Pair Programming session started on ${this.address}`,
      "Copy Address"
    ).then((action) => {
      if (action === "Copy Address") {
        vscode.env.clipboard.writeText(this.address);
      }
    });

    // Handle client connection
    this.server.on("clientConnected", (hello: HelloPayload) => {
      this.onClientConnected(hello);
    });

    this.server.on("clientDisconnected", () => {
      this.onClientDisconnected();
    });

    this.server.on("message", (msg: Message) => {
      this.onMessage(msg);
    });

    this.server.on("error", (err: Error) => {
      console.error("[Pair Prog Host] Error:", err.message);
    });
  }

  // Stop

  stop(): void {
    this.isStopping = true;
    this.teardownSync();
    this.sharedbServer?.stop();
    this.sharedbServer = null;
    this.broadcaster?.stop();
    this.broadcaster = null;
    this.server.stop();
    this.statusBar.setDisconnected();
    vscode.window.showInformationMessage("Pair Programming session stopped.");
  }

  // Client Connected

  private async onClientConnected(hello: HelloPayload): Promise<void> {
    this.clientUsername = hello.username || "Anonymous";

    // Validate workspace compatibility
    const wsFolder = vscode.workspace.workspaceFolders?.[0];
    if (!wsFolder) {
      this.server.send(
        createMessage(MessageType.Error, {
          message: "Host has no workspace open.",
        })
      );
      return;
    }

    const hostFolderName = wsFolder.name;
    if (hello.workspaceFolder !== hostFolderName) {
      vscode.window.showWarningMessage(
        `Client workspace "${hello.workspaceFolder}" differs from host "${hostFolderName}". Proceeding anyway.`
      );
    }

    // Update status bar
    this.statusBar.setHostConnected(this.address, this.clientUsername);
    vscode.window.showInformationMessage(
      `${this.clientUsername} connected to your session.`
    );

    // Setup sync components
    this.setupSync();

    // Send Welcome
    const openFiles = this.getOpenTextFiles();
    const welcome: WelcomePayload = {
      hostUsername: this.username,
      openFiles,
    };
    this.server.send(createMessage(MessageType.Welcome, welcome));

    // Ensure ShareDB docs exist for all open files
    for (const filePath of openFiles) {
      try {
        const uri = this.sharedbBridge!.toAbsoluteUri(filePath);
        const doc = await vscode.workspace.openTextDocument(uri);
        await this.sharedbBridge!.ensureDoc(filePath, doc.getText());
      } catch {
        // Skip files that can't be read
      }
    }

    // Send initial cursor position
    this.cursorSync!.sendCurrentCursor();
  }

  // Client Disconnected

  private onClientDisconnected(): void {
    if (this.isStopping) {
      return; // stop() handles cleanup and status bar
    }
    this.teardownSync();
    this.statusBar.setHosting(this.address);
    vscode.window.showInformationMessage(
      `${this.clientUsername || "Client"} disconnected.`
    );
    this.clientUsername = "";
  }

  // Message Router

  private async onMessage(msg: Message): Promise<void> {
    switch (msg.type) {
      case MessageType.CursorUpdate:
        if (this.cursorSync) {
          this.cursorSync.handleRemoteCursorUpdate(
            msg.payload as CursorUpdatePayload
          );
        }
        break;

      case MessageType.FollowUpdate:
        if (this.cursorSync) {
          this.cursorSync.handleRemoteFollowUpdate(
            msg.payload as FollowUpdatePayload
          );
        }
        break;

      case MessageType.FileSaveRequest:
        if (this.documentSync) {
          await this.documentSync.handleFileSaveRequest(
            msg.payload as FileSaveRequestPayload
          );
        }
        break;
      
      case MessageType.WhiteboardStroke:
        this.ensureWhiteboard(this._context);
        if (this.whiteboard && !this.whiteboard.disposed) {
          this.whiteboard.handleRemoteStroke(
            msg.payload as WhiteboardStrokePayload
          );
        }
        break;

      case MessageType.WhiteboardClear:
        if (this.whiteboard && !this.whiteboard.disposed) {
          this.whiteboard.handleRemoteClear();
        }
        break;

      case MessageType.ChatMessage: {
        const payload = msg.payload as ChatMessagePayload;
        const text = payload.text ?? "";
        const sender = payload.username || this.clientUsername || "Client";
        const urlMatch = text.match(/https?:\/\/[^\s]+/);
        const buttons: string[] = urlMatch ? ["Open Link", "Copy", "Reply"] : ["Copy", "Reply"];
        vscode.window.showInformationMessage(
          `${sender}: ${text}`,
          ...buttons
        ).then(async (action) => {
          if (action === "Open Link" && urlMatch) {
            await vscode.env.openExternal(vscode.Uri.parse(urlMatch[0]));
          } else if (action === "Copy") {
            await vscode.env.clipboard.writeText(text);
          } else if (action === "Reply") {
            await this.sendMessage();
          }
        });
        break;
      }

      default:
        break;
    }
  }

  // Sync Setup / Teardown

  private setupSync(): void {
    const wsFolder = vscode.workspace.workspaceFolders![0];
    const config = vscode.workspace.getConfiguration("pairprog");
    const color = config.get<string>("highlightColor") || "#ec15ef";
    const ignored = config.get<string[]>("ignoredPatterns") || [];

    const sendFn = (msg: Message) => this.server.send(msg);

    const sharedbConnection = this.sharedbServer!.getHostConnection();
    this.sharedbBridge = new ShareDBBridge(wsFolder.uri.fsPath, sharedbConnection);
    this.sharedbBridge.activate();

    this.documentSync = new DocumentSync(sendFn, true, wsFolder.uri.fsPath);
    this.documentSync.activate();

    this.cursorSync = new CursorSync(sendFn, this.username, color);
    this.cursorSync.activate();

    this.cursorSync.onDidChangeFollowMode((following) => {
      this.statusBar.setFollowing(following);
    });

    this.fileOpsSync = new FileOpsSync(
      sendFn,
      true,
      wsFolder.uri.fsPath,
      ignored
    );
    this.fileOpsSync.activate();

    this._sendFn = sendFn;
  }

  private teardownSync(): void {
    this.documentSync?.dispose();
    this.documentSync = null;

    this.sharedbBridge?.dispose();
    this.sharedbBridge = null;

    this.cursorSync?.dispose();
    this.cursorSync = null;

    this.fileOpsSync?.dispose();
    this.fileOpsSync = null;
  }

  // Utilities

  private getOpenTextFiles(): string[] {
    const wsFolder = vscode.workspace.workspaceFolders?.[0];
    if (!wsFolder) { return []; }

    const rootPath = wsFolder.uri.fsPath;
    const files: string[] = [];

    for (const doc of vscode.workspace.textDocuments) {
      if (doc.uri.scheme !== "file") { continue; }
      if (!doc.uri.fsPath.startsWith(rootPath)) { continue; }
      if (doc.isClosed) { continue; }

      const relativePath = doc.uri.fsPath
        .slice(rootPath.length + 1)
        .replace(/\\/g, "/");
      files.push(relativePath);
    }

    return files;
  }

  private getDefaultUsername(): string {
    return require("os").userInfo().username || "Host";
  }

  toggleFollowMode(): void {
    if (!this.cursorSync) { return; }
    this.cursorSync.toggleFollow();
  }

  private ensureWhiteboard(context: vscode.ExtensionContext) {
    if (!this._sendFn) { return; }
    if (!this.whiteboard || this.whiteboard.disposed) {
      this.whiteboard = new WhiteboardPanel(context, this._sendFn);
    }
  }

  openWhiteboard() {
    this.ensureWhiteboard(this._context);
    if (this.whiteboard && !this.whiteboard.disposed) {
      this.whiteboard.reveal();
    }
  }

  async sendMessage(): Promise<void> {
    if (!this._sendFn) {
      vscode.window.showWarningMessage("No client connected yet.");
      return;
    }
    const text = await vscode.window.showInputBox({
      prompt: `Send a message to ${this.clientUsername || "client"}`,
      placeHolder: "Type a message, link, or code snippet...",
      validateInput: (value) => {
        if (!value || value.trim().length === 0) { return "Message cannot be empty."; }
        if (value.length > 500) { return `Too long (${value.length}/500 chars).`; }
        return null;
      },
    });
    if (!text || text.trim().length === 0) { return; }
    this._sendFn(createMessage(MessageType.ChatMessage, { text: text.trim(), username: this.username } as ChatMessagePayload));
  }

  get isActive(): boolean {
    return this.server.isRunning;
  }

  // Dispose

  dispose(): void {
    this.stop();
    this.disposables.forEach((d) => d.dispose());
  }
}
