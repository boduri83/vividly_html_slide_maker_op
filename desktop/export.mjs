import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID, createHash } from "node:crypto";
import { normalizeDocument } from "../src/model.js";
import {
  validateAssetBytes,
  exportPresentation,
  createStaticExport,
} from "../src/format.js";
import { normalizeOutputState } from "../src/business-render.js";
import { diagnoseDocument } from "../src/business-model.js";

const MAX_BYTES = 100 * 1024 * 1024;
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const validBoolean = (value, label) => {
  if (value !== undefined && typeof value !== "boolean")
    throw new Error(`${label} 설정이 올바르지 않습니다.`);
};
const stem = (title) =>
  String(title || "Vividly")
    .slice(0, 100)
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/[. ]+$/g, "")
    .trim() || "Vividly";

/** Only task-owned sibling files are replaced; an existing chosen output survives a failure. */
export async function atomicWriteOutput(destination, bytes, { io = fs } = {}) {
  if (!path.isAbsolute(destination) || !Buffer.isBuffer(bytes))
    throw new Error("출력 대상이 올바르지 않습니다.");
  const temporary = path.join(
    path.dirname(destination),
    `.vividly-output-${randomUUID()}.tmp`,
  );
  let handle,
    created = false;
  try {
    handle = await io.open(temporary, "wx");
    created = true;
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = null;
    await io.rename(temporary, destination);
    created = false;
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    if (created)
      await io.unlink(temporary).catch((cleanup) => {
        if (cleanup.code !== "ENOENT") error.cleanupError = cleanup.message;
      });
    throw error;
  }
}

function outputOptions(request, { preview = false } = {}) {
  if (
    !request ||
    typeof request !== "object" ||
    Array.isArray(request) ||
    Object.keys(request).some(
      (key) =>
        ![
          "document",
          "slideIds",
          "scene",
          "state",
          "includeNotes",
          "allowFontFallback",
          "format",
        ].includes(key),
    )
  )
    throw new Error("출력 요청이 올바르지 않습니다.");
  validBoolean(request.includeNotes, "노트 포함");
  validBoolean(request.allowFontFallback, "대체 글꼴");
  const format = request.format ?? "pdf";
  if (!["pdf", "png", "html"].includes(format))
    throw new Error("PDF·PNG·HTML 출력만 지원합니다.");
  if (Buffer.byteLength(JSON.stringify(request.document) || "") > MAX_BYTES)
    throw new Error("100MB 이하 문서만 출력할 수 있습니다.");
  const document = normalizeDocument(request.document),
    plan = createStaticExport(document, {
      slideIds: request.slideIds,
      scene: request.scene ?? "complete",
      state: request.state ?? {},
      includeNotes: request.includeNotes ?? false,
    });
  if (preview && plan.slideIds.length > 24)
    throw new Error("미리보기는 한 번에 24장까지 선택하세요.");
  return {
    document,
    plan,
    format,
    allowFontFallback: request.allowFontFallback === true,
  };
}

