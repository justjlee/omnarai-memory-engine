import { list, put, del } from "@vercel/blob";
import { randomBytes } from "crypto";

// ── Curator open-items ────────────────────────────────────────────────────────
// The editable "what's on my plate" list behind /home's attention queue — the
// decisions and reviews that DON'T auto-detect from data (a menu-link call, a
// one-way-door promotion, a "watch this"). So nothing lives only in a chat
// transcript or a model's memory and slips through the cracks.
//
// Storage: ONE blob per item (`home/open-items/<id>.json`) — the project's
// loss-proof pattern. A consolidated array would drop concurrent edits (Vercel
// Blob has no CAS); per-item can't. Reads cache-bust (Blob URLs are CDN-cached,
// so a read right after a write can otherwise be stale).

const PREFIX = "home/open-items/";
const CATEGORIES = ["review", "decision", "task", "watch"];
const PRIORITIES = ["high", "normal", "low"];
const PRIO_RANK = { high: 0, normal: 1, low: 2 };

const newId = () => "oi_" + randomBytes(5).toString("hex");
const bust = (url) => url + (url.includes("?") ? "&" : "?") + "ts=" + Date.now();

export async function readOpenItems() {
  try {
    const { blobs } = await list({ prefix: PREFIX });
    const items = (
      await Promise.all(blobs.map((b) => fetch(bust(b.url)).then((r) => r.json()).catch(() => null)))
    ).filter(Boolean);
    // Open before done; then by priority; then newest first.
    items.sort(
      (a, b) =>
        (a.status === "done") - (b.status === "done") ||
        (PRIO_RANK[a.priority] ?? 1) - (PRIO_RANK[b.priority] ?? 1) ||
        (b.createdAt || "").localeCompare(a.createdAt || ""),
    );
    return items;
  } catch {
    return [];
  }
}

export async function addOpenItem({ text, category, priority } = {}) {
  const t = String(text || "").trim().slice(0, 240);
  if (!t) return { error: "empty text" };
  const item = {
    id: newId(),
    text: t,
    category: CATEGORIES.includes(category) ? category : "task",
    priority: PRIORITIES.includes(priority) ? priority : "normal",
    status: "open",
    createdAt: new Date().toISOString(),
    doneAt: null,
  };
  await put(PREFIX + item.id + ".json", JSON.stringify(item), {
    access: "public",
    addRandomSuffix: false,
    contentType: "application/json",
  });
  return { item };
}

async function loadOne(id) {
  const { blobs } = await list({ prefix: PREFIX + id + ".json" });
  if (!blobs.length) return null;
  return fetch(bust(blobs[0].url)).then((r) => r.json()).catch(() => null);
}

export async function setOpenItemStatus(id, status) {
  const item = await loadOne(id);
  if (!item) return { error: "not found" };
  item.status = status === "done" ? "done" : "open";
  item.doneAt = item.status === "done" ? new Date().toISOString() : null;
  await put(PREFIX + id + ".json", JSON.stringify(item), {
    access: "public",
    addRandomSuffix: false,
    contentType: "application/json",
  });
  return { item };
}

export async function deleteOpenItem(id) {
  try {
    const { blobs } = await list({ prefix: PREFIX + String(id).replace(/[^a-z0-9_]/gi, "") + ".json" });
    for (const b of blobs) await del(b.url);
    return { ok: true };
  } catch (e) {
    return { error: String(e?.message || e) };
  }
}

// Dispatch one write action from the POST handler. Returns the fresh full list.
export async function applyOpenItemAction(body = {}) {
  const action = (body.action || "").toString();
  if (action === "add") await addOpenItem(body);
  else if (action === "done") await setOpenItemStatus(body.id, "done");
  else if (action === "reopen") await setOpenItemStatus(body.id, "open");
  else if (action === "delete") await deleteOpenItem(body.id);
  else return { error: "unknown action (add|done|reopen|delete)", items: await readOpenItems() };
  return { ok: true, items: await readOpenItems() };
}
