const STORAGE_KEY = "simple-timeline-events-v2";
const DATABASE_NAME = "simple-timeline-database";
const DATABASE_STORE = "timeline-data";
const DATABASE_RECORD_KEY = "events";
const COLORS = ["#1478ff", "#00a6a6", "#2dbd7f", "#5965e8", "#7658d8"];
const LEGACY_COLOR_MAP = {
  "#ff4f55": "#00a6a6",
  "#ff9418": "#5965e8",
};

const elements = {
  pageTrack: document.querySelector("#pageTrack"),
  showHistoryButton: document.querySelector("#showHistoryButton"),
  showCurrentButton: document.querySelector("#showCurrentButton"),
  addButton: document.querySelector("#addButton"),
  historyAddButton: document.querySelector("#historyAddButton"),
  emptyAddButton: document.querySelector("#emptyAddButton"),
  searchInput: document.querySelector("#searchInput"),
  searchResults: document.querySelector("#searchResults"),
  timeline: document.querySelector("#timeline"),
  emptyState: document.querySelector("#emptyState"),
  historySearchInput: document.querySelector("#historySearchInput"),
  historySearchResults: document.querySelector("#historySearchResults"),
  historyTimeline: document.querySelector("#historyTimeline"),
  historyEmptyState: document.querySelector("#historyEmptyState"),
  zoomControls: [...document.querySelectorAll(".zoom-controls")],
  editorPage: document.querySelector("#editorPage"),
  backButton: document.querySelector("#backButton"),
  eventForm: document.querySelector("#eventForm"),
  editingId: document.querySelector("#editingId"),
  eventDate: document.querySelector("#eventDate"),
  eventTime: document.querySelector("#eventTime"),
  eventEndDate: document.querySelector("#eventEndDate"),
  eventEndTime: document.querySelector("#eventEndTime"),
  eventTitle: document.querySelector("#eventTitle"),
  eventDetail: document.querySelector("#eventDetail"),
  charCount: document.querySelector("#charCount"),
  cancelButton: document.querySelector("#cancelButton"),
  saveButton: document.querySelector("#saveButton"),
  toast: document.querySelector("#toast"),
  dateGroupTemplate: document.querySelector("#dateGroupTemplate"),
  eventTemplate: document.querySelector("#eventTemplate"),
};

let events = loadEvents();
let toastTimer;
let fitFrame;
let editorFitFrame;
let currentDateKey = localDateValue();
let dateRefreshTimer;
let sharedSearchKeyword = "";
let manualZoom = 1;

function loadEvents() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!Array.isArray(saved)) return [];

    return saved.map((event, index) => {
      const normalizedColor =
        LEGACY_COLOR_MAP[event.color?.toLowerCase()] ||
        event.color ||
        COLORS[index % COLORS.length];
      const startDate = event.startDate || event.date;
      const startTime = event.startTime || event.time;
      const endDate = event.endDate || startDate;
      const endTime = event.endTime || startTime;
      if (event.title) {
        return {
          ...event,
          startDate,
          startTime,
          endDate,
          endTime,
          color: normalizedColor,
        };
      }
      const migrated = splitLegacyDetail(event.detail || "");
      return {
        ...event,
        startDate,
        startTime,
        endDate,
        endTime,
        title: migrated.title,
        detail: migrated.detail,
        color: normalizedColor,
      };
    });
  } catch {
    return [];
  }
}

function saveEvents() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
  void writeDurableEvents(events);
}

