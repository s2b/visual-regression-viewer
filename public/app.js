const STORAGE_KEY = "visual-regression-viewer-state";
const numberFormatter = new Intl.NumberFormat("en-US", { useGrouping: false });

const state = {
  report: null,
  filter: "all",
  sort: "fileOrder",
  selectedId: null,
  pinnedDeepLinkId: null,
  reviewState: "open",
  sitemapFilter: "all",
  view: "difference",
  showMinimap: true,
};

let activeScreenshotPreloads = [];

const els = {
  summary: document.querySelector("#summary"),
  results: document.querySelector("#results"),
  resultCount: document.querySelector("#resultCount"),
  acceptPassedButton: document.querySelector("#acceptPassedButton"),
  sortSelect: document.querySelector("#sortSelect"),
  statusSelect: document.querySelector("#statusSelect"),
  sitemapSelect: document.querySelector("#sitemapSelect"),
  reviewButtons: [...document.querySelectorAll(".reviewButton")],
  viewButtons: [...document.querySelectorAll(".viewButton")],
  initialState: document.querySelector("#initialState"),
  detailPane: document.querySelector(".detailPane"),
  detail: document.querySelector("#detail"),
  detailTitle: document.querySelector("#detailTitle"),
  detailMeta: document.querySelector("#detailMeta"),
  acceptedControl: document.querySelector("#acceptedControl"),
  acceptedToggle: document.querySelector("#acceptedToggle"),
  scheduleButton: document.querySelector("#scheduleButton"),
  updateReferenceToggle: document.querySelector("#updateReferenceToggle"),
  referenceUrl: document.querySelector("#referenceUrl"),
  subjectUrl: document.querySelector("#subjectUrl"),
  sitemapSources: document.querySelector("#sitemapSources"),
  viewControls: document.querySelector("#viewControls"),
  minimapToggle: document.querySelector("#minimapToggle"),
  showMinimap: document.querySelector("#showMinimap"),
  imageArea: document.querySelector("#imageArea"),
  metadataOnly: document.querySelector("#metadataOnly"),
};

function loadStoredState() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return;

    const stored = JSON.parse(raw);
    const reviewStates = new Set(["open", "accepted", "all"]);
    const sorts = new Set(["fileOrder", "pixelsDifferent", "percentDifferent", "diffScore", "time", "retries"]);
    const views = new Set(["difference", "side", "reference", "subject"]);

    if (typeof stored.filter === "string") state.filter = stored.filter;
    if (reviewStates.has(stored.reviewState)) state.reviewState = stored.reviewState;
    else if (typeof stored.openOnly === "boolean") state.reviewState = stored.openOnly ? "open" : "all";
    if (stored.sort === "diffScore") state.sort = "pixelsDifferent";
    else if (sorts.has(stored.sort)) state.sort = stored.sort;
    if (typeof stored.sitemapFilter === "string") state.sitemapFilter = stored.sitemapFilter;
    if (stored.view === "overlay") state.view = Number(stored.opacity) >= 50 ? "subject" : "reference";
    else if (stored.view === "side" && stored.showDiff === true) state.view = "difference";
    else if (views.has(stored.view)) state.view = stored.view;
    if (typeof stored.showMinimap === "boolean") state.showMinimap = stored.showMinimap;
  } catch {
    // Ignore malformed or unavailable session storage.
  }
}

function saveStoredState() {
  try {
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        filter: state.filter,
        reviewState: state.reviewState,
        sort: state.sort,
        sitemapFilter: state.sitemapFilter,
        view: state.view,
        showMinimap: state.showMinimap,
      })
    );
  } catch {
    // Ignore storage failures.
  }
}

function syncControls() {
  els.sortSelect.value = state.sort;
  els.statusSelect.value = state.filter;
  els.sitemapSelect.value = state.sitemapFilter;
  els.showMinimap.checked = state.showMinimap;

  for (const button of els.reviewButtons) {
    button.classList.toggle("isActive", button.dataset.reviewState === state.reviewState);
  }

  for (const button of els.viewButtons) {
    button.classList.toggle("isActive", button.dataset.view === state.view);
  }
}

