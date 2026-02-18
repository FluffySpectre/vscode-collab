import * as vscode from "vscode";
import {
  Message,
  MessageType,
  WhiteboardStrokePayload,
  createMessage,
} from "../network/protocol";

export class WhiteboardPanel {
  private panel: vscode.WebviewPanel;
  private sendFn: (msg: Message) => void;
  private _disposed = false;

  constructor(
    context: vscode.ExtensionContext,
    sendFn: (msg: Message) => void
  ) {
    this.sendFn = sendFn;

    this.panel = vscode.window.createWebviewPanel(
      "pairprogWhiteboard",
      "Pair Programming Whiteboard",
      vscode.ViewColumn.Beside,
      { enableScripts: true }
    );

    this.panel.webview.html = this.getHtml();

    this.panel.webview.onDidReceiveMessage((msg) => {
      if (msg.type === "stroke") {
        const payload: WhiteboardStrokePayload = msg.payload;
        this.sendFn(createMessage(MessageType.WhiteboardStroke, payload));
      }

      if (msg.type === "clear") {
        this.sendFn(createMessage(MessageType.WhiteboardClear, {}));
      }
    });

    this.panel.onDidDispose(() => {
      this._disposed = true;
    });
  }

  get disposed(): boolean {
    return this._disposed;
  }

  reveal() {
    this.panel.reveal(vscode.ViewColumn.Beside);
  }

  handleRemoteStroke(payload: WhiteboardStrokePayload) {
    this.panel.webview.postMessage({
      type: "stroke",
      payload,
    });
  }

  handleRemoteClear() {
    this.panel.webview.postMessage({ type: "clear" });
  }

  private getHtml(): string {
    return `
<!DOCTYPE html>
<html>
<head>
<style>
  html, body { margin: 0; padding: 0; overflow: hidden; width: 100%; height: 100%; background: var(--vscode-editor-background); }
  #board { position: fixed; top: 0; left: 0; width: 100%; height: 100%; cursor: crosshair; touch-action: none; }
  #toolbar { position: fixed; top: 8px; right: 8px; z-index: 10; display: flex; gap: 6px; align-items: center; }
  #toolbar button { padding: 4px 12px; cursor: pointer; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 3px; }
  #toolbar button:hover { background: var(--vscode-button-hoverBackground); }
  #colorPicker { width: 32px; height: 28px; cursor: pointer; border: none; padding: 0; border-radius: 3px; }
</style>
</head>
<body>
<div id="toolbar">
  <input type="color" id="colorPicker" value="#ffffff" title="Stroke color" />
  <button id="clearBtn">Clear</button>
</div>
<canvas id="board"></canvas>
<script>
const vscode = acquireVsCodeApi();
const canvas = document.getElementById("board");
const ctx = canvas.getContext("2d");
const colorPicker = document.getElementById("colorPicker");

function resize() {
  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  ctx.putImageData(imgData, 0, 0);
}
window.addEventListener("resize", resize);
resize();

let drawing = false;
let currentPoints = [];
let currentColor = "#ffffff";
let allStrokes = [];

colorPicker.addEventListener("input", e => {
  currentColor = e.target.value;
});

function finishStroke() {
  if (!drawing || currentPoints.length < 2) {
    drawing = false;
    currentPoints = [];
    return;
  }
  drawing = false;
  const stroke = { points: currentPoints, color: currentColor, width: 2 };
  allStrokes.push(stroke);
  vscode.postMessage({ type: "stroke", payload: stroke });
  currentPoints = [];
}

canvas.addEventListener("pointerdown", e => {
  canvas.setPointerCapture(e.pointerId);
  drawing = true;
  currentPoints = [{ x: e.offsetX, y: e.offsetY }];
});

canvas.addEventListener("pointermove", e => {
  if (!drawing) return;
  const prev = currentPoints[currentPoints.length - 1];
  const pt = { x: e.offsetX, y: e.offsetY };
  currentPoints.push(pt);
  ctx.strokeStyle = currentColor;
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(prev.x, prev.y);
  ctx.lineTo(pt.x, pt.y);
  ctx.stroke();
});

canvas.addEventListener("pointerup", finishStroke);
canvas.addEventListener("pointercancel", finishStroke);

document.getElementById("clearBtn").addEventListener("click", () => {
  allStrokes = [];
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  vscode.postMessage({ type: "clear" });
});

function drawStroke(points, color, width) {
  if (points.length < 2) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.stroke();
}

function redrawAll() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (const s of allStrokes) {
    drawStroke(s.points, s.color, s.width);
  }
}

window.addEventListener("message", event => {
  const msg = event.data;
  if (msg.type === "stroke") {
    allStrokes.push(msg.payload);
    drawStroke(msg.payload.points, msg.payload.color, msg.payload.width);
  }
  if (msg.type === "clear") {
    allStrokes = [];
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
});
</script>
</body>
</html>`;
  }
}
