# vscode-pair-prog

Real-time peer-to-peer pair programming on a shared workspace.

## Quick Start

### Host a Session

1. Open a workspace (e.g., a git repo)
2. Run command: **PairProg: Start Hosting Session** (`Ctrl+Shift+P`)
3. Optionally set a passphrase to protect the session
4. Copy the displayed address (e.g., `192.168.1.5:9876`)
5. Share the address with your partner

### Join a Session

1. Open a workspace with at least an empty folder. IMPORTANT: An empty workspace is not supported at the moment!
2. Run command: **PairProg: Join Session**
3. The extension scans your LAN for active sessions - select a discovered session or enter the host's address manually (e.g., `192.168.1.5:9876`)
4. Enter the passphrase if the session is protected
5. You're connected - edits sync in real-time. Wohooo!

## How It Works

```
┌──────────────┐     WebSocket (LAN)     ┌──────────────┐
│     HOST     │<----------------------->│    CLIENT    │
│              │                         │              │
│  Source of   │  <-- ShareDB OT  ---->  │  Edits sync  │
│  truth for   │  -- CursorUpdate <--->  │  via OT in   │
│  all files   │  -- ChatMessage  <--->  │  real-time   │
│              │  -- FileCreated ----->  │              │
│  Files saved │  -- FileDeleted ----->  │              │
│  to disk     │  -- FileRenamed ----->  │  No disk     │
│  HERE only   │  <-- FileSaveRequest    │  writes for  │
│              │  -- FileSaved  ------>  │  text edits  │
└──────────────┘                         └──────────────┘
```

## Configuration

| Setting                   | Default       | Description                          |
|---------------------------|---------------|--------------------------------------|
| `pairprog.port`             | `9876`        | WebSocket server port                |
| `pairprog.username`         | OS username   | Your display name                    |
| `pairprog.highlightColor`   | `#ec15ef`     | Remote partner's cursor color        |
| `pairprog.ignoredPatterns`  | see below     | Glob patterns to exclude from sync   |

Default ignored patterns:
```json
["**/node_modules/**", "**/.git/**", "*.lock", "**/out/**", "**/dist/**", "**/Library/**", "**/vendor/**"]
```

## Commands

| Command                            | Description                                                      |
|------------------------------------|------------------------------------------------------------------|
| `PairProg: Start Hosting Session`  | Start a WebSocket server and accept connections                  |
| `PairProg: Stop Hosting Session`   | Stop hosting and disconnect                                      |
| `PairProg: Join Session`           | Connect to a host (via LAN discovery or manual address)          |
| `PairProg: Leave Session`          | Disconnect from host                                             |
| `PairProg: Toggle Follow Mode`     | Follow your partner's cursor across files                        |
| `PairProg: Open Whiteboard`        | Open a collaborative whiteboard for sketching                    |
| `PairProg: Send Message`           | Send a chat message (`Ctrl+Shift+M` / `Cmd+Shift+M`)             |
| `PairProg: Share Terminal`         | Stream your terminal output to the client (host only)            |
| `PairProg: Stop Sharing Terminal`  | Stop streaming terminal output (host only)                       |
| `PairProg: About`                  | Show the about panel                                             |

Click the status bar item for a quick-pick menu with these options.

## Development

### Setup

```bash
cd vscode-pair-prog
npm install
npm run compile
```

### Debug / Run

1. Open this folder in VS Code
2. Press **F5** to launch the Extension Dev Host
3. In the new VS Code window, open a workspace folder


### Packaging

```bash
npm install -g @vscode/vsce
vsce package
```

This produces a `.vsix` file you can install in VS Code via:
**Extensions -> ⋯ -> Install from VSIX...**
