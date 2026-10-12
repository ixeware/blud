// Export all slides as full-res PNGs in a zip, plus caption.txt.
import { renderSlide } from "/static/slide.js";
import { toast, busy } from "/static/app.js";

async function toPng(node, w, h) {
  const { toBlob } = window.htmlToImage;
  // render at native size, 1:1 pixels
  return toBlob(node, { width: w, height: h, pixelRatio: 1, cacheBust: true, style: { margin: "0" } });
}

export async function exportProject(project, style, handle) {
  busy(true, "Рендерю PNG…");
  const stage = document.createElement("div");
  stage.style.cssText = "position:fixed;left:-99999px;top:0;";
  document.body.appendChild(stage);
  try {
    const [w, h] = style?.size || [1080, 1440];
    const zip = new window.JSZip();
    for (let i = 0; i < project.slides.length; i++) {
      const el = renderSlide(project.slides[i], style, { handle, size: [w, h] });
      el.style.cssText += ";position:static;transform:none;";
      stage.replaceChildren(el);
      await waitImages(el);
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      let blob = await toPng(el, w, h);
      if (!blob) { await new Promise(r => setTimeout(r, 120)); blob = await toPng(el, w, h); }
      zip.file(`slide_${String(i + 1).padStart(2, "0")}.png`, blob);
    }
    const tags = (project.hashtags || []).map(t => "#" + t).join(" ");
    zip.file("caption.txt", `${project.caption || ""}\n\n${tags}\n\nsound: ${project.sound || ""}\n`);
    const out = await zip.generateAsync({ type: "blob" });
    download(out, (project.name || project.id || "carousel").replace(/[^\w-]+/g, "_") + ".zip");
    toast("Экспортировано: " + project.slides.length + " слайдов");
  } catch (e) { console.error(e); toast("Ошибка экспорта: " + e.message, true); }
  finally { stage.remove(); busy(false); }
}

function waitImages(root) {
  return Promise.all([...root.querySelectorAll("img")].map(img => img.complete && img.naturalWidth
    ? Promise.resolve() : new Promise(res => { img.onload = img.onerror = res; })));
}

function download(blob, name) {
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