function publishedDocument(document, plan) {
  const result = JSON.parse(JSON.stringify(document)),
    selected = new Set(plan.slideIds),
    state = normalizeOutputState(result, plan.state),
    shown = new Set(state.shownIds),
    open = new Set(state.openPanels);
  if (result.variables)
    for (const variable of result.variables)
      variable.initialValue = state.variables[variable.id];
  result.slides = plan.slideIds.map((id) =>
    result.slides.find((s) => s.id === id),
  );
  let dropped = 0;
  for (const slide of result.slides) {
    if (!plan.includeNotes) delete slide.notes;
    for (const e of slide.elements) {
      if (e.component?.kind === "panel")
        e.component.initiallyOpen = open.has(e.id);
      if (shown.has(e.id)) e.initiallyHidden = false;
    }
    if (slide.interactions)
      slide.interactions = slide.interactions.flatMap((rule) => {
        const actions = rule.actions.filter((a) => {
          const keep = a.type !== "goToSlide" || selected.has(a.targetId);
          if (!keep) dropped++;
          return keep;
        });
        return actions.length ? [{ ...rule, actions }] : [];
      });
  }
  const assets = new Set(), variables = new Set();
  for (const slide of result.slides) {
    for (const element of slide.elements) {
      if (element.assetId) assets.add(element.assetId);
      for (const id of [element.component?.variableId, element.binding?.variableId, element.chart?.variants?.variableId])
        if (id) variables.add(id);
    }
    for (const rule of slide.interactions || []) {
      if (rule.condition?.variableId) variables.add(rule.condition.variableId);
      for (const action of rule.actions)
        if (action.type === "setVariable") variables.add(action.variableId);
    }
  }
  result.assets = result.assets.filter((asset) => assets.has(asset.id));
  if (result.variables)
    result.variables = result.variables.filter((variable) => variables.has(variable.id));
  return { document: result, dropped };
}