function openTimelineDatabase() {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) {
      reject(new Error("IndexedDB unavailable"));
      return;
    }

    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(DATABASE_STORE)) {
        request.result.createObjectStore(DATABASE_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function writeDurableEvents(value) {
  try {
    const database = await openTimelineDatabase();
    await new Promise((resolve, reject) => {
      const transaction = database.transaction(DATABASE_STORE, "readwrite");
      transaction.objectStore(DATABASE_STORE).put(value, DATABASE_RECORD_KEY);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  } catch {
    // localStorage remains the fallback on older embedded browsers.
  }
}

async function readDurableEvents() {
  try {
    const database = await openTimelineDatabase();
    const value = await new Promise((resolve, reject) => {
      const transaction = database.transaction(DATABASE_STORE, "readonly");
      const request = transaction.objectStore(DATABASE_STORE).get(DATABASE_RECORD_KEY);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    database.close();
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

async function initializeDurableStorage() {
  try {
    if (navigator.storage?.persist) await navigator.storage.persist();
  } catch {
    // Some mobile webviews do not expose persistent-storage requests.
  }

  if (events.length) {
    await writeDurableEvents(events);
    return;
  }

  const durableEvents = await readDurableEvents();
  if (!durableEvents.length) return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(durableEvents));
  events = loadEvents();
  renderTimeline();
}

function localDateValue(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function currentTimeValue() {
  const date = new Date();
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

function eventTimestamp(event) {
  return `${event.startDate}T${event.startTime}`;
}

function eventEndTimestamp(event) {
  return `${event.endDate}T${event.endTime}`;
}

function isRangeEvent(event) {
  return event.startDate !== event.endDate;
}

function formatTimelineDate(date) {
  const [year, month, day] = date.split("-");
  return `${year}/${month}/${day}`;
}

function splitLegacyDetail(detail) {
  const normalized = detail.trim();
  const firstBreak = normalized.indexOf("\n");

  if (firstBreak > 0) {
    return {
      title: normalized.slice(0, firstBreak),
      detail: normalized.slice(firstBreak + 1).trim(),
    };
  }

  return {
    title: normalized || "未命名事件",
    detail: "",
  };
}

function renderTimeline() {
  const sortedEvents = assignEventLanes(events);
  const currentEvents = [];
  const historyEvents = [];

  sortedEvents.forEach((event) => {
    if (!isRangeEvent(event)) {
      (event.startDate < currentDateKey ? historyEvents : currentEvents).push(event);
      return;
    }

    if (event.endDate < currentDateKey) {
      historyEvents.push(withDisplayRange(event, event.startDate, event.endDate, "history"));
      return;
    }

    if (event.startDate >= currentDateKey) {
      currentEvents.push(withDisplayRange(event, event.startDate, event.endDate, "current"));
      return;
    }

    // Ongoing plans appear on both pages. Today is the shared boundary so the
    // gray elapsed segment and colored remaining segment stay visually continuous.
    historyEvents.push(
      withDisplayRange(event, event.startDate, currentDateKey, "elapsed"),
    );
    currentEvents.push(
      withDisplayRange(event, currentDateKey, event.endDate, "remaining"),
    );
  });

  renderEventCollection({
    timeline: elements.timeline,
    emptyState: elements.emptyState,
    displayedEvents: currentEvents,
    keyword: "",
    emptyTitle: "添加你的第一件事",
    emptyText: "它会出现在这条时间轴上",
  });
  renderEventCollection({
    timeline: elements.historyTimeline,
    emptyState: elements.historyEmptyState,
    displayedEvents: historyEvents,
    keyword: "",
    emptyTitle: "过去",
    emptyText: "时间过去后，事件会自动来到这里",
    isHistory: true,
  });

  scheduleTimelineFit();
  return { currentCount: currentEvents.length, historyCount: historyEvents.length };
}

function assignEventLanes(sourceEvents) {
  const laneEndDates = [];
  return [...sourceEvents]
    .sort((a, b) => eventTimestamp(a).localeCompare(eventTimestamp(b)))
    .map((event) => {
      let displayLane = laneEndDates.findIndex((endDate) => endDate < event.startDate);
      if (displayLane === -1) displayLane = laneEndDates.length;
      laneEndDates[displayLane] = event.endDate;
      return { ...event, displayLane };
    });
}

function withDisplayRange(event, displayStartDate, displayEndDate, segment) {
  return {
    ...event,
    displayStartDate,
    displayEndDate,
    segment,
  };
}

function handleSharedSearch(input) {
  sharedSearchKeyword = input.value;
  elements.searchInput.value = sharedSearchKeyword;
  elements.historySearchInput.value = sharedSearchKeyword;
  renderSearchResults();
}

function clearSharedSearch() {
  sharedSearchKeyword = "";
  elements.searchInput.value = "";
  elements.historySearchInput.value = "";
  closeSearchResults();
}

function renderSearchResults() {
  const keyword = sharedSearchKeyword.trim().toLowerCase();
  if (!keyword) {
    closeSearchResults();
    return;
  }

  const matches = [...events]
    .filter((event) =>
      `${event.title} ${event.detail || ""}`.toLowerCase().includes(keyword),
    )
    .sort((a, b) => eventTimestamp(a).localeCompare(eventTimestamp(b)));
  const markup = matches.length
    ? matches.map(searchResultMarkup).join("")
    : '<div class="search-no-result">没有找到相关事件</div>';

  [elements.searchResults, elements.historySearchResults].forEach((panel) => {
    panel.innerHTML = markup;
    panel.classList.add("open");
  });
}

function searchResultMarkup(event) {
  const range = isRangeEvent(event);
  const timeText = range
    ? `${formatTimelineDate(event.startDate)} ${event.startTime} — ${formatTimelineDate(event.endDate)} ${event.endTime}`
    : `${formatTimelineDate(event.startDate)} ${event.startTime}–${event.endTime}`;
  const status =
    event.endDate < currentDateKey
      ? "已过去"
      : event.startDate > currentDateKey
        ? "未开始"
        : "进行中";
  return `
    <button class="search-result-item" type="button" data-event-id="${event.id}">
      <span class="search-result-main">
        <strong>${escapeHtml(event.title)}</strong>
        <span>${timeText}</span>
      </span>
      <span class="search-result-meta">${range ? "长期计划" : "单日事件"} · ${status}</span>
    </button>
  `;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function closeSearchResults() {
  elements.searchResults.classList.remove("open");
  elements.historySearchResults.classList.remove("open");
}

function locateSearchResult(id) {
  const event = events.find((item) => item.id === id);
  if (!event) return;
  const targetHistory = event.endDate < currentDateKey;
  updateManualZoom("reset");
  targetHistory ? showHistoryPage() : showCurrentPage();
  closeSearchResults();

  window.setTimeout(() => {
    const timeline = targetHistory ? elements.historyTimeline : elements.timeline;
    const candidates = [...timeline.querySelectorAll(`[data-id="${CSS.escape(id)}"]`)];
    const target =
      candidates.find((candidate) =>
        targetHistory
          ? !candidate.classList.contains("range-segment-remaining")
          : !candidate.classList.contains("range-segment-elapsed"),
      ) || candidates[0];
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
    target.classList.remove("located");
    window.requestAnimationFrame(() => target.classList.add("located"));
  }, 480);
}

function renderEventCollection({
  timeline,
  emptyState,
  displayedEvents,
  keyword,
  emptyTitle,
  emptyText,
  isHistory = false,
}) {
  timeline.innerHTML = "";
  emptyState.classList.toggle("visible", displayedEvents.length === 0);

  const emptyTitleElement = emptyState.querySelector("strong");
  const emptyTextElement = emptyState.querySelector("span");
  if (keyword && displayedEvents.length === 0) {
    emptyTitleElement.textContent = "没有找到相关事件";
    emptyTextElement.textContent = "换一个关键词试试";
  } else {
    emptyTitleElement.textContent = emptyTitle;
    emptyTextElement.textContent = emptyText;
  }

  const pointEvents = displayedEvents.filter((event) => !isRangeEvent(event));
  const rangeEvents = displayedEvents.filter(isRangeEvent);
  const groupedEvents = Object.groupBy
    ? Object.groupBy(pointEvents, (event) => event.startDate)
    : pointEvents.reduce((groups, event) => {
        (groups[event.startDate] ||= []).push(event);
        return groups;
      }, {});
  const dates = [
    ...new Set([
      ...pointEvents.map((event) => event.startDate),
      ...rangeEvents.flatMap((event) => [
        event.displayStartDate || event.startDate,
        event.displayEndDate || event.endDate,
      ]),
    ]),
  ].sort();

  dates.forEach((date, groupIndex) => {
    const dayEvents = groupedEvents[date] || [];
    const group = elements.dateGroupTemplate.content.firstElementChild.cloneNode(true);
    const relatedRange = rangeEvents.find(
      (event) =>
        (event.displayStartDate || event.startDate) === date ||
        (event.displayEndDate || event.endDate) === date,
    );
    const color = isHistory
      ? "#959ba8"
      : dayEvents[0]?.color || relatedRange?.color || COLORS[groupIndex % COLORS.length];
    group.dataset.date = date;
    group.classList.toggle("range-only-date", dayEvents.length === 0);
    group.style.setProperty("--event-color", color);
    group.style.animationDelay = `${groupIndex * 45}ms`;
    group.querySelector(".group-date").textContent = formatTimelineDate(date);

    const dayList = group.querySelector(".day-events");
    dayEvents.forEach((event) => {
      const card = elements.eventTemplate.content.firstElementChild.cloneNode(true);
      card.dataset.id = event.id;
      card.dataset.lane = String(event.displayLane);
      card.style.setProperty("--event-lane", event.displayLane);
      card.querySelector("h2").textContent = event.title;
      card.addEventListener("click", () => openEditor(event.id));
      card.addEventListener("keydown", (keyboardEvent) => {
        if (keyboardEvent.key === "Enter" || keyboardEvent.key === " ") {
          keyboardEvent.preventDefault();
          openEditor(event.id);
        }
      });

      card.querySelector(".delete-button").addEventListener("click", (clickEvent) => {
        clickEvent.stopPropagation();
        deleteEvent(event.id);
      });
      dayList.appendChild(card);
    });

    timeline.appendChild(group);
  });

  rangeEvents.forEach((event) => {
    const range = document.createElement("article");
    range.className = "range-event";
    if (event.segment) range.classList.add(`range-segment-${event.segment}`);
    range.dataset.id = event.id;
    range.dataset.startDate = event.displayStartDate || event.startDate;
    range.dataset.endDate = event.displayEndDate || event.endDate;
    range.dataset.lane = String(event.displayLane);
    range.tabIndex = 0;
    range.style.setProperty("--range-color", isHistory ? "#959ba8" : event.color);
    range.innerHTML = `
      <span class="range-title"></span>
      <button class="range-delete-button" type="button" aria-label="删除事件">×</button>
    `;
    range.querySelector(".range-title").textContent = event.title;
    range.addEventListener("click", () => openEditor(event.id));
    range.addEventListener("keydown", (keyboardEvent) => {
      if (keyboardEvent.key === "Enter" || keyboardEvent.key === " ") {
        keyboardEvent.preventDefault();
        openEditor(event.id);
      }
    });
    range.querySelector(".range-delete-button").addEventListener("click", (clickEvent) => {
      clickEvent.stopPropagation();
      deleteEvent(event.id);
    });
    timeline.appendChild(range);
  });
  const laneCount = displayedEvents.length
    ? Math.max(...displayedEvents.map((event) => event.displayLane)) + 1
    : 0;
  timeline.style.setProperty("--lane-count", laneCount);
}

function scheduleTimelineFit() {
  window.cancelAnimationFrame(fitFrame);
  fitFrame = window.requestAnimationFrame(() => {
    prepareTimelineWidth(elements.timeline);
    prepareTimelineWidth(elements.historyTimeline);
    const currentScale = calculateTimelineScale(elements.timeline);
    const historyScale = calculateTimelineScale(elements.historyTimeline);
    const hasContinuousRange =
      elements.timeline.querySelector(".range-segment-remaining") &&
      elements.historyTimeline.querySelector(".range-segment-elapsed");
    const sharedScale = hasContinuousRange
      ? Math.min(currentScale, historyScale)
      : null;

    fitTimeline(elements.timeline, sharedScale ?? currentScale);
    fitTimeline(elements.historyTimeline, sharedScale ?? historyScale);
  });
}

function prepareTimelineWidth(timeline) {
  const area = timeline.parentElement;
  const sideSpace = window.innerWidth <= 760 ? 96 : 128;
  const baseWidth = Math.max(area.clientWidth - sideSpace, 1);
  timeline.dataset.baseWidth = String(baseWidth);
  timeline.style.width = `${baseWidth}px`;
}

function calculateTimelineScale(timeline) {
  const groups = [...timeline.querySelectorAll(".date-group")];
  const groupCount = groups.length;
  if (!groupCount) return 1;

  const eventElements = [
    ...timeline.querySelectorAll(".timeline-event, .range-event"),
  ];
  const laneCount = eventElements.length
    ? Math.max(...eventElements.map((event) => Number(event.dataset.lane))) + 1
    : 0;
  const totalEvents = eventElements.length;
  const area = timeline.parentElement;
  const availableWidth = Math.max(timeline.clientWidth - 16, 1);
  const availableHeight = Math.max(area.clientHeight - 24, 1);

  // Base dimensions describe the relaxed layout. The final scale is whichever
  // constraint is tighter: horizontal date count or the shared event lanes.
  const widthScale = availableWidth / (groupCount * 235);
  const heightScale = availableHeight / (86 + laneCount * 48);
  const relaxedScale = totalEvents <= 3 ? 1.24 : totalEvents <= 6 ? 1.08 : 1;
  return Math.max(0.01, Math.min(relaxedScale, widthScale, heightScale));
}

function fitTimeline(timeline, scale) {
  const groups = [...timeline.querySelectorAll(".date-group")];
  const groupCount = groups.length;
  if (!groupCount) return;
  const area = timeline.parentElement;
  const baseWidth = Number(timeline.dataset.baseWidth) || timeline.clientWidth;
  const effectiveScale = scale * manualZoom;
  timeline.style.width = `${baseWidth * manualZoom}px`;

  timeline.style.setProperty("--group-count", groupCount);
  timeline.style.setProperty("--timeline-scale", effectiveScale.toFixed(4));
  timeline.dataset.density =
    effectiveScale < 0.38 ? "tiny" : effectiveScale < 0.7 ? "compact" : "relaxed";

  const lineOffset = timeline.offsetTop + 50 * effectiveScale;
  area.style.setProperty("--timeline-line-y", `${lineOffset}px`);
  positionRangeEvents(timeline, effectiveScale);
}

function updateManualZoom(action) {
  if (action === "in") manualZoom = Math.min(3, manualZoom + 0.25);
  if (action === "out") manualZoom = Math.max(1, manualZoom - 0.25);
  if (action === "reset") manualZoom = 1;

  const zoomed = manualZoom > 1;
  [elements.timeline.parentElement, elements.historyTimeline.parentElement].forEach((area) => {
    area.classList.toggle("zoomed", zoomed);
    if (!zoomed) {
      area.scrollLeft = 0;
      area.scrollTop = 0;
    }
  });
  elements.zoomControls.forEach((controls) => {
    controls.querySelector(".zoom-reset").textContent =
      manualZoom === 1 ? "自动" : `${Math.round(manualZoom * 100)}%`;
  });
  scheduleTimelineFit();
}

function positionRangeEvents(timeline, scale) {
  const timelineRect = timeline.getBoundingClientRect();
  const pageRect = timeline.closest(".page").getBoundingClientRect();
  const groups = new Map(
    [...timeline.querySelectorAll(".date-group")].map((group) => [
      group.dataset.date,
      group.getBoundingClientRect(),
    ]),
  );

  timeline.querySelectorAll(".range-event").forEach((range) => {
    const start = groups.get(range.dataset.startDate);
    const end = groups.get(range.dataset.endDate);
    if (!start || !end) return;
    const lane = Number(range.dataset.lane);
    let left = start.left + start.width / 2 - timelineRect.left;
    let right = end.left + end.width / 2 - timelineRect.left;

    if (range.classList.contains("range-segment-elapsed")) {
      right = pageRect.right - timelineRect.left;
    }
    if (range.classList.contains("range-segment-remaining")) {
      left = pageRect.left - timelineRect.left;
    }

    range.style.left = `${left}px`;
    range.style.width = `${Math.max(right - left, 8 * scale)}px`;
    range.style.top = `${(89 + lane * 48) * scale}px`;
  });
}

function syncCurrentDate() {
  currentDateKey = localDateValue();
  renderTimeline();
  scheduleDateRefresh();
}

function scheduleDateRefresh() {
  window.clearTimeout(dateRefreshTimer);
  const now = new Date();
  const nextMidnight = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1,
    0,
    0,
    2,
  );
  dateRefreshTimer = window.setTimeout(syncCurrentDate, nextMidnight - now);
}

function showHistoryPage() {
  elements.pageTrack.classList.add("show-history");
  scheduleTimelineFit();
}

function showCurrentPage() {
  elements.pageTrack.classList.remove("show-history");
  scheduleTimelineFit();
}

function openEditor(id = "") {
  const event = events.find((item) => item.id === id);
  const isEditing = Boolean(event);
  elements.editingId.value = event?.id || "";
  elements.eventDate.value = event?.startDate || localDateValue();
  elements.eventTime.value = event?.startTime || currentTimeValue();
  elements.eventEndDate.value = event?.endDate || elements.eventDate.value;
  elements.eventEndTime.value = event?.endTime || elements.eventTime.value;
  syncEndMinimum();
  elements.eventTitle.value = event?.title || "";
  elements.eventDetail.value = event?.detail || "";
  elements.cancelButton.textContent = isEditing ? "保存" : "取消";
  elements.cancelButton.dataset.action = isEditing ? "save" : "cancel";
  elements.saveButton.textContent = isEditing ? "删除" : "保存";
  elements.saveButton.type = isEditing ? "button" : "submit";
  elements.saveButton.dataset.action = isEditing ? "delete" : "save";
  elements.saveButton.classList.toggle("danger-action", isEditing);
  updateCharCount();

  elements.editorPage.classList.add("open");
  elements.editorPage.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
  scheduleEditorFit();
  window.setTimeout(() => elements.eventTitle.focus({ preventScroll: true }), 220);
}

function scheduleEditorFit() {
  window.cancelAnimationFrame(editorFitFrame);
  editorFitFrame = window.requestAnimationFrame(fitEditor);
}

function fitEditor() {
  if (!elements.editorPage.classList.contains("open")) return;
  const form = elements.eventForm;
  form.style.setProperty("--editor-scale", 1);

  const availableWidth = Math.max(elements.editorPage.clientWidth - 32, 1);
  const availableHeight = Math.max(elements.editorPage.clientHeight - 92, 1);
  const widthScale = availableWidth / form.scrollWidth;
  const heightScale = availableHeight / form.scrollHeight;
  const scale = Math.min(1, widthScale, heightScale);

  form.style.setProperty("--editor-scale", scale.toFixed(4));
}

function closeEditor() {
  elements.editorPage.classList.remove("open");
  elements.editorPage.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
  elements.eventForm.reset();
  elements.editingId.value = "";
  resetFormActions();
  updateCharCount();
}

function resetFormActions() {
  elements.cancelButton.textContent = "取消";
  elements.cancelButton.dataset.action = "cancel";
  elements.saveButton.textContent = "保存";
  elements.saveButton.type = "submit";
  elements.saveButton.dataset.action = "save";
  elements.saveButton.classList.remove("danger-action");
}

function submitEvent(submitEvent) {
  submitEvent.preventDefault();
  const id = elements.editingId.value;
  const existing = events.find((event) => event.id === id);
  const eventData = {
    id: id || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    startDate: elements.eventDate.value,
    startTime: elements.eventTime.value,
    endDate: elements.eventEndDate.value,
    endTime: elements.eventEndTime.value,
    title: elements.eventTitle.value.trim(),
    detail: elements.eventDetail.value.trim(),
    color: existing?.color || COLORS[events.length % COLORS.length],
  };

  if (!eventData.title) {
    elements.eventTitle.focus();
    return;
  }

  if (eventEndTimestamp(eventData) < eventTimestamp(eventData)) {
    showToast("截止时间不能早于开始时间");
    elements.eventEndDate.focus();
    return;
  }

  if (id) {
    events = events.map((event) => (event.id === id ? eventData : event));
  } else {
    events.push(eventData);
  }

  saveEvents();
  closeEditor();
  clearSharedSearch();
  renderTimeline();
  if (eventData.endDate < currentDateKey) {
    showHistoryPage();
  } else {
    showCurrentPage();
  }
  showToast(id ? "修改已保存" : "已保存到时间轴");
}

function deleteEvent(id) {
  events = events.filter((event) => event.id !== id);
  saveEvents();
  renderTimeline();
  showToast("事件已删除");
}

function deleteEditingEvent() {
  const id = elements.editingId.value;
  if (!id) return;
  closeEditor();
  deleteEvent(id);
}

function handleLeftFormAction() {
  if (elements.cancelButton.dataset.action === "save") {
    elements.eventForm.requestSubmit();
  } else {
    closeEditor();
  }
}

function updateCharCount() {
  elements.charCount.textContent = `${elements.eventDetail.value.length}/500`;
}

function limitEventTitle() {
  const characters = Array.from(elements.eventTitle.value);
  if (characters.length > 8) {
    elements.eventTitle.value = characters.slice(0, 8).join("");
  }
}

function syncEndMinimum() {
  elements.eventEndDate.min = elements.eventDate.value;
  if (elements.eventEndDate.value < elements.eventDate.value) {
    elements.eventEndDate.value = elements.eventDate.value;
  }
  if (
    elements.eventEndDate.value === elements.eventDate.value &&
    elements.eventEndTime.value < elements.eventTime.value
  ) {
    elements.eventEndTime.value = elements.eventTime.value;
  }
}

function showToast(message) {
  window.clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add("show");
  toastTimer = window.setTimeout(() => elements.toast.classList.remove("show"), 1800);
}

async function lockLandscapeOrientation() {
  if (!screen.orientation?.lock) return;
  try {
    await screen.orientation.lock("landscape");
  } catch {
    // Orientation locking is usually allowed after installation or fullscreen launch.
  }
}

function registerOfflineApp() {
  if (!("serviceWorker" in navigator) || !/^https?:$/.test(location.protocol)) return;
  let refreshing = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js").catch(() => {});
  });
}

elements.addButton.addEventListener("click", () => openEditor());
elements.historyAddButton.addEventListener("click", () => openEditor());
elements.emptyAddButton.addEventListener("click", () => openEditor());
elements.showHistoryButton.addEventListener("click", showHistoryPage);
elements.showCurrentButton.addEventListener("click", showCurrentPage);
elements.backButton.addEventListener("click", closeEditor);
elements.cancelButton.addEventListener("click", handleLeftFormAction);
elements.saveButton.addEventListener("click", () => {
  if (elements.saveButton.dataset.action === "delete") deleteEditingEvent();
});
elements.eventForm.addEventListener("submit", submitEvent);
elements.eventDetail.addEventListener("input", updateCharCount);
elements.eventTitle.addEventListener("input", (event) => {
  if (!event.isComposing) limitEventTitle();
});
elements.eventTitle.addEventListener("compositionend", limitEventTitle);
elements.eventDate.addEventListener("change", syncEndMinimum);
elements.eventTime.addEventListener("change", syncEndMinimum);
elements.eventEndDate.addEventListener("invalid", () => {
  if (elements.eventEndDate.value < elements.eventDate.value) {
    showToast("截止时间不能早于开始时间");
  }
});
elements.searchInput.addEventListener("input", (event) => handleSharedSearch(event.target));
elements.historySearchInput.addEventListener("input", (event) => handleSharedSearch(event.target));
[elements.searchInput, elements.historySearchInput].forEach((input) => {
  input.addEventListener("focus", renderSearchResults);
});
[elements.searchResults, elements.historySearchResults].forEach((panel) => {
  panel.addEventListener("click", (event) => {
    const item = event.target.closest("[data-event-id]");
    if (item) locateSearchResult(item.dataset.eventId);
  });
});
document.addEventListener("click", (event) => {
  if (!event.target.closest(".search-shell")) closeSearchResults();
});
elements.zoomControls.forEach((controls) => {
  controls.addEventListener("click", (event) => {
    const action = event.target.closest("[data-zoom-action]")?.dataset.zoomAction;
    if (action) updateManualZoom(action);
  });
});
window.addEventListener("resize", scheduleTimelineFit);
window.addEventListener("resize", scheduleEditorFit);
new ResizeObserver(scheduleTimelineFit).observe(elements.timeline.parentElement);
new ResizeObserver(scheduleTimelineFit).observe(elements.historyTimeline.parentElement);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    syncCurrentDate();
    void lockLandscapeOrientation();
  }
});
elements.editorPage.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeEditor();
});

registerOfflineApp();
void initializeDurableStorage();
void lockLandscapeOrientation();
syncCurrentDate();