function formatNumber(value) {
  return numberFormatter.format(value);
}

function formatTime(ms) {
  if (!Number.isFinite(ms)) return "n/a";
  return `${formatNumber(ms)} ms`;
}

function formatPercentage(value) {
  if (!Number.isFinite(value)) return null;
  return `${formatNumber(value)}%`;
}

function pathFromUrl(value) {
  try {
    const url = new URL(value);
    return `${url.pathname}${url.search}`;
  } catch {
    return value || "Untitled";
  }
}

function hostFromUrl(value) {
  try {
    return new URL(value).hostname;
  } catch {
    return value || "Unknown host";
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>\"]/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
  })[char]);
}

function deepLinkIdentifier(test) {
  return test?.identifier ? String(test.identifier) : String(test?.id ?? "");
}

function deepLinkHash(test) {
  return `#${encodeURIComponent(deepLinkIdentifier(test))}`;
}

function deepLinkUrl(test) {
  return `${window.location.pathname}${window.location.search}${deepLinkHash(test)}`;
}

function testFromHash() {
  if (!state.report || !window.location.hash) return null;

  let identifier;
  try {
    identifier = decodeURIComponent(window.location.hash.slice(1));
  } catch {
    identifier = window.location.hash.slice(1);
  }

  return state.report.tests.find((test) => deepLinkIdentifier(test) === identifier) || null;
}

function normalizeTest(test, order = test.order ?? 0) {
  const identifier = test.identifier ? String(test.identifier) : String(test.id ?? "");

  return {
    ...test,
    id: identifier,
    order,
  };
}

function normalizeReport(report) {
  return {
    ...report,
    tests: Array.isArray(report.tests) ? report.tests.map((test, index) => normalizeTest(test, index)) : [],
  };
}

function screenshotUrl(file) {
  if (!file) return null;
  return `/screenshots/${String(file).split("/").map(encodeURIComponent).join("/")}`;
}

function preloadSelectedScreenshots(test) {
  activeScreenshotPreloads = [];
  if (!test) return;

  const urls = [screenshotUrl(test.screenshotSubject), screenshotUrl(test.screenshotReference)].filter(Boolean);
  activeScreenshotPreloads = urls.map((url) => {
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    return image;
  });
}

function pixelsDifferent(test) {
  if (Number.isFinite(test.pixelsDifferent)) return test.pixelsDifferent;
  if (Number.isFinite(test.diffScore)) return test.diffScore;
  return null;
}

function compareFiniteDesc(aValue, bValue, aId, bId) {
  const aMissing = !Number.isFinite(aValue);
  const bMissing = !Number.isFinite(bValue);
  if (aMissing && bMissing) return aId - bId;
  if (aMissing) return 1;
  if (bMissing) return -1;
  return bValue - aValue || aId - bId;
}

function diffLabel(test) {
  const count = pixelsDifferent(test);
  if (!Number.isFinite(count)) return "n/a";

  const percentage = formatPercentage(test.percentDifferent);
  return percentage ? `${formatNumber(count)} px (${percentage})` : `${formatNumber(count)} px`;
}

function hasScreenshots(test) {
  return Boolean(test.screenshotReference || test.screenshotSubject || test.screenshotDiff);
}

function isScheduledLike(test) {
  return test.status === "scheduled" || Boolean(test.updateScreenshotReference);
}

function displayStatus(test) {
  return isScheduledLike(test) ? "scheduled" : test.status;
}

function isEffectivelyAccepted(test) {
  return Boolean(test.accepted) && !isScheduledLike(test);
}

function reviewClass(test) {
  if (isScheduledLike(test)) return null;
  if (isEffectivelyAccepted(test)) return "isAccepted";
  return "needsReview";
}

function reviewText(test) {
  if (isScheduledLike(test)) return null;
  if (isEffectivelyAccepted(test)) return "Accepted";
  return "Needs review";
}

