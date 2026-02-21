import {
  Message,
  MessageType,
  WhiteboardEntityAddPayload,
  WhiteboardEntityUpdatePayload,
  WhiteboardEntityDeletePayload,
  WhiteboardFullSyncPayload,
  createMessage,
} from "../../network/protocol";
import { WhiteboardPanel } from "./whiteboardPanel";
import { Feature, FeatureContext, FeatureCommand } from "../feature";

export class WhiteboardFeature implements Feature {
  readonly id = "whiteboard";
  readonly messageTypes = [
    MessageType.WhiteboardEntityAdd as string,
    MessageType.WhiteboardEntityUpdate as string,
    MessageType.WhiteboardEntityDelete as string,
    MessageType.WhiteboardFullSync as string,
    MessageType.WhiteboardClear as string,
  ];

  private context?: FeatureContext;
  private panel?: WhiteboardPanel;

  activate(context: FeatureContext): void {
    this.context = context;
    // If host reconnects and panel already has entities, send full sync to new client
    if (context.role === "host" && this.panel && !this.panel.disposed) {
      const entities = this.panel.getEntities();
      if (entities.length > 0) {
        context.sendFn(createMessage(MessageType.WhiteboardFullSync, { entities }));
      }
    }
  }

  handleMessage(msg: Message): void {
    switch (msg.type) {
      case MessageType.WhiteboardEntityAdd:
        this.ensurePanel();
        this.panel?.handleRemoteEntityAdd(msg.payload as WhiteboardEntityAddPayload);
        break;

      case MessageType.WhiteboardEntityUpdate:
        this.ensurePanel();
        this.panel?.handleRemoteEntityUpdate(msg.payload as WhiteboardEntityUpdatePayload);
        break;

      case MessageType.WhiteboardEntityDelete:
        this.ensurePanel();
        this.panel?.handleRemoteEntityDelete(msg.payload as WhiteboardEntityDeletePayload);
        break;

      case MessageType.WhiteboardFullSync:
        this.ensurePanel();
        this.panel?.handleRemoteFullSync(msg.payload as WhiteboardFullSyncPayload);
        break;

      case MessageType.WhiteboardClear:
        this.panel?.handleRemoteClear();
        break;
    }
  }

  getCommands(): FeatureCommand[] {
    return [
      {
        commandId: "pairprog.openWhiteboard",
        label: "Open Whiteboard",
        icon: "edit",
        roles: ["host", "client"],
        execute: () => this.openWhiteboard(),
      },
    ];
  }

  deactivate(): void {
    // Panel can survive reconnects; don't dispose it here.
    this.context = undefined;
  }

  dispose(): void {
    this.panel = undefined;
    this.context = undefined;
  }

  // --- internal ---

  private ensurePanel(): void {
    if (!this.context) { return; }
    if (!this.panel || this.panel.disposed) {
      this.panel = new WhiteboardPanel(
        this.context.extensionContext,
        this.context.sendFn
      );
    }
  }

  private openWhiteboard(): void {
    this.ensurePanel();
    if (this.panel && !this.panel.disposed) {
      this.panel.reveal();
    }
  }
}
