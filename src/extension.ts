import * as vscode from "vscode";
import { HostSession } from "./session/hostSession";
import { ClientSession } from "./session/clientSession";
import { StatusBar } from "./ui/statusBar";

let hostSession: HostSession | null = null;
let clientSession: ClientSession | null = null;
let statusBar: StatusBar;

// Activate

export function activate(context: vscode.ExtensionContext) {
  console.log("[Collab] Extension activated");

  statusBar = new StatusBar();
  context.subscriptions.push(statusBar);

  // Start Hosting

  context.subscriptions.push(
    vscode.commands.registerCommand("collab.startSession", async () => {
      if (hostSession?.isActive) {
        vscode.window.showWarningMessage(
          "A hosting session is already active."
        );
        return;
      }

      if (clientSession?.isActive) {
        vscode.window.showWarningMessage(
          "You are currently connected as a client. Leave that session first."
        );
        return;
      }

      if (!vscode.workspace.workspaceFolders?.length) {
        vscode.window.showErrorMessage(
          "Open a workspace folder before starting a collaboration session."
        );
        return;
      }

      try {
        hostSession = new HostSession(statusBar);
        await hostSession.start();
      } catch (err: any) {
        vscode.window.showErrorMessage(
          `Failed to start session: ${err.message}`
        );
        hostSession?.dispose();
        hostSession = null;
      }
    })
  );

  // Stop Hosting

  context.subscriptions.push(
    vscode.commands.registerCommand("collab.stopSession", () => {
      if (!hostSession?.isActive) {
        vscode.window.showWarningMessage("No active hosting session to stop.");
        return;
      }

      hostSession.stop();
      hostSession = null;
    })
  );

  // Join Session

  context.subscriptions.push(
    vscode.commands.registerCommand("collab.joinSession", async () => {
      if (clientSession?.isActive) {
        vscode.window.showWarningMessage(
          "Already connected to a session. Leave it first."
        );
        return;
      }

      if (hostSession?.isActive) {
        vscode.window.showWarningMessage(
          "You are currently hosting a session. Stop it first."
        );
        return;
      }

      if (!vscode.workspace.workspaceFolders?.length) {
        vscode.window.showErrorMessage(
          "Open a workspace folder before joining a collaboration session."
        );
        return;
      }

      // Prompt for host address
      const address = await vscode.window.showInputBox({
        prompt: "Enter the host's address (e.g., 192.168.1.5:9876)",
        placeHolder: "192.168.1.5:9876",
        validateInput: (value) => {
          if (!value) { return "Address is required."; }
          const parts = value.split(":");
          if (parts.length !== 2 || isNaN(Number(parts[1]))) {
            return "Format: IP:PORT (e.g., 192.168.1.5:9876)";
          }
          return null;
        },
      });

      if (!address) {
        return; // User cancelled
      }

      try {
        clientSession = new ClientSession(statusBar);
        await clientSession.connect(address);
      } catch (err: any) {
        vscode.window.showErrorMessage(
          `Failed to connect: ${err.message}`
        );
        clientSession?.dispose();
        clientSession = null;
      }
    })
  );

  // Leave Session

  context.subscriptions.push(
    vscode.commands.registerCommand("collab.leaveSession", () => {
      if (!clientSession?.isActive) {
        vscode.window.showWarningMessage("No active session to leave.");
        return;
      }

      clientSession.disconnect();
      clientSession = null;
    })
  );

  // Status Bar Click

  context.subscriptions.push(
    vscode.commands.registerCommand("collab.statusBarClicked", async () => {
      const items: vscode.QuickPickItem[] = [];

      if (hostSession?.isActive) {
        items.push(
          { label: "$(copy) Copy Session Address", description: statusBar.getAddress() },
          { label: "$(debug-stop) Stop Hosting", description: "" }
        );
      } else if (clientSession?.isActive) {
        items.push(
          { label: "$(debug-disconnect) Disconnect", description: "" }
        );
      } else {
        items.push(
          { label: "$(broadcast) Start Hosting", description: "" },
          { label: "$(plug) Join Session", description: "" }
        );
      }

      const picked = await vscode.window.showQuickPick(items, {
        placeHolder: "Collaboration Session",
      });

      if (!picked) { return; }

      if (picked.label.includes("Copy Session Address")) {
        await vscode.env.clipboard.writeText(statusBar.getAddress());
        vscode.window.showInformationMessage("Session address copied!");
      } else if (picked.label.includes("Stop Hosting")) {
        vscode.commands.executeCommand("collab.stopSession");
      } else if (picked.label.includes("Disconnect")) {
        vscode.commands.executeCommand("collab.leaveSession");
      } else if (picked.label.includes("Start Hosting")) {
        vscode.commands.executeCommand("collab.startSession");
      } else if (picked.label.includes("Join Session")) {
        vscode.commands.executeCommand("collab.joinSession");
      }
    })
  );
}

// Deactivate

export function deactivate() {
  hostSession?.dispose();
  hostSession = null;

  clientSession?.dispose();
  clientSession = null;

  statusBar?.dispose();
}