function sitemapHost(value) {
  try {
    return new URL(value).hostname;
  } catch {
    return null;
  }
}

function sitemapPath(value) {
  try {
    const url = new URL(value);
    return url.pathname + url.search + url.hash;
  } catch {
    return value || "Unknown sitemap";
  }
}

function sharedSitemapHost() {
  const hosts = new Set();
  for (const test of state.report.tests) {
    if (test.sitemapUrl) hosts.add(sitemapHost(test.sitemapUrl));
  }

  if (!hosts.size) return null;
  if (hosts.size !== 1) return null;
  return [...hosts][0];
}

function sitemapLabel(value, hostToOmit = null) {
  if (!value) return "Unknown sitemap";

  const host = sitemapHost(value);
  if (hostToOmit && host && host === hostToOmit) {
    return sitemapPath(value);
  }

  try {
    const url = new URL(value);
    return url.origin + url.pathname + url.search + url.hash;
  } catch {
    return value;
  }
}

function allSitemapUrls() {
  const urls = new Set();
  for (const test of state.report.tests) {
    if (test.sitemapUrl) urls.add(test.sitemapUrl);
  }
  const hostToOmit = sharedSitemapHost();
  return [...urls].sort((a, b) => sitemapLabel(a, hostToOmit).localeCompare(sitemapLabel(b, hostToOmit)));
}

function sitemapSourceLabel(test, hostToOmit = sharedSitemapHost()) {
  return test.sitemapUrl ? sitemapLabel(test.sitemapUrl, hostToOmit) : "No sitemap";
}

function sortedTests() {
  const tests = state.report.tests.filter((test) => {
    const matchesStatus = state.filter === "all" || displayStatus(test) === state.filter;
    const matchesReviewState =
      state.reviewState === "all" ||
      (state.reviewState === "open" && !isEffectivelyAccepted(test)) ||
      (state.reviewState === "accepted" && isEffectivelyAccepted(test));
    const matchesSitemap = state.sitemapFilter === "all" || test.sitemapUrl === state.sitemapFilter;
    return matchesStatus && matchesReviewState && matchesSitemap;
  });

  return tests.sort((a, b) => {
    if (state.sort === "fileOrder") {
      return a.order - b.order;
    }

    if (state.sort === "pixelsDifferent") {
      return compareFiniteDesc(pixelsDifferent(a), pixelsDifferent(b), a.order, b.order);
    }

    if (state.sort === "percentDifferent") {
      return compareFiniteDesc(a.percentDifferent, b.percentDifferent, a.order, b.order);
    }

    const av = a[state.sort] ?? 0;
    const bv = b[state.sort] ?? 0;
    return bv - av || a.order - b.order;
  });
}

function renderSitemapFilter() {
  const urls = allSitemapUrls();
  const currentExists = state.sitemapFilter === "all" || urls.includes(state.sitemapFilter);
  if (!currentExists) state.sitemapFilter = "all";
  const hostToOmit = sharedSitemapHost();

  els.sitemapSelect.innerHTML = [
    "<option value=\"all\">All sitemaps</option>",
    ...urls.map((url) =>
      "<option value=\"" + escapeHtml(url) + "\">" + escapeHtml(sitemapLabel(url, hostToOmit)) + "</option>"
    ),
  ].join("");
}

function allStatusValues() {
  const statuses = new Set();
  for (const test of state.report.tests) {
    const status = displayStatus(test);
    if (typeof status === "string" && status) statuses.add(status);
  }
  return [...statuses];
}

function renderStatusFilter() {
  const statuses = allStatusValues();
  const currentExists = state.filter === "all" || statuses.includes(state.filter);
  if (!currentExists) state.filter = "all";

  els.statusSelect.innerHTML = [
    "<option value=\"all\">All</option>",
    ...statuses.map((status) =>
      "<option value=\"" + escapeHtml(status) + "\">" + escapeHtml(status) + "</option>"
    ),
  ].join("");
}

