// --- 画像リサイズ（クライアント側フォールバック用） ---
async function resizeImage(file, format = "image/png") {
  const img = new Image();
  img.src = URL.createObjectURL(file);
  await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; });
  const maxDimension = 2048;
  let { width, height } = img;
  if (width > maxDimension || height > maxDimension) {
    const scale = maxDimension / Math.max(width, height);
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d").drawImage(img, 0, 0, width, height);
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), format));
}

// --- プレビュー表示 ---
function showPreview(blobOrFile) {
  const preview = document.getElementById("preview");
  preview.src = URL.createObjectURL(blobOrFile);
  preview.style.display = "block";
}

// --- ステータス表示 ---
function setStatus(text, type) {
  const el = document.getElementById("statusMessage");
  el.textContent = text;
  el.className = type; // loading / success / error
}

// --- URL表示＆コピーボタン ---
function showResult(url) {
  document.getElementById("recentUrl").textContent = url;
  const area = document.getElementById("resultArea");
  area.style.display = "block";
  const btn = document.getElementById("copyButton");
  btn.textContent = "URLをコピー";
  btn.classList.remove("copied");
}

// --- 画像アップロード（ファイル / Blob） ---
async function uploadImage(blob, format) {
  setStatus("アップロード中…", "loading");
  const uuid = self.crypto.randomUUID();
  try {
    const res = await fetch(`/${uuid}`, {
      method: "PUT",
      headers: { "Content-Type": format },
      body: blob,
    });
    if (res.ok) {
      const url = `https://image2vrc.smisann.net/${uuid}`;
      showResult(url);
      let copied = false;
      try { await navigator.clipboard.writeText(url); copied = true; } catch {}
      setStatus(copied ? "アップロード完了 · URLをコピーしました" : "アップロード完了", "success");
    } else {
      const msg = await res.text();
      setStatus(msg || "アップロード失敗", "error");
    }
  } catch {
    setStatus("アップロード失敗", "error");
  }
}

// --- ファイル選択→アップロード ---
async function handleFile(file) {
  if (!file) return;
  showPreview(file);
  const resized = await resizeImage(file, file.type);
  await uploadImage(resized, file.type);
}

document.getElementById("fileInput").addEventListener("change", (e) => {
  handleFile(e.target.files[0]);
});

// --- ドラッグ＆ドロップ ---
const dropZone = document.getElementById("dropZone");

dropZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropZone.classList.add("dragover");
});

dropZone.addEventListener("dragleave", () => {
  dropZone.classList.remove("dragover");
});

dropZone.addEventListener("drop", async (e) => {
  e.preventDefault();
  dropZone.classList.remove("dragover");
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith("image/")) {
    await handleFile(file);
  }
});

// --- 画像URLの判定（拡張子 or format=パラメータ） ---
function isImageUrl(url) {
  try {
    const { pathname, searchParams } = new URL(url);
    if (/\.(png|jpe?g|webp|gif)$/i.test(pathname)) return true;
    const fmt = searchParams.get("format");
    if (fmt && /^(png|jpe?g|webp|gif)$/i.test(fmt)) return true;
    return false;
  } catch {
    return false;
  }
}

// --- クリップボード貼り付け ---
document.addEventListener("paste", async (e) => {
  const items = Array.from(e.clipboardData.items);

  // 画像データ（ファイル）が含まれている場合
  const imageItem = items.find((item) => item.type.startsWith("image/"));
  if (imageItem) {
    const blob = imageItem.getAsFile();
    showPreview(blob);
    const resized = await resizeImage(blob, blob.type);
    await uploadImage(resized, blob.type);
    return;
  }

  // テキストが画像URLの場合は自動で取得
  const textItem = items.find((item) => item.type === "text/plain");
  if (textItem) {
    textItem.getAsString(async (text) => {
      const trimmed = text.trim();
      if (/^https?:\/\//i.test(trimmed) && isImageUrl(trimmed)) {
        document.getElementById("urlInput").value = trimmed;
        await uploadFromUrl(trimmed);
      }
    });
  }
});

// --- URLから取得 ---
async function uploadFromUrl(urlOverride) {
  const url = urlOverride ?? document.getElementById("urlInput").value.trim();
  if (!url) { setStatus("URLを入力してください", "error"); return; }
  setStatus("取得中…", "loading");
  try {
    const res = await fetch("/fetch-url", { method: "POST", body: url });
    if (res.ok) {
      const uuid = await res.text();
      const hostedUrl = `https://image2vrc.smisann.net/${uuid}`;
      showResult(hostedUrl);
      let copied = false;
      try { await navigator.clipboard.writeText(hostedUrl); copied = true; } catch {}
      setStatus(copied ? "取得完了 · URLをコピーしました" : "取得完了", "success");
    } else {
      const msg = await res.text();
      setStatus(msg || "取得失敗", "error");
    }
  } catch {
    setStatus("取得失敗", "error");
  }
}

// --- Enterキーで取得 ---
document.getElementById("urlInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") uploadFromUrl();
});

// --- URLコピー ---
async function copyToClipboard() {
  const url = document.getElementById("recentUrl").textContent;
  const btn = document.getElementById("copyButton");
  try {
    await navigator.clipboard.writeText(url);
    btn.textContent = "コピーしました！";
    btn.classList.add("copied");
    setTimeout(() => {
      btn.textContent = "URLをコピー";
      btn.classList.remove("copied");
    }, 2000);
  } catch {}
}

// --- プロキシ折りたたみ ---
function toggleProxy() {
  const body = document.getElementById("proxyBody");
  const arrow = document.getElementById("proxyArrow");
  const isOpen = body.classList.toggle("open");
  arrow.classList.toggle("open", isOpen);
}

// --- プロキシURLプレフィックスコピー ---
async function copyProxyPrefix() {
  const prefix = "https://imagetovrc.smisann.net/proxy?url=";
  const btn = document.getElementById("proxyBtn");
  try {
    await navigator.clipboard.writeText(prefix);
    btn.textContent = "コピーしました！";
    btn.classList.add("copied");
    setTimeout(() => {
      btn.textContent = "コピー";
      btn.classList.remove("copied");
    }, 2000);
  } catch {}
}