/** Trusted main-process output authority: only author data enters, paths come from native dialogs. */
export class DesktopExportService {
  constructor({
    BrowserWindow,
    dialog,
    getWindow = () => undefined,
    io = fs,
  } = {}) {
    if (typeof BrowserWindow !== "function" || !dialog)
      throw new TypeError("출력 창과 기본 파일 선택 도구가 필요합니다.");
    this.BrowserWindow = BrowserWindow;
    this.dialog = dialog;
    this.getWindow = getWindow;
    this.io = io;
    this.pending = 0;
    this.queue = Promise.resolve();
  }
  get busy() {
    return this.pending > 0;
  }
  async job(fn) {
    this.pending++;
    const work = this.queue.catch(() => {}).then(fn);
    this.queue = work;
    try {
      return await work;
    } finally {
      this.pending--;
      if (this.queue === work) this.queue = Promise.resolve();
    }
  }
  async preview(request) {
    return this.job(async () => {
      const { document, plan } = outputOptions(request, { preview: true });
      await validateAssetBytes(document);
      const rendered = await this.render(document, plan, { png: true });
      return {
        pages: rendered.images.map((bytes, index) => ({
          slideId: plan.slideIds[index],
          width: plan.width,
          height: plan.height,
          dataUrl: `data:image/png;base64,${bytes.toString("base64")}`,
        })),
        diagnostics: rendered.diagnostics,
        scene: plan.scene,
        includeNotes: plan.includeNotes,
        state: plan.state,
      };
    });
  }
  async export(request) {
    return this.job(async () => {
      const { document, plan, format, allowFontFallback } =
        outputOptions(request);
      await validateAssetBytes(document);
      const rendered = await this.render(document, plan, {
        png: format === "png",
        pdf: format === "pdf",
      });
      const missing = rendered.diagnostics.filter(
        (issue) => issue.code === "OUTPUT_FONT_MISSING",
      );
      if (missing.length && !allowFontFallback)
        throw new Error(
          `설치 여부를 확인하지 못한 글꼴이 있습니다: ${missing.map((issue) => issue.fontFamily).join(", ")}. 미리보기를 확인하고 대체 글꼴 허용을 선택하거나 글꼴을 바꿔 주세요.`,
        );
      const diagnostics = [...rendered.diagnostics],
        files = [];
      if (format === "png") {
        const selection = await this.dialog.showOpenDialog(this.getWindow(), {
          title: "PNG를 저장할 폴더 선택",
          properties: ["openDirectory", "createDirectory"],
        });
        if (selection.canceled || !selection.filePaths?.[0])
          return { canceled: true };
        const parent = path.resolve(selection.filePaths[0]),
          folder = path.join(
            parent,
            `${stem(document.title)}-${randomUUID().slice(0, 8)}`,
          );
        if (path.dirname(folder) !== parent)
          throw new Error("출력 폴더가 올바르지 않습니다.");
        await this.io.mkdir(folder);
        const created = [];
        try {
          for (let index = 0; index < rendered.images.length; index++) {
            const name = `slide-${String(index + 1).padStart(3, "0")}.png`,
              filePath = path.join(folder, name),
              bytes = rendered.images[index],
              handle = await this.io.open(filePath, "wx");
            created.push(filePath);
            try {
              await handle.writeFile(bytes);
              await handle.sync();
            } finally {
              await handle.close();
            }
            files.push({
              name,
              path: filePath,
              slideId: plan.slideIds[index],
              width: plan.width,
              height: plan.height,
              bytes: bytes.length,
              sha256: hash(bytes),
            });
          }
        } catch (error) {
          for (const file of created)
            await this.io.unlink(file).catch(() => {});
          await this.io.rmdir(folder).catch(() => {});
          throw error;
        }
      } else {
        const selection = await this.dialog.showSaveDialog(this.getWindow(), {
          title: format === "pdf" ? "PDF로 내보내기" : "공개용 HTML로 내보내기",
          defaultPath: `${stem(document.title)}.${format}`,
          filters: [{ name: format.toUpperCase(), extensions: [format] }],
        });
        if (selection.canceled || !selection.filePath)
          return { canceled: true };
        const destination = path.resolve(selection.filePath);
        let bytes = rendered.pdf;
        if (format === "html") {
          const published = publishedDocument(document, plan);
          bytes = Buffer.from(
            exportPresentation(published.document, {
              includeNotes: plan.includeNotes,
            }),
            "utf8",
          );
          if (published.dropped)
            diagnostics.push({
              code: "OUTPUT_SLIDE_LINK_REMOVED",
              severity: "info",
              message: `선택하지 않은 장으로 가는 연결 ${published.dropped}개를 공개 복사본에서 제외했습니다.`,
            });
        }
        await atomicWriteOutput(destination, bytes, { io: this.io });
        files.push({
          name: path.basename(destination),
          path: destination,
          bytes: bytes.length,
          sha256: hash(bytes),
        });
      }
      return {
        canceled: false,
        files,
        pageCount: plan.slideIds.length,
        slideIds: plan.slideIds,
        format,
        scene: plan.scene,
        includeNotes: plan.includeNotes,
        diagnostics,
      };
    });
  }
  async write(request) {
    return this.export(request);
  }
  async render(document, plan, { png = false, pdf = false } = {}) {
    const folder = await fs.mkdtemp(
        path.join(os.tmpdir(), "vividly-static-output-"),
      ),
      file = path.join(folder, "document.html"),
      url = pathToFileURL(file).href;
    let window;
    const images = [];
    let bytes = 0;
    try {
      await fs.writeFile(file, plan.html, { flag: "wx" });
      window = new this.BrowserWindow({
        show: false,
        width: Math.ceil(plan.width),
        height: Math.ceil(plan.height),
        useContentSize: true,
        paintWhenInitiallyHidden: true,
        backgroundColor: "#ffffff",
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          webSecurity: true,
          javascript: true,
          backgroundThrottling: false,
          partition: `vividly-output-${randomUUID()}`,
        },
      });
      window.webContents.setWindowOpenHandler?.(() => ({ action: "deny" }));
      window.webContents.on?.("will-navigate", (event, target) => {
        if (target !== url) event.preventDefault();
      });
      window.webContents.on?.("will-attach-webview", (event) =>
        event.preventDefault(),
      );
      window.webContents.session?.webRequest?.onBeforeRequest?.(
        (details, callback) =>
          callback({
            cancel: details.url !== url && !details.url.startsWith("data:"),
          }),
      );
      await window.loadFile(file);
      window.webContents.setZoomFactor?.(1);
      const families = [
        ...new Set(
          [
            document.theme?.fontFamily || "Malgun Gothic",
            document.theme?.headingFontFamily,
            ...document.slides.flatMap((s) =>
              s.elements.map((e) => e.text?.textStyle?.fontFamily),
            ),
          ].filter(Boolean),
        ),
      ];
      const inspected = await window.webContents.executeJavaScript(
        `(async()=>{await document.fonts.ready;await Promise.all([...document.images].map(image=>image.decode()));const canvas=document.createElement('canvas'),context=canvas.getContext('2d'),sample='mmmmWWlli123한글가나다';const generic=new Set(['serif','sans-serif','monospace','cursive','fantasy','system-ui']);const fontAvailable=family=>generic.has(family.toLowerCase())||['monospace','serif','sans-serif'].some(fallback=>{context.font='32px '+fallback;const baseline=context.measureText(sample).width;context.font='32px "'+family.replace(/["\\\\]/g,'')+'",'+fallback;return Math.abs(context.measureText(sample).width-baseline)>.01;});const missing=${JSON.stringify(families)}.filter(list=>!fontAvailable(list.split(',')[0].trim()));return {missing,images:[...document.images].map(image=>({complete:image.complete,width:image.naturalWidth,height:image.naturalHeight})),overflow:[...document.querySelectorAll('.slide-element')].filter(node=>node.scrollHeight>node.clientHeight+2||node.scrollWidth>node.clientWidth+2).map(node=>node.dataset.elementId)};})()`,
      );
      if (
        inspected.images.some(
          (image) => !image.complete || !image.width || !image.height,
        )
      )
        throw new Error("출력 이미지 자산을 읽지 못했습니다.");
      const diagnostics = [
        ...diagnoseDocument(document),
        ...inspected.missing.map((fontFamily) => ({
          code: "OUTPUT_FONT_MISSING",
          severity: "warning",
          fontFamily,
          message: `${fontFamily}: 현재 출력 환경에서 글꼴을 확인하지 못했습니다. 대체 모양을 미리보기로 확인하세요.`,
        })),
        ...inspected.overflow.map((elementId) => ({
          code: "OUTPUT_CONTENT_OVERFLOW",
          severity: "warning",
          elementId,
          message: "출력에서 개체 내부 내용이 잘릴 수 있습니다.",
        })),
      ];
      if (pdf) {
        const result = await window.webContents.printToPDF({
          printBackground: true,
          preferCSSPageSize: true,
          displayHeaderFooter: false,
          margins: { top: 0, bottom: 0, left: 0, right: 0 },
          generateTaggedPDF: true,
        });
        bytes += result.length;
        if (bytes > MAX_BYTES)
          throw new Error("출력 결과가 100MB를 초과했습니다.");
        return { pdf: Buffer.from(result), images, diagnostics };
      }
      if (png) {
        const expected = plan.slideIds.length;
        for (let index = 0; index < expected; index++) {
          await window.webContents.executeJavaScript(
            `(()=>{document.querySelectorAll('.business-output-page').forEach((page,index)=>{page.style.display=index===${index}?'block':'none';});scrollTo(0,0);return new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));})()`,
          );
          const captured = await window.webContents.capturePage(
            {
              x: 0,
              y: 0,
              width: Math.ceil(plan.width),
              height: Math.ceil(plan.height),
            },
            { stayHidden: true, stayAwake: true },
          );
          const image = captured
            .resize({
              width: Math.ceil(plan.width),
              height: Math.ceil(plan.height),
              quality: "best",
            })
            .toPNG();
          if (!image.length) throw new Error("PNG 장면을 캡처하지 못했습니다.");
          bytes += image.length;
          if (bytes > MAX_BYTES)
            throw new Error(
              "출력 결과가 100MB를 초과했습니다. 장을 나누어 출력하세요.",
            );
          images.push(Buffer.from(image));
        }
      }
      return { images, diagnostics };
    } finally {
      if (window && !window.isDestroyed()) window.destroy();
      await fs.unlink(file).catch(() => {});
      await fs.rmdir(folder).catch(() => {});
    }
  }
}