function renderSummary() {
  const tests = state.report.tests;
  const counts = tests.reduce(
    (acc, test) => {
      acc.total += 1;
      if (isEffectivelyAccepted(test)) acc.accepted += 1;
      else acc.unaccepted += 1;
      return acc;
    },
    { total: 0, accepted: 0, unaccepted: 0 }
  );

  const acceptedPercent = counts.total ? Math.round((counts.accepted / counts.total) * 100) : 0;
  const acceptedWidth = counts.total ? (counts.accepted / counts.total) * 100 : 0;

  els.summary.innerHTML = `
    <div class="acceptanceSummary">
      <div class="acceptanceHeader">
        <span class="acceptanceMetric accepted">
          <strong>${formatNumber(counts.accepted)}</strong>
          <span>Accepted</span>
        </span>
        <span class="acceptancePercent">${acceptedPercent}%</span>
        <span class="acceptanceMetric open">
          <strong>${formatNumber(counts.unaccepted)}</strong>
          <span>Needs review</span>
        </span>
      </div>
      <div
        class="acceptanceBar"
        role="progressbar"
        aria-label="Accepted results"
        aria-valuemin="0"
        aria-valuemax="${counts.total}"
        aria-valuenow="${counts.accepted}"
        aria-valuetext="${formatNumber(counts.accepted)} accepted, ${formatNumber(counts.unaccepted)} need review"
      >
        <span class="acceptanceFill" style="width: ${acceptedWidth}%"></span>
      </div>
    </div>
  `;
}

function resultRow(test, hostToOmit, options = {}) {
  const button = document.createElement("button");
  const reviewStatus = reviewText(test);
  const status = displayStatus(test);
  button.type = "button";
  button.className = [
    "resultRow",
    test.id === state.selectedId ? "isSelected" : "",
    options.outOfFilter ? "isOutOfFilter" : "",
  ].filter(Boolean).join(" ");
  button.dataset.id = test.id;
  button.innerHTML = `
    <div class="resultMain">
      <div class="rowTop">
        <div class="path">${pathFromUrl(test.referenceUrl)}</div>
        <span class="statusPill ${status}">${status}</span>
      </div>
      <div class="rowMeta">
        <span>${formatTime(test.time)}</span>
        <span>${formatNumber(test.retries || 0)} retries</span>
        <span>Diff ${diffLabel(test)}</span>
      </div>
      <div class="rowFooter">
        <span class="sitemapSource">Sitemap ${escapeHtml(sitemapSourceLabel(test, hostToOmit))}</span>
        ${reviewStatus ? `<span class="acceptedText ${reviewClass(test)}">${reviewStatus}</span>` : ""}
      </div>
      ${options.outOfFilter ? "<div class=\"filterMismatchNotice\">Does not match current filters</div>" : ""}
    </div>
  `;
  button.addEventListener("click", () => selectTest(test.id));
  return button;
}

function renderResults() {
  const tests = sortedTests();
  const unacceptedPassed = state.report.tests.filter((test) => displayStatus(test) === "passed" && !isEffectivelyAccepted(test)).length;
  const hostToOmit = sharedSitemapHost();
  els.resultCount.textContent = `${formatNumber(tests.length)} result${tests.length === 1 ? "" : "s"}`;
  els.acceptPassedButton.disabled = unacceptedPassed === 0;
  els.acceptPassedButton.textContent = unacceptedPassed
    ? `Accept passed (${formatNumber(unacceptedPassed)})`
    : "Accept passed";
  els.results.innerHTML = "";

  const fragment = document.createDocumentFragment();
  const selected = selectedTest();
  if (selected && selected.id === state.pinnedDeepLinkId && !tests.some((test) => test.id === selected.id)) {
    fragment.append(resultRow(selected, hostToOmit, { outOfFilter: true }));
  }

  for (const test of tests) {
    fragment.append(resultRow(test, hostToOmit));
  }

  els.results.append(fragment);
}

