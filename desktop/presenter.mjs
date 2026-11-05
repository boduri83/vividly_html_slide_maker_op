import path from "node:path";
import { fileURLToPath } from "node:url";

function checked(input) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("발표자 상태가 필요합니다.");
  const keys = [
    "title",
    "slideName",
    "notes",
    "index",
    "total",
    "step",
    "canNext",
    "canPrevious",
    "nextTitle",
  ];
  if (Object.keys(input).some((key) => !keys.includes(key)))
    throw new Error("지원하지 않는 발표자 상태입니다.");
  for (const key of ["title", "slideName", "notes", "nextTitle"])
    if (typeof input[key] !== "string" || input[key].length > 65536)
      throw new Error("발표자 텍스트가 잘못되었습니다.");
  for (const key of ["index", "total", "step"])
    if (!Number.isSafeInteger(input[key]) || input[key] < 0)
      throw new Error("발표자 장 번호가 잘못되었습니다.");
  if (
    !input.total ||
    input.index >= input.total ||
    typeof input.canNext !== "boolean" ||
    typeof input.canPrevious !== "boolean"
  )
    throw new Error("발표자 이동 상태가 잘못되었습니다.");
  return { ...input };
}
const HTML = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'none'; base-uri 'none'; form-action 'none'"><title>Vividly · 발표자 화면</title><style>*{box-sizing:border-box}body{margin:0;background:#101a2e;color:#eef3ff;font:15px 'Malgun Gothic',sans-serif;padding:28px}header{display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #33435e;padding-bottom:18px}h1{font-size:17px;margin:0}#timer{font-size:28px;font-variant-numeric:tabular-nums;color:#9eb5ff}#title{color:#9eb0cb;font-size:12px;margin-top:5px}.counter{margin:22px 0 9px;color:#9eb5ff;font-size:13px}h2{font-size:25px;margin:0 0 20px}#notes{background:#1b2940;border:1px solid #344661;border-radius:14px;white-space:pre-wrap;overflow-wrap:anywhere;padding:24px;min-height:240px;max-height:55vh;overflow:auto;line-height:1.75}footer{display:flex;gap:9px;align-items:center;margin-top:20px}button{background:#304568;border:1px solid #58719b;border-radius:8px;color:white;font:inherit;padding:9px 14px;cursor:pointer}button:disabled{opacity:.4}button:focus-visible{outline:3px solid #a0b8ff}#next{background:#5367f7}#next-title{margin-top:15px;color:#9eb0cb;font-size:12px}#end{margin-left:auto}</style></head><body><header><div><h1>Vividly · 발표자 화면</h1><div id="title"></div></div><div><span id="timer">00:00</span> <button id="reset-timer">초기화</button></div></header><div class="counter"><span id="counter"></span> · 클릭 단계 <span id="step"></span></div><h2 id="slide-name"></h2><section id="notes" aria-label="현재 슬라이드 발표 메모"></section><div id="next-title"></div><footer><button id="previous">← 이전</button><button id="next">다음 →</button><button id="end">발표 마치기</button></footer></body></html>`;

export class PresenterService {
  constructor({ BrowserWindow, onCommand }) {
    this.BrowserWindow = BrowserWindow;
    this.onCommand = onCommand;
    this.window = null;
    this.state = null;
    this.url = "data:text/html;charset=utf-8," + encodeURIComponent(HTML);
  }
  async open(value) {
    this.state = checked(value);
    if (this.window && !this.window.isDestroyed()) {
      this.window.show();
      this.window.focus();
      this.send();
      return { opened: true };
    }
    const win = new this.BrowserWindow({
      title: "Vividly · 발표자 화면",
      width: 820,
      height: 720,
      minWidth: 620,
      minHeight: 520,
      show: false,
      backgroundColor: "#101a2e",
      webPreferences: {
        preload: path.join(
          path.dirname(fileURLToPath(import.meta.url)),
          "presenter-preload.cjs",
        ),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        spellcheck: false,
      },
    });
    this.window = win;
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.webContents.on("will-navigate", (event) => event.preventDefault());
    win.on("closed", () => {
      if (this.window === win) this.window = null;
    });
    await win.loadURL(this.url);
    if (!win.isDestroyed()) {
      this.send();
      win.show();
      win.focus();
    }
    return { opened: true };
  }
  update(value) {
    this.state = checked(value);
    this.send();
    return { updated: Boolean(this.window && !this.window.isDestroyed()) };
  }
  send() {
    if (this.window && !this.window.isDestroyed() && this.state)
      this.window.webContents.send("presenter:state", this.state);
  }
  accept(event, command) {
    if (
      !this.window ||
      this.window.isDestroyed() ||
      event.sender !== this.window.webContents ||
      event.senderFrame !== this.window.webContents.mainFrame ||
      event.senderFrame.url !== this.url ||
      !["next", "previous", "end"].includes(command)
    )
      return false;
    this.onCommand(command);
    return true;
  }
  close() {
    const win = this.window;
    this.window = null;
    if (win && !win.isDestroyed()) win.destroy();
    return { closed: true };
  }
}
