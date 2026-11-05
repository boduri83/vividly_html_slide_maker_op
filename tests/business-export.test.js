import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { atomicWriteOutput, DesktopExportService } from "../desktop/export.mjs";

test("a failed PDF/output replacement retains original bytes and removes only its owned temporary file", async () => {
  const folder = await fs.mkdtemp(
      path.join(os.tmpdir(), "vividly-output-atomic-"),
    ),
    file = path.join(folder, "report.pdf");
  await fs.writeFile(file, "ORIGINAL");
  const io = {
    ...fs,
    rename: async () => {
      throw Object.assign(new Error("locked destination"), { code: "EACCES" });
    },
  };
  try {
    await assert.rejects(
      atomicWriteOutput(file, Buffer.from("REPLACEMENT"), { io }),
      /locked/,
    );
    assert.equal(await fs.readFile(file, "utf8"), "ORIGINAL");
    assert.deepEqual(await fs.readdir(folder), ["report.pdf"]);
    await atomicWriteOutput(file, Buffer.from("NEW"));
    assert.equal(await fs.readFile(file, "utf8"), "NEW");
  } finally {
    await fs.unlink(file);
    await fs.rmdir(folder);
  }
});

test("main-process export rejects renderer path authority before rendering or native dialogs", async () => {
  let windows = 0,
    dialogs = 0;
  const service = new DesktopExportService({
    BrowserWindow: class {
      constructor() {
        windows++;
      }
    },
    dialog: {
      showSaveDialog: async () => {
        dialogs++;
      },
    },
  });
  await assert.rejects(
    service.export({ document: {}, format: "pdf", filePath: "C:/private.pdf" }),
    /출력 요청/,
  );
  assert.equal(windows, 0);
  assert.equal(dialogs, 0);
  assert.equal(service.busy, false);
});