function syncResultSelection(previousId = null) {
  if (previousId !== null) {
    const previous = [...els.results.querySelectorAll(".resultRow")].find((row) => row.dataset.id === String(previousId));
    if (previous) previous.classList.remove("isSelected");
  }

  if (state.selectedId !== null) {
    const current = [...els.results.querySelectorAll(".resultRow")].find((row) => row.dataset.id === String(state.selectedId));
    if (current) current.classList.add("isSelected");
  }
}

function setLink(el, value) {
  el.href = value || "#";
  el.textContent = value || "n/a";
}

function renderSitemapSources(test) {
  if (!test.sitemapUrl) {
    els.sitemapSources.innerHTML = "";
    return;
  }

  els.sitemapSources.innerHTML = "<span class=\"detailUrlLabel\">Sitemap</span><div class=\"sitemapLinkList\"><a href=\"" + escapeHtml(test.sitemapUrl) + "\" target=\"_blank\" rel=\"noreferrer\">" + escapeHtml(test.sitemapUrl) + "</a></div>";
}

function screenshotLink(src, alt, className = "", style = "") {
  const safeSrc = escapeHtml(src);
  const safeAlt = escapeHtml(alt);
  const classAttr = className ? ` class="${escapeHtml(className)}"` : "";
  const styleAttr = style ? ` style="${escapeHtml(style)}"` : "";

  return `
    <a class="screenshotLink" href="${safeSrc}" target="_blank" rel="noreferrer">
      <img src="${safeSrc}" alt="${safeAlt}"${classAttr}${styleAttr}>
    </a>
  `;
}

