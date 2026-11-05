const { ipcRenderer } = require("electron");
let latest = null,
  startedAt = Date.now();
function paint() {
  if (!latest || !document.getElementById("notes")) return;
  document.getElementById("title").textContent = latest.title;
  document.getElementById("slide-name").textContent = latest.slideName;
  document.getElementById("notes").textContent =
    latest.notes || "이 슬라이드에는 발표 메모가 없습니다.";
  document.getElementById("counter").textContent =
    `${latest.index + 1} / ${latest.total}`;
  document.getElementById("step").textContent = String(latest.step);
  document.getElementById("next-title").textContent = latest.nextTitle
    ? `다음: ${latest.nextTitle}`
    : "마지막 슬라이드";
  document.getElementById("next").disabled = !latest.canNext;
  document.getElementById("previous").disabled = !latest.canPrevious;
}
ipcRenderer.on("presenter:state", (_event, value) => {
  latest = value;
  paint();
});
window.addEventListener("DOMContentLoaded", () => {
  for (const [id, command] of [
    ["next", "next"],
    ["previous", "previous"],
    ["end", "end"],
  ])
    document
      .getElementById(id)
      .addEventListener("click", () =>
        ipcRenderer.send("presenter:command", command),
      );
  document.getElementById("reset-timer").addEventListener("click", () => {
    startedAt = Date.now();
  });
  setInterval(() => {
    const seconds = Math.floor((Date.now() - startedAt) / 1000);
    document.getElementById("timer").textContent =
      `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  }, 250);
  paint();
});
