/* ==================================================================
   บอร์ดอุปกรณ์สตูดิโอ — Kanban (drag ซ้าย→ขวา เปลี่ยนสถานะ)
   - แต่ละ "ชิ้น" ของอุปกรณ์ = 1 record ในชีต
   - อุปกรณ์ชื่อเดียวกันในคอลัมน์เดียวกัน = รวมเป็นการ์ดเดียว (โชว์จำนวน)
   - คลิกการ์ด = กางดูอุปกรณ์แต่ละชิ้น (ลากทีละชิ้นได้)
   ================================================================== */

(function () {
  "use strict";

  const CFG = window.APP_CONFIG || {};
  const API_URL = (CFG.API_URL || "").trim();
  const STATUSES = CFG.STATUSES || [];
  const STATUS_MAP = Object.fromEntries(STATUSES.map((s) => [s.key, s]));

  const $ = (id) => document.getElementById(id);
  const board = $("board");
  const banner = $("banner");
  const popMenu = $("popMenu");

  let items = [];                       // ทุกชิ้น (units)
  const expanded = new Set();           // groupKey ที่กางอยู่
  let drag = null;                      // { ids:[...], fromStatus }

  // ================================================================
  function init() {
    $("studioName").textContent = CFG.STUDIO_NAME || "บอร์ดอุปกรณ์สตูดิโอ";
    document.title = CFG.STUDIO_NAME || "บอร์ดอุปกรณ์สตูดิโอ";
    for (const s of STATUSES) $("f_status").appendChild(new Option(s.label, s.key));

    $("addBtn").addEventListener("click", () => openForm());
    $("refreshBtn").addEventListener("click", loadData);
    $("cancelBtn").addEventListener("click", closeForm);
    $("modal").addEventListener("click", (e) => { if (e.target.id === "modal") closeForm(); });
    $("equipForm").addEventListener("submit", onSubmit);
    $("search").addEventListener("input", render);
    document.addEventListener("click", closePopMenu);
    window.addEventListener("scroll", closePopMenu, true);

    if (!API_URL) {
      showBanner("ยังไม่ได้ตั้งค่า API_URL ในไฟล์ config.js — ดูวิธีใน README.md", "error");
      renderBoardSkeleton();
      return;
    }
    loadData();
  }

  // ================================================================
  // API
  // ================================================================
  async function api(action, payload) {
    if (!API_URL) throw new Error("ยังไม่ได้ตั้งค่า API_URL");
    if (action === "list") {
      const res = await fetch(`${API_URL}?action=list`, { method: "GET" });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "โหลดข้อมูลไม่สำเร็จ");
      return data.items;
    }
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action, ...payload }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "บันทึกไม่สำเร็จ");
    return data;
  }

  async function loadData() {
    showBanner("กำลังโหลดข้อมูล…", "info");
    try {
      items = await api("list");
      hideBanner();
      buildCategoryList();
      render();
    } catch (err) {
      showBanner("โหลดข้อมูลไม่สำเร็จ: " + err.message, "error");
    }
  }

  // ================================================================
  // จัดกลุ่ม + แสดงผลบอร์ด
  // ================================================================
  function groupKey(status, name) { return status + "||" + (name || "").trim().toLowerCase(); }

  function render() {
    const q = $("search").value.trim().toLowerCase();
    board.innerHTML = "";

    for (const st of STATUSES) {
      const colUnits = items.filter(
        (it) => it.status === st.key && (!q || (it.name || "").toLowerCase().includes(q))
      );

      // จัดกลุ่มตามชื่อ
      const groups = new Map();
      for (const it of colUnits) {
        const k = groupKey(st.key, it.name);
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(it);
      }

      board.appendChild(renderColumn(st, groups, colUnits.length));
    }
  }

  function renderColumn(st, groups, total) {
    const col = document.createElement("div");
    col.className = "column";

    const head = document.createElement("div");
    head.className = "col-head";
    head.innerHTML =
      `<span class="dot" style="background:${st.color}"></span>` +
      `<span>${st.label}</span>` +
      `<span class="count">${total}</span>`;
    col.appendChild(head);

    const body = document.createElement("div");
    body.className = "col-body";
    body.dataset.status = st.key;
    // drop target
    body.addEventListener("dragover", (e) => { e.preventDefault(); body.classList.add("drop-hover"); });
    body.addEventListener("dragleave", () => body.classList.remove("drop-hover"));
    body.addEventListener("drop", (e) => {
      e.preventDefault();
      body.classList.remove("drop-hover");
      if (drag && drag.fromStatus !== st.key) moveUnits(drag.ids, st.key);
      drag = null;
    });

    if (groups.size === 0) {
      const empty = document.createElement("div");
      empty.className = "col-empty";
      empty.textContent = "— ว่าง —";
      body.appendChild(empty);
    } else {
      // เรียงตามชื่อ
      const sorted = [...groups.entries()].sort((a, b) =>
        (a[1][0].name || "").localeCompare(b[1][0].name || "", "th")
      );
      for (const [key, units] of sorted) body.appendChild(renderCard(st, key, units));
    }

    col.appendChild(body);
    return col;
  }

  function renderCard(st, key, units) {
    const first = units[0];
    const card = document.createElement("div");
    card.className = "card";
    card.style.setProperty("--accent", st.color);
    card.draggable = true;

    const ids = units.map((u) => u.id);

    // ลากทั้งการ์ด = ย้ายทั้งกลุ่ม
    card.addEventListener("dragstart", (e) => {
      drag = { ids, fromStatus: st.key };
      card.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", key);
    });
    card.addEventListener("dragend", () => card.classList.remove("dragging"));

    // ส่วนหัวการ์ด
    const top = document.createElement("div");
    top.className = "card-top";
    const name = document.createElement("div");
    name.className = "card-name";
    name.textContent = first.name || "(ไม่มีชื่อ)";
    const menuBtn = document.createElement("button");
    menuBtn.className = "card-menu-btn";
    menuBtn.textContent = "⋮";
    menuBtn.title = "ตัวเลือก";
    menuBtn.addEventListener("click", (e) => { e.stopPropagation(); openCardMenu(e, st, units); });
    top.append(name, menuBtn);

    const meta = document.createElement("div");
    meta.className = "card-meta";
    const badge = document.createElement("span");
    badge.className = "qty-badge";
    badge.textContent = units.length + " ชิ้น";
    meta.appendChild(badge);
    if (first.category) {
      const cat = document.createElement("span");
      cat.className = "card-cat";
      cat.textContent = first.category;
      meta.appendChild(cat);
    }

    card.append(top, meta);

    // คลิกการ์ด = กาง/พับ รายชิ้น
    card.addEventListener("click", () => {
      if (expanded.has(key)) expanded.delete(key); else expanded.add(key);
      render();
    });

    if (expanded.has(key)) card.appendChild(renderUnits(st, units));
    return card;
  }

  function renderUnits(st, units) {
    const box = document.createElement("div");
    box.className = "units";
    units.forEach((u, i) => {
      const row = document.createElement("div");
      row.className = "unit";
      row.draggable = true;

      row.addEventListener("dragstart", (e) => {
        e.stopPropagation();
        drag = { ids: [u.id], fromStatus: st.key };
        row.classList.add("dragging");
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", u.id);
      });
      row.addEventListener("dragend", () => row.classList.remove("dragging"));

      const label = document.createElement("span");
      label.className = "u-label";
      label.textContent = "ชิ้นที่ " + (i + 1);
      const loc = document.createElement("span");
      loc.className = "u-loc";
      loc.textContent = u.location ? "· " + u.location : "";

      const del = document.createElement("button");
      del.className = "u-del";
      del.textContent = "×";
      del.title = "ลบชิ้นนี้";
      del.addEventListener("click", (e) => { e.stopPropagation(); deleteUnit(u); });

      // คลิกชิ้น = เมนูย้าย
      row.addEventListener("click", (e) => {
        if (e.target === del) return;
        e.stopPropagation();
        openUnitMenu(e, st, u);
      });

      row.append(label, loc, del);
      box.appendChild(row);
    });
    return box;
  }

  function renderBoardSkeleton() {
    board.innerHTML = "";
    for (const st of STATUSES) board.appendChild(renderColumn(st, new Map(), 0));
  }

  // ================================================================
  // เมนูป๊อปอัป
  // ================================================================
  function openPopMenu(e, options) {
    closePopMenu();
    popMenu.innerHTML = "";
    for (const opt of options) {
      if (opt.sep) { const s = document.createElement("div"); s.className = "sep"; popMenu.appendChild(s); continue; }
      const b = document.createElement("button");
      if (opt.color) b.innerHTML = `<span class="dot" style="background:${opt.color}"></span>`;
      b.appendChild(document.createTextNode(opt.label));
      if (opt.danger) b.classList.add("danger");
      b.addEventListener("click", (ev) => { ev.stopPropagation(); closePopMenu(); opt.onClick(); });
      popMenu.appendChild(b);
    }
    popMenu.hidden = false;
    const mw = popMenu.offsetWidth, mh = popMenu.offsetHeight;
    let x = e.clientX, y = e.clientY;
    if (x + mw > window.innerWidth - 8) x = window.innerWidth - mw - 8;
    if (y + mh > window.innerHeight - 8) y = window.innerHeight - mh - 8;
    popMenu.style.left = (window.scrollX + x) + "px";
    popMenu.style.top = (window.scrollY + y) + "px";
  }
  function closePopMenu() { popMenu.hidden = true; }

  function openCardMenu(e, st, units) {
    const ids = units.map((u) => u.id);
    const opts = [];
    for (const s of STATUSES) {
      if (s.key === st.key) continue;
      opts.push({ label: "ย้ายทั้งกลุ่มไป “" + s.label + "”", color: s.color, onClick: () => moveUnits(ids, s.key) });
    }
    opts.push({ sep: true });
    opts.push({ label: "แก้ไขข้อมูล", onClick: () => openForm(units) });
    opts.push({ label: "ลบทั้งกลุ่ม (" + units.length + " ชิ้น)", danger: true, onClick: () => deleteGroup(units) });
    openPopMenu(e, opts);
  }

  function openUnitMenu(e, st, u) {
    const opts = [];
    for (const s of STATUSES) {
      if (s.key === st.key) continue;
      opts.push({ label: "ย้ายชิ้นนี้ไป “" + s.label + "”", color: s.color, onClick: () => moveUnits([u.id], s.key) });
    }
    opts.push({ sep: true });
    opts.push({ label: "ลบชิ้นนี้", danger: true, onClick: () => deleteUnit(u) });
    openPopMenu(e, opts);
  }

  // ================================================================
  // การกระทำ (ย้าย / เพิ่ม / แก้ / ลบ)
  // ================================================================
  async function moveUnits(ids, newStatus) {
    const idSet = new Set(ids);
    const affected = items.filter((it) => idSet.has(it.id));
    const prev = affected.map((it) => it.status);
    affected.forEach((it) => (it.status = newStatus)); // optimistic
    render();
    try {
      await api("move", { ids, status: newStatus });
    } catch (err) {
      affected.forEach((it, i) => (it.status = prev[i])); // rollback
      render();
      showBanner("ย้ายไม่สำเร็จ: " + err.message, "error");
    }
  }

  function openForm(units) {
    const editing = Array.isArray(units) && units.length > 0;
    const first = editing ? units[0] : null;
    $("modalTitle").textContent = editing ? "แก้ไขข้อมูลกลุ่ม" : "เพิ่มอุปกรณ์";
    $("f_ids").value = editing ? units.map((u) => u.id).join(",") : "";
    $("f_name").value = editing ? first.name || "" : "";
    $("f_category").value = editing ? first.category || "" : "";
    $("f_location").value = editing ? first.location || "" : "";
    $("f_note").value = editing ? first.note || "" : "";
    $("f_status").value = editing ? first.status : STATUSES[0]?.key;
    $("f_count").value = 1;
    // แก้ไขกลุ่ม: ซ่อนช่องจำนวน + สถานะเริ่มต้น (ย้ายสถานะทำจากบอร์ด)
    $("countWrap").style.display = editing ? "none" : "";
    $("statusWrap").style.display = editing ? "none" : "";
    $("modal").hidden = false;
    $("f_name").focus();
  }
  function closeForm() { $("modal").hidden = true; }

  async function onSubmit(e) {
    e.preventDefault();
    const saveBtn = $("saveBtn");
    saveBtn.disabled = true;

    const idsRaw = $("f_ids").value;
    const fields = {
      name: $("f_name").value.trim(),
      category: $("f_category").value.trim(),
      location: $("f_location").value.trim(),
      note: $("f_note").value.trim(),
    };

    try {
      if (idsRaw) {
        const ids = idsRaw.split(",");
        await api("updateGroup", { ids, fields });
      } else {
        const count = Math.max(1, Number($("f_count").value) || 1);
        await api("add", { item: { ...fields, status: $("f_status").value }, count });
      }
      closeForm();
      await loadData();
      showBanner("บันทึกเรียบร้อย", "ok");
      setTimeout(hideBanner, 1800);
    } catch (err) {
      showBanner("บันทึกไม่สำเร็จ: " + err.message, "error");
    } finally {
      saveBtn.disabled = false;
    }
  }

  async function deleteUnit(u) {
    if (!confirm(`ลบ "${u.name}" 1 ชิ้น ใช่หรือไม่?`)) return;
    try { await api("delete", { id: u.id }); await loadData(); }
    catch (err) { showBanner("ลบไม่สำเร็จ: " + err.message, "error"); }
  }

  async function deleteGroup(units) {
    if (!confirm(`ลบ "${units[0].name}" ทั้งหมด ${units.length} ชิ้น ใช่หรือไม่?`)) return;
    try { await api("deleteGroup", { ids: units.map((u) => u.id) }); await loadData(); }
    catch (err) { showBanner("ลบไม่สำเร็จ: " + err.message, "error"); }
  }

  // ================================================================
  // Helpers
  // ================================================================
  function buildCategoryList() {
    const cats = [...new Set(items.map((it) => it.category).filter(Boolean))].sort();
    const dl = $("categoryList");
    dl.innerHTML = "";
    for (const c of cats) dl.appendChild(new Option(c));
  }

  function showBanner(msg, type) {
    banner.textContent = msg;
    banner.className = "banner wrap " + (type || "info");
    banner.hidden = false;
  }
  function hideBanner() { banner.hidden = true; }

  document.addEventListener("DOMContentLoaded", init);
})();