function cssUrl(value) {
  return String(value).replace(/["\\\n\r\f]/g, "\\$&");
}

function minimapAttributes(src) {
  if (!src) return {};
  return {
    className: "hasMinimap",
    src,
    style: `--screenshot-minimap: url("${cssUrl(src)}")`,
  };
}

function panel(title, src, className = "", badge = "") {
  const safeTitle = escapeHtml(title);
  const badgeMarkup = badge ? `<span class="panelBadge">${escapeHtml(badge)}</span>` : "";

  return `
    <section class="imagePanel ${className}">
      <h2><span>${safeTitle}</span>${badgeMarkup}</h2>
      ${screenshotLink(src, `${title} screenshot`)}
    </section>
  `;
}

function renderImages(test) {
  els.imageArea.innerHTML = "";
  const hasImages = hasScreenshots(test);
  els.metadataOnly.hidden = hasImages;
  els.viewControls.hidden = !hasImages;

  if (!hasImages) return;

  const referenceSrc = screenshotUrl(test.screenshotReference);
  const subjectSrc = screenshotUrl(test.screenshotSubject);
  const diffSrc = screenshotUrl(test.screenshotDiff);
  const minimapSrc = state.showMinimap ? screenshotUrl(test.screenshotMinimap) : null;
  const referenceTitle = `${hostFromUrl(test.referenceUrl)} (reference)`;
  const subjectTitle = `${hostFromUrl(test.subjectUrl)} (subject)`;
  const referenceWillUpdate = Boolean(test.updateScreenshotReference);
  const activeView =
    (state.view === "reference" && referenceSrc) || (state.view === "subject" && subjectSrc)
      ? state.view
      : state.view === "side"
        ? "side"
        : "difference";
  els.minimapToggle.hidden = !test.screenshotMinimap;

  const parts = [];
  if (activeView === "reference" || activeView === "subject") {
    const src = activeView === "reference" ? referenceSrc : subjectSrc;
    const title = activeView === "reference" ? referenceTitle : subjectTitle;
    const minimap = minimapAttributes(minimapSrc);
    parts.push(`
      <section class="singlePanel ${referenceWillUpdate && activeView === "reference" ? "willUpdateReference" : ""}" aria-label="${activeView} screenshot">
        <h2><span>${escapeHtml(title)}</span>${referenceWillUpdate && activeView === "reference" ? "<span class=\"panelBadge\">Will update</span>" : ""}</h2>
        <div class="singleComparison ${minimap.className || ""}">
          ${screenshotLink(src, `${title} screenshot`)}
          ${minimap.style ? `<div class="singleMinimap" style="${escapeHtml(minimap.style)}" aria-hidden="true"></div>` : ""}
        </div>
      </section>
    `);
  } else {
    const minimap = minimapAttributes(minimapSrc);
    const diffPanel = activeView === "difference" && diffSrc ? panel("Difference", diffSrc, "diffPanel") : "";
    parts.push(`
      <div class="sideGrid ${diffPanel ? "hasDiff" : ""} ${minimap.className || ""}">
        ${subjectSrc ? panel(subjectTitle, subjectSrc) : ""}
        ${diffPanel}
        ${referenceSrc ? panel(referenceTitle, referenceSrc, referenceWillUpdate ? "willUpdateReference" : "", referenceWillUpdate ? "Will update" : "") : ""}
        ${minimap.style ? `
          <section class="sideMinimapPanel" aria-hidden="true">
            <h2><span></span></h2>
            <div class="sideMinimap" style="${escapeHtml(minimap.style)}"></div>
          </section>
        ` : ""}
      </div>
    `);
  }

  els.imageArea.innerHTML = parts.join("");
}

function renderDetail() {
  const test = selectedTest();
  if (!test) {
    els.initialState.hidden = false;
    els.detail.hidden = true;
    return;
  }

  els.initialState.hidden = true;
  els.detail.hidden = false;
  els.detailTitle.textContent = pathFromUrl(test.referenceUrl);
  const status = displayStatus(test);
  els.detailMeta.innerHTML = `
    <span class="statusPill ${status}">${status}</span>
    <span><strong>Time</strong> ${formatTime(test.time)}</span>
    <span><strong>Retries</strong> ${formatNumber(test.retries || 0)}</span>
    <span><strong>Diff</strong> ${diffLabel(test)}</span>
  `;
  els.acceptedToggle.checked = Boolean(test.accepted);
  els.acceptedControl.hidden = isScheduledLike(test);
  els.scheduleButton.disabled = isScheduledLike(test);
  els.scheduleButton.innerHTML = isScheduledLike(test) ? "Scheduled" : "Schedule rerun <kbd class=\"shortcutKey\">r</kbd>";
  els.updateReferenceToggle.checked = Boolean(test.updateScreenshotReference);
  setLink(els.referenceUrl, test.referenceUrl);
  setLink(els.subjectUrl, test.subjectUrl);
  renderSitemapSources(test);
  renderImages(test);
}

function render() {
  renderStatusFilter();
  renderSitemapFilter();
  syncControls();
  saveStoredState();
  renderSummary();
  renderResults();
  renderDetail();
}

function renderViewOnly(test) {
  const scrollTop = els.detailPane.scrollTop;
  syncControls();
  saveStoredState();
  renderImages(test);
  preserveDetailScroll(scrollTop);
}

function preserveDetailScroll(scrollTop) {
  const restore = () => {
    els.detailPane.scrollTop = scrollTop;
  };

  restore();
  requestAnimationFrame(() => {
    restore();
    requestAnimationFrame(restore);
  });

  for (const image of els.imageArea.querySelectorAll("img")) {
    if (image.complete) continue;
    image.addEventListener("load", restore, { once: true });
    image.addEventListener("error", restore, { once: true });
  }
}

function selectTest(id, options = {}) {
  const previousId = state.selectedId;
  state.selectedId = id;
  const test = selectedTest();
  preloadSelectedScreenshots(test);
  if (!options.fromDeepLink && id !== state.pinnedDeepLinkId) state.pinnedDeepLinkId = null;
  syncResultSelection(previousId);
  renderResults();
  renderDetail();
  if (options.updateUrl !== false) updateLocationHash(test, options.replace);
}

function selectedTest() {
  return state.report.tests.find((item) => item.id === state.selectedId) || null;
}

function updateLocationHash(test, replace = false) {
  if (!test) return;

  const url = deepLinkUrl(test);
  if (`${window.location.pathname}${window.location.search}${window.location.hash}` === url) return;

  const method = replace ? "replaceState" : "pushState";
  window.history[method](null, "", url);
}

function selectTestFromHash() {
  if (!window.location.hash) {
    const previousId = state.selectedId;
    state.selectedId = null;
    state.pinnedDeepLinkId = null;
    preloadSelectedScreenshots(null);
    syncResultSelection(previousId);
    renderResults();
    renderDetail();
    return;
  }

  const test = testFromHash();
  if (!test) return;

  if (test.id === state.selectedId) {
    state.pinnedDeepLinkId = test.id;
    preloadSelectedScreenshots(test);
    renderResults();
    return;
  }

  const previousId = state.selectedId;
  state.selectedId = test.id;
  state.pinnedDeepLinkId = test.id;
  preloadSelectedScreenshots(test);
  syncResultSelection(previousId);
  renderResults();
  renderDetail();
}

async function updateAccepted(accepted) {
  return updateSelectedTest(
    { accepted },
    {
      errorLabel: "accepted state",
      advanceOnFilterOut: true,
    }
  );
}

async function updateSelectedTest(patch, options = {}) {
  const test = selectedTest();
  if (!test) return;

  const previousPinnedDeepLinkId = state.pinnedDeepLinkId;
  const visibleBefore = sortedTests();
  const currentIndex = visibleBefore.findIndex((item) => item.id === test.id);
  const nextSelectionId = currentIndex === -1
    ? null
    : visibleBefore[currentIndex + 1]?.id ?? visibleBefore[currentIndex - 1]?.id ?? null;

  const previous = {};
  for (const key of Object.keys(patch)) {
    previous[key] = Object.prototype.hasOwnProperty.call(test, key) ? test[key] : undefined;
  }
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete test[key];
    else test[key] = value;
  }
  if (options.pinOnFilterOut) {
    state.pinnedDeepLinkId = sortedTests().some((item) => item.id === test.id) ? null : test.id;
  }
  render();

  try {
    const response = await fetch(`/tests/${encodeURIComponent(test.id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!response.ok) throw new Error(await response.text());
    const payload = await response.json();
    Object.assign(test, normalizeTest(payload.test, test.order));
    if (options.pinOnFilterOut) {
      state.pinnedDeepLinkId = sortedTests().some((item) => item.id === test.id) ? null : test.id;
    }
    if (options.advanceOnFilterOut && !sortedTests().some((item) => item.id === test.id) && nextSelectionId !== null) {
      state.selectedId = nextSelectionId;
      state.pinnedDeepLinkId = null;
      preloadSelectedScreenshots(selectedTest());
      updateLocationHash(selectedTest());
    }
    render();
  } catch (error) {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete test[key];
      else test[key] = value;
    }
    state.pinnedDeepLinkId = previousPinnedDeepLinkId;
    render();
    alert(`Could not update ${options.errorLabel || "test"}: ${error.message}`);
  }
}

async function scheduleSelectedTest() {
  await updateSelectedTest(
    { status: "scheduled", accepted: false },
    {
      errorLabel: "schedule state",
      advanceOnFilterOut: true,
    }
  );
}

async function updateReferenceRequest(updateScreenshotReference) {
  await updateSelectedTest(
    { updateScreenshotReference },
    {
      errorLabel: "reference update request",
      pinOnFilterOut: true,
    }
  );
}

async function acceptPassed() {
  const count = state.report.tests.filter((test) => displayStatus(test) === "passed" && !isEffectivelyAccepted(test)).length;
  if (!count) return;
  if (!confirm(`Accept ${formatNumber(count)} passed result${count === 1 ? "" : "s"}?`)) return;

  els.acceptPassedButton.disabled = true;
  els.acceptPassedButton.textContent = "Accepting...";

  try {
    const response = await fetch("/tests/accept-passed", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accepted: true }),
    });
    if (!response.ok) throw new Error(await response.text());
    state.report = await fetchReport();
    render();
  } catch (error) {
    render();
    alert(`Could not accept passed results: ${error.message}`);
  }
}

function handleKeyboardShortcuts(event) {
  if (!state.report) return;
  if (event.metaKey || event.ctrlKey || event.altKey) return;

  const target = event.target;
  const isActionShortcut =
    event.key === "a" ||
    event.key === "A" ||
    event.key === "r" ||
    event.key === "R" ||
    event.key === "1" ||
    event.key === "2" ||
    event.key === "3" ||
    event.key === "4";
  const isEditable =
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable);

  if (isEditable) return;

  if (event.key === "a" || event.key === "A") {
    const test = selectedTest();
    if (!test || isScheduledLike(test)) return;
    event.preventDefault();
    updateAccepted(!test.accepted);
    return;
  }

  if (event.key === "r" || event.key === "R") {
    const test = selectedTest();
    if (!test || isScheduledLike(test)) return;
    event.preventDefault();
    scheduleSelectedTest();
    return;
  }

  if (event.key === "1" || event.key === "2" || event.key === "3" || event.key === "4") {
    const test = selectedTest();
    event.preventDefault();
    if (!test || (event.key === "3" && !test.screenshotSubject) || (event.key === "4" && !test.screenshotReference)) return;
    if (event.key === "1") state.view = "difference";
    else if (event.key === "2") state.view = "side";
    else state.view = event.key === "3" ? "subject" : "reference";
    renderViewOnly(test);
    return;
  }

  if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;

  const tests = sortedTests();
  if (!tests.length) return;

  const currentIndex = tests.findIndex((test) => test.id === state.selectedId);
  const fallbackIndex = event.key === "ArrowDown" ? 0 : tests.length - 1;
  const nextIndex =
    currentIndex === -1
      ? fallbackIndex
      : event.key === "ArrowDown"
        ? Math.min(currentIndex + 1, tests.length - 1)
        : Math.max(currentIndex - 1, 0);

  if (nextIndex === currentIndex) return;

  event.preventDefault();
  selectTest(tests[nextIndex].id);
}


function bindEvents() {
  document.addEventListener("keydown", handleKeyboardShortcuts);
  window.addEventListener("hashchange", selectTestFromHash);
  window.addEventListener("popstate", selectTestFromHash);

  for (const button of els.reviewButtons) {
    button.addEventListener("click", () => {
      state.reviewState = button.dataset.reviewState;
      render();
    });
  }

  for (const button of els.viewButtons) {
    button.addEventListener("click", () => {
      state.view = button.dataset.view;
      const test = selectedTest();
      if (test) renderViewOnly(test);
      else render();
    });
  }

  els.sortSelect.addEventListener("change", () => {
    state.sort = els.sortSelect.value;
    render();
  });

  els.acceptPassedButton.addEventListener("click", () => {
    acceptPassed();
  });

  els.statusSelect.addEventListener("change", () => {
    state.filter = els.statusSelect.value;
    render();
  });

  els.sitemapSelect.addEventListener("change", () => {
    state.sitemapFilter = els.sitemapSelect.value;
    render();
  });

  els.acceptedToggle.addEventListener("change", () => {
    updateAccepted(els.acceptedToggle.checked);
  });

  els.scheduleButton.addEventListener("click", () => {
    scheduleSelectedTest();
  });

  els.updateReferenceToggle.addEventListener("change", () => {
    updateReferenceRequest(els.updateReferenceToggle.checked);
  });

  els.showMinimap.addEventListener("change", () => {
    state.showMinimap = els.showMinimap.checked;
    render();
  });
}

async function init() {
  loadStoredState();
  bindEvents();
  state.report = await fetchReport();
  const linkedTest = testFromHash();
  state.selectedId = linkedTest?.id ?? null;
  state.pinnedDeepLinkId = linkedTest?.id ?? null;
  preloadSelectedScreenshots(linkedTest);
  render();
}

async function fetchReport() {
  const response = await fetch("/report");
  if (!response.ok) throw new Error(await response.text());
  return normalizeReport(await response.json());
}

init().catch((error) => {
  els.initialState.textContent = error.message;
});
