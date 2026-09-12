(() => {
  "use strict";

  const STORAGE_KEY = "moduly-v1-state";
  const STATUS_LABELS = {
    open: "Offen",
    active: "In Bearbeitung",
    done: "Bestanden",
  };

  const initialState = {
    note: "",
    semester: 1,
    widgets: {
      progress: true,
      nextExam: true,
      schedule: true,
      modules: true,
      note: true,
    },
    modules: [
      { id: "m1", name: "Mathematik 1", code: "MAT101", ects: 5, semester: 1, status: "active", edited: false },
      { id: "m2", name: "Physik 1", code: "PHY101", ects: 5, semester: 1, status: "active", edited: false },
      { id: "m3", name: "Werkstofftechnik", code: "WT101", ects: 5, semester: 1, status: "active", edited: false },
      { id: "m4", name: "Grundlagen der Informatik", code: "INF101", ects: 5, semester: 1, status: "active", edited: false },
      { id: "m5", name: "Betriebswirtschaftslehre", code: "BWL101", ects: 5, semester: 1, status: "active", edited: false },
      { id: "m6", name: "Volkswirtschaftslehre", code: "VWL101", ects: 5, semester: 1, status: "active", edited: false },
      { id: "m7", name: "Mathematik 2", code: "MAT201", ects: 5, semester: 2, status: "open", edited: false },
      { id: "m8", name: "English for Engineers", code: "ENG201", ects: 5, semester: 2, status: "done", edited: false },
      { id: "m9", name: "Technische Mechanik", code: "TM301", ects: 5, semester: 3, status: "open", edited: false },
      { id: "m10", name: "Produktionswirtschaft", code: "PW301", ects: 5, semester: 3, status: "open", edited: false },
    ],
    exams: [
      { id: "e1", name: "Mathematik 1", date: "2027-01-27", time: "09:00", location: "Raum A 204", duration: "120 Min." },
      { id: "e2", name: "Physik 1", date: "2027-02-03", time: "10:30", location: "Raum offen", duration: "90 Min." },
      { id: "e3", name: "Werkstofftechnik", date: "2027-02-12", time: "08:30", location: "Raum offen", duration: "90 Min." },
    ],
  };

  const deepClone = (value) => JSON.parse(JSON.stringify(value));

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (!saved || !Array.isArray(saved.modules)) return deepClone(initialState);
      return {
        ...deepClone(initialState),
        ...saved,
        widgets: { ...initialState.widgets, ...(saved.widgets || {}) },
      };
    } catch {
      return deepClone(initialState);
    }
  }

  let state = loadState();
  let toastTimer;

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  function persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function toast(message) {
    const element = $("#toast");
    clearTimeout(toastTimer);
    element.textContent = message;
    element.classList.remove("is-visible");
    void element.offsetWidth;
    element.classList.add("is-visible");
    toastTimer = setTimeout(() => element.classList.remove("is-visible"), 2850);
  }

  function statusLabel(status) {
    return STATUS_LABELS[status] || STATUS_LABELS.open;
  }

  function showPage(name, updateHash = true) {
    const exists = $(`[data-page="${name}"]`);
    if (!exists) name = "overview";

    $$("[data-page]").forEach((page) => page.classList.toggle("is-active", page.dataset.page === name));
    $$(".nav-item").forEach((item) => {
      const active = item.dataset.pageTarget === name;
      item.classList.toggle("is-active", active);
      if (active) item.setAttribute("aria-current", "page");
      else item.removeAttribute("aria-current");
    });

    const activeNav = $(`.nav-item[data-page-target="${name}"]`);
    $("#mobile-page-name").textContent = activeNav?.lastElementChild?.textContent || "Übersicht";
    document.body.classList.remove("sidebar-open");
    if (updateHash) history.replaceState(null, "", `#${name}`);
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  function renderWidgets() {
    $$("[data-widget]").forEach((widget) => {
      widget.hidden = state.widgets[widget.dataset.widget] === false;
    });
    $$('[data-widget-toggle]').forEach((toggle) => {
      toggle.checked = state.widgets[toggle.dataset.widgetToggle] !== false;
    });
  }

  function moduleRow(module) {
    return `
      <div class="module-row ${escapeHtml(module.status)}">
        <i aria-hidden="true"></i>
        <div><strong>${escapeHtml(module.name)}</strong><small>${escapeHtml(module.code)} · ${statusLabel(module.status)}</small></div>
        <span>${Number(module.ects)} ECTS</span>
        <button class="row-action pressable" type="button" data-edit-module="${escapeHtml(module.id)}" aria-label="${escapeHtml(module.name)} bearbeiten">↗</button>
      </div>`;
  }

  function renderOverviewModules() {
    const active = state.modules.filter((module) => module.status === "active");
    $("#overview-module-list").innerHTML = active.length
      ? active.slice(0, 5).map(moduleRow).join("")
      : '<p class="empty-copy">Zurzeit ist kein Modul in Bearbeitung.</p>';
    $("#module-summary").textContent = `${active.length} aktiv`;
    $("#active-module-count").textContent = `${active.length} ${active.length === 1 ? "Modul" : "Module"}`;
  }

  function studyModuleRow(module) {
    return `
      <div class="study-module">
        <div class="study-module__name">
          <strong>${escapeHtml(module.name)}</strong>
          <small>${escapeHtml(module.code)}</small>
          ${module.edited ? '<small class="personal-label">Von dir bearbeitet</small>' : ""}
        </div>
        <span>${Number(module.ects)} ECTS</span>
        <select class="status-select" data-status-module="${escapeHtml(module.id)}" aria-label="Status für ${escapeHtml(module.name)}">
          ${Object.entries(STATUS_LABELS).map(([value, label]) => `<option value="${value}" ${module.status === value ? "selected" : ""}>${label}</option>`).join("")}
        </select>
        <div class="study-module__actions">
          <button class="row-action pressable" type="button" data-edit-module="${escapeHtml(module.id)}" aria-label="${escapeHtml(module.name)} bearbeiten">↗</button>
          <button class="delete-button pressable" type="button" data-delete-module="${escapeHtml(module.id)}" aria-label="${escapeHtml(module.name)} löschen"><span class="delete-icon" aria-hidden="true">×</span><span class="delete-label">Löschen</span></button>
        </div>
      </div>`;
  }

  function renderStudy() {
    const semester = Number(state.semester) || 1;
    const modules = state.modules.filter((module) => Number(module.semester) === semester);
    const ects = modules.reduce((sum, module) => sum + Number(module.ects), 0);
    $("#semester-number").textContent = String(semester).padStart(2, "0");
    $("#semester-title").textContent = `Semester ${semester}`;
    $("#semester-ects").textContent = `${ects} ECTS vorgesehen`;
    $("#study-module-list").innerHTML = modules.length
      ? modules.map(studyModuleRow).join("")
      : '<p class="empty-copy">In diesem Semester sind noch keine Module eingetragen.</p>';

    $$('[data-semester]').forEach((tab) => {
      const active = Number(tab.dataset.semester) === semester;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", String(active));
    });
  }

  function formatExamDate(date) {
    const value = new Date(`${date}T12:00:00`);
    return {
      day: new Intl.DateTimeFormat("de-DE", { day: "2-digit" }).format(value),
      month: new Intl.DateTimeFormat("de-DE", { month: "short" }).format(value).replace(".", "").toUpperCase(),
      full: new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "2-digit", month: "long", year: "numeric" }).format(value),
    };
  }

  function renderExams() {
    const exams = [...state.exams].sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));
    $("#exam-list").innerHTML = exams.length
      ? exams.map((exam) => {
        const date = formatExamDate(exam.date);
        return `<article class="exam-item">
          <time class="exam-date" datetime="${escapeHtml(exam.date)}"><strong>${date.day}</strong><span>${date.month}</span></time>
          <div class="exam-item__body"><h2>${escapeHtml(exam.name)}</h2><p>${escapeHtml(date.full)} · ${escapeHtml(exam.time)} Uhr</p></div>
          <div class="exam-item__meta"><strong>${escapeHtml(exam.location || "Raum offen")}</strong><span>${escapeHtml(exam.duration || "Dauer offen")}</span></div>
        </article>`;
      }).join("")
      : '<p class="empty-copy">Du hast noch keine Prüfungen eingetragen.</p>';
  }

  function renderAll() {
    renderWidgets();
    renderOverviewModules();
    renderStudy();
    renderExams();
    $("#quick-note").value = state.note || "";
  }

  function openModule(moduleId = null) {
    const modal = $("#module-modal");
    const module = state.modules.find((item) => item.id === moduleId);
    $("#module-modal-title").textContent = module ? "Modul bearbeiten" : "Modul hinzufügen";
    $("#module-id").value = module?.id || "";
    $("#module-name").value = module?.name || "";
    $("#module-ects").value = module?.ects || 5;
    $("#module-semester").value = module?.semester || state.semester || 1;
    $("#module-status").value = module?.status || "open";
    modal.showModal();
    requestAnimationFrame(() => $("#module-name").focus());
  }

  function closeDialog(selector) {
    const dialog = $(selector);
    if (dialog?.open) dialog.close();
  }

  function saveModule(event) {
    event.preventDefault();
    const id = $("#module-id").value;
    const existing = state.modules.find((module) => module.id === id);
    const entry = {
      id: existing?.id || `m-${Date.now()}`,
      name: $("#module-name").value.trim(),
      code: existing?.code || `PERS-${String(state.modules.length + 1).padStart(2, "0")}`,
      ects: Number($("#module-ects").value),
      semester: Number($("#module-semester").value),
      status: $("#module-status").value,
      edited: true,
    };

    if (!entry.name) return;
    if (existing) Object.assign(existing, entry);
    else state.modules.push(entry);
    state.semester = entry.semester;
    persist();
    renderAll();
    closeDialog("#module-modal");
    toast(existing ? "Modul persönlich aktualisiert" : "Modul zum Studienplan hinzugefügt");
  }

  function removeModule(id) {
    const module = state.modules.find((item) => item.id === id);
    if (!module) return;
    if (!window.confirm(`„${module.name}“ aus deiner persönlichen Ansicht entfernen?`)) return;
    state.modules = state.modules.filter((item) => item.id !== id);
    persist();
    renderAll();
    toast("Modul entfernt");
  }

  function saveExam(event) {
    event.preventDefault();
    const entry = {
      id: `e-${Date.now()}`,
      name: $("#exam-name").value.trim(),
      date: $("#exam-date").value,
      time: $("#exam-time").value,
      location: $("#exam-location").value.trim() || "Raum offen",
      duration: "Dauer offen",
    };
    if (!entry.name || !entry.date || !entry.time) return;
    state.exams.push(entry);
    persist();
    renderExams();
    closeDialog("#exam-modal");
    $("#exam-form").reset();
    toast("Prüfung eingetragen");
  }

  function download(filename, content, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportData() {
    download("moduly-daten.json", JSON.stringify({ exportedAt: new Date().toISOString(), ...state }, null, 2), "application/json");
    toast("Datenexport erstellt");
  }

  function escapeIcs(value) {
    return String(value).replaceAll("\\", "\\\\").replaceAll(",", "\\,").replaceAll(";", "\\;").replaceAll("\n", "\\n");
  }

  function exportCalendar() {
    const events = state.exams.map((exam) => {
      const start = `${exam.date.replaceAll("-", "")}T${exam.time.replace(":", "")}00`;
      return [
        "BEGIN:VEVENT",
        `UID:${escapeIcs(exam.id)}@moduly`,
        `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")}`,
        `DTSTART:${start}`,
        `SUMMARY:${escapeIcs(exam.name)}`,
        `LOCATION:${escapeIcs(exam.location)}`,
        "BEGIN:VALARM",
        "TRIGGER:-P1D",
        "ACTION:DISPLAY",
        "DESCRIPTION:Prüfung morgen",
        "END:VALARM",
        "END:VEVENT",
      ].join("\r\n");
    }).join("\r\n");
    const calendar = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Moduly//DE\r\nCALSCALE:GREGORIAN\r\n${events}\r\nEND:VCALENDAR\r\n`;
    download("moduly-pruefungen.ics", calendar, "text/calendar;charset=utf-8");
    toast("Kalenderdatei erstellt");
  }

  function addClickPulse(event) {
    const button = event.currentTarget;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (getComputedStyle(button).position === "static") button.style.position = "relative";
    if (getComputedStyle(button).overflow === "visible") button.style.overflow = "hidden";
    const rect = button.getBoundingClientRect();
    const pulse = document.createElement("span");
    pulse.className = "click-pulse";
    pulse.style.left = `${event.clientX ? event.clientX - rect.left - 6 : rect.width / 2 - 6}px`;
    pulse.style.top = `${event.clientY ? event.clientY - rect.top - 6 : rect.height / 2 - 6}px`;
    button.append(pulse);
    setTimeout(() => pulse.remove(), 520);
  }

  function registerWebMcpTools() {
    const context = document.modelContext;
    if (!context?.registerTool) return;

    const report = () => ({
      modules: state.modules.length,
      activeModules: state.modules.filter((module) => module.status === "active").length,
      exams: state.exams.length,
      selectedSemester: state.semester,
    });

    const registrations = [
      context.registerTool({
        name: "read_study_overview",
        title: "Studienübersicht lesen",
        description: "Liest die aktuelle persönliche Moduly-Übersicht ohne Daten zu verändern.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        annotations: { readOnlyHint: true, untrustedContentHint: false },
        execute() {
          return report();
        },
      }),
      context.registerTool({
        name: "add_personal_module",
        title: "Persönliches Modul hinzufügen",
        description: "Fügt der persönlichen Ansicht ein Modul hinzu und markiert es als selbst bearbeitet.",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string", minLength: 1, maxLength: 70 },
            ects: { type: "number", minimum: 1, maximum: 30 },
            semester: { type: "integer", minimum: 1, maximum: 7 },
            status: { type: "string", enum: ["open", "active", "done"] },
          },
          required: ["name", "ects", "semester"],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute(input) {
          const name = typeof input?.name === "string" ? input.name.trim() : "";
          const ects = Number(input?.ects);
          const semester = Number(input?.semester);
          const status = input?.status || "open";
          if (!name || name.length > 70 || ects < 1 || ects > 30 || !Number.isInteger(semester) || semester < 1 || semester > 7 || !STATUS_LABELS[status]) {
            throw new Error("Ungültige Moduldaten");
          }
          const module = { id: `m-${Date.now()}`, name, code: `PERS-${String(state.modules.length + 1).padStart(2, "0")}`, ects, semester, status, edited: true };
          state.modules.push(module);
          state.semester = semester;
          persist();
          renderAll();
          toast("Modul zum Studienplan hinzugefügt");
          return { id: module.id, name: module.name, saved: true };
        },
      }),
    ];

    registrations.forEach((registration) => Promise.resolve(registration).catch(() => {}));
  }

  document.addEventListener("click", (event) => {
    const pageTarget = event.target.closest("[data-page-target]");
    if (pageTarget) showPage(pageTarget.dataset.pageTarget);

    const edit = event.target.closest("[data-edit-module]");
    if (edit) openModule(edit.dataset.editModule);

    const remove = event.target.closest("[data-delete-module]");
    if (remove) removeModule(remove.dataset.deleteModule);

    if (event.target.closest("[data-open-module]")) openModule();
    if (event.target.closest("[data-close-module]")) closeDialog("#module-modal");
    if (event.target.closest("[data-add-exam]")) $("#exam-modal").showModal();
    if (event.target.closest("[data-close-exam]")) closeDialog("#exam-modal");
    if (event.target.closest("[data-open-customize]")) $("#customize-modal").showModal();
    if (event.target.closest("[data-open-degree]")) $("#degree-modal").showModal();
    if (event.target.closest("[data-sidebar-open]")) document.body.classList.add("sidebar-open");
    if (event.target.closest("[data-sidebar-close]")) document.body.classList.remove("sidebar-open");

    if (event.target.closest("[data-save-note]")) {
      state.note = $("#quick-note").value.trim();
      persist();
      $("#note-status").textContent = "Gerade gespeichert";
      toast("Notiz gespeichert");
    }

    if (event.target.closest("[data-export-data]")) exportData();
    if (event.target.closest("[data-export-calendar]")) exportCalendar();

    if (event.target.closest("[data-reset-data]")) {
      if (!window.confirm("Alle persönlichen Beispieldaten auf diesem Gerät zurücksetzen?")) return;
      state = deepClone(initialState);
      persist();
      renderAll();
      toast("Beispieldaten zurückgesetzt");
    }
  });

  document.addEventListener("change", (event) => {
    if (event.target.matches("[data-widget-toggle]")) {
      state.widgets[event.target.dataset.widgetToggle] = event.target.checked;
      persist();
      renderWidgets();
    }

    if (event.target.matches("[data-status-module]")) {
      const module = state.modules.find((item) => item.id === event.target.dataset.statusModule);
      if (!module) return;
      module.status = event.target.value;
      module.edited = true;
      persist();
      renderAll();
      toast("Status persönlich geändert");
    }
  });

  $$('[data-semester]').forEach((tab) => tab.addEventListener("click", () => {
    state.semester = Number(tab.dataset.semester);
    persist();
    renderStudy();
  }));

  $("#module-form").addEventListener("submit", saveModule);
  $("#exam-form").addEventListener("submit", saveExam);

  $$(".pressable").forEach((button) => button.addEventListener("pointerdown", addClickPulse));

  $$("dialog").forEach((dialog) => dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  }));

  $("#quick-note").addEventListener("input", () => {
    $("#note-status").textContent = "Nicht gespeichert";
  });

  window.addEventListener("hashchange", () => showPage(location.hash.slice(1), false));

  renderAll();
  showPage(location.hash.slice(1) || "overview", false);
  registerWebMcpTools();
})();
