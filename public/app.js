const form = document.getElementById("events-form");
const submitButton = document.getElementById("submit-button");
const statusText = document.getElementById("status-text");
const resultCard = document.getElementById("result-card");
const conversationField = document.getElementById("conversationId");
const scoutButtons = document.querySelectorAll("[data-target], [data-prefill]");
const navItems = document.querySelectorAll('.nav-item[href^="#"]');
const subjectForm = document.getElementById("subject-form");
const subjectSubmitButton = document.getElementById("subject-submit-button");
const subjectStatusText = document.getElementById("subject-status-text");
const subjectResultCard = document.getElementById("subject-result-card");
const transportStatusPill = document.getElementById("transport-status-pill");
const transportRefreshButton = document.getElementById("transport-refresh");
const transportSummaryMain = document.getElementById("transport-summary-main");
const transportSummaryCopy = document.getElementById("transport-summary-copy");
const transportLastChecked = document.getElementById("transport-last-checked");
const transportNextCheck = document.getElementById("transport-next-check");
const transportResultCard = document.getElementById("transport-result-card");
const backToTopButton = document.getElementById("back-to-top");
const mainShell = document.querySelector(".main-shell");
const TRANSPORT_REFRESH_MS = 3 * 60 * 1000;

const savedConversationId = sessionStorage.getItem("difyConversationId");
if (savedConversationId && !conversationField.value) {
  conversationField.value = savedConversationId;
}

for (const button of scoutButtons) {
  button.addEventListener("click", () => {
    const targetId = button.dataset.target || "event-search";
    const target = document.getElementById(targetId);

    if (button.dataset.prefill) {
      form.interests.value = button.dataset.prefill;
    }

    scrollSectionIntoView(target);

    if (targetId === "event-search") {
      form.interests.focus();
      return;
    }

    if (targetId === "subject-guide") {
      document.getElementById("subjectName")?.focus();
      return;
    }

    if (targetId === "transport-detector") {
      transportRefreshButton?.focus();
    }
  });
}

for (const navItem of navItems) {
  navItem.addEventListener("click", event => {
    const href = navItem.getAttribute("href") || "";
    const target = href.startsWith("#") ? document.querySelector(href) : null;

    if (!target) {
      return;
    }

    event.preventDefault();
    scrollSectionIntoView(target);
    history.replaceState(null, "", href);
  });
}

transportRefreshButton?.addEventListener("click", () => {
  refreshTransportDetector(true);
});

backToTopButton?.addEventListener("click", () => {
  if (mainShell && window.innerWidth > 900) {
    mainShell.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }

  window.scrollTo({ top: 0, behavior: "smooth" });
});

mainShell?.addEventListener("scroll", toggleBackToTopButton, { passive: true });
window.addEventListener("scroll", toggleBackToTopButton, { passive: true });
toggleBackToTopButton();

refreshTransportDetector(false);
setInterval(() => {
  refreshTransportDetector(false);
}, TRANSPORT_REFRESH_MS);

form.addEventListener("submit", async event => {
  event.preventDefault();

  const payload = {
    interests: form.interests.value,
    dateRange: form.dateRange.value,
    city: form.city.value,
    maxEvents: form.maxEvents.value,
    notes: form.notes.value,
    conversationId: form.conversationId.value
  };

  setLoading(true);
  setResult('<div class="status-badge">Searching upcoming events</div>');
  statusText.textContent = "Waiting for your Dify agent...";

  try {
    const response = await fetch("/api/events", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!response.ok) {
      const details = typeof data.details === "string"
        ? data.details
        : JSON.stringify(data.details || {}, null, 2);

      throw new Error(`${data.error || "Request failed"}${details ? `\n\n${details}` : ""}`);
    }

    if (data.conversationId) {
      conversationField.value = data.conversationId;
      sessionStorage.setItem("difyConversationId", data.conversationId);
    }

    setResult(renderMarkdown(data.answer || "No answer returned."));
    statusText.textContent = "Results ready. You can refine the query and search again.";
  } catch (error) {
    setResult(`
      <h3>Something went wrong</h3>
      <pre>${escapeHtml(error.message || "Unknown error")}</pre>
    `);
    statusText.textContent = "The request failed. Check your Dify config and try again.";
  } finally {
    setLoading(false);
  }
});

subjectForm?.addEventListener("submit", async event => {
  event.preventDefault();

  const payload = {
    subject: subjectForm.subject.value,
    degree: subjectForm.degree.value
  };

  setSubjectLoading(true);
  setSubjectResult('<div class="status-badge">Generating subject guidance</div>');
  subjectStatusText.textContent = "Talking to Subject Guide...";

  try {
    const response = await fetch("/api/subject-guide", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!response.ok) {
      const details = typeof data.details === "string"
        ? data.details
        : JSON.stringify(data.details || {}, null, 2);

      throw new Error(`${data.error || "Subject Guide failed"}${details ? `\n\n${details}` : ""}`);
    }

    setSubjectResult(renderSubjectGuide(data.answer || "No answer returned."));
    subjectStatusText.textContent = "Guidance ready.";
  } catch (error) {
    setSubjectResult(`
      <h3>Something went wrong</h3>
      <pre>${escapeHtml(error.message || "Unknown error")}</pre>
    `);
    subjectStatusText.textContent = "The request failed. Check your Dify config and try again.";
  } finally {
    setSubjectLoading(false);
  }
});

function setLoading(isLoading) {
  submitButton.disabled = isLoading;
  submitButton.textContent = isLoading ? "Finding Events..." : "Find Events";
}

function setSubjectLoading(isLoading) {
  subjectSubmitButton.disabled = isLoading;
  subjectSubmitButton.textContent = isLoading ? "Generating..." : "Get Subject Guide";
}

async function refreshTransportDetector(isManual) {
  setTransportPending(isManual ? "Refreshing now" : "Auto-checking");

  try {
    const response = await fetch("/api/transport");
    const data = await response.json();

    if (!response.ok) {
      const details = typeof data.details === "string"
        ? data.details
        : JSON.stringify(data.details || {}, null, 2);

      throw new Error(`${data.error || "Transport detector failed"}${details ? `\n\n${details}` : ""}`);
    }

    renderTransportReport(data.answer || "");
    const now = new Date();
    transportLastChecked.textContent = `Last checked: ${formatTime(now)}`;
    transportNextCheck.textContent = `Next auto-check: ${formatRelativeFuture(new Date(now.getTime() + TRANSPORT_REFRESH_MS))}`;
  } catch (error) {
    transportStatusPill.className = "status-pill disruption";
    transportStatusPill.textContent = "Detector error";
    transportSummaryMain.textContent = "Transport monitor unavailable";
    transportSummaryCopy.textContent = "The MVG detector request failed. Check the transport Dify agent configuration.";
    transportResultCard.innerHTML = `
      <div class="transport-report-shell">
        <div class="transport-banner disruption">Transport detector error</div>
        <div class="transport-summary-line">
          <pre>${escapeHtml(error.message || "Unknown error")}</pre>
        </div>
      </div>
    `;
  }
}

function setTransportPending(label) {
  transportStatusPill.className = "status-pill neutral";
  transportStatusPill.textContent = label;
}

function renderTransportReport(answer) {
  const parsed = parseTransportReport(answer);
  const status = parsed.status || "normal";
  transportStatusPill.className = `status-pill ${statusClass(status)}`;
  transportStatusPill.textContent = transportStatusLabel(status);
  transportSummaryMain.textContent = transportHeadline(status);
  transportSummaryCopy.textContent = parsed.summary || "No summary returned by the transport detector.";

  const issuesHtml = parsed.issues.length
    ? parsed.issues.map(issue => `
      <article class="transport-issue">
        <h3>${escapeHtml(issue.lineArea || "General MVG update")}</h3>
        <p><strong>Issue:</strong> ${escapeHtml(issue.issue || "Not specified")}</p>
        <p><strong>Impact:</strong> ${escapeHtml(issue.impact || "No impact details")}</p>
        <p><strong>Advice:</strong> ${escapeHtml(issue.advice || "No advice provided")}</p>
      </article>
    `).join("")
    : `<article class="transport-issue"><h3>All clear</h3><p>No significant MVG constraints were reported.</p></article>`;

  transportResultCard.innerHTML = `
    <div class="transport-report-shell">
      <div class="transport-banner ${statusClass(status)}">${escapeHtml(transportStatusLabel(status))}</div>
      <div class="transport-summary-line">${escapeHtml(parsed.summary || "No summary returned.")}</div>
      <div class="transport-issues">${issuesHtml}</div>
    </div>
  `;
}

function parseTransportReport(answer) {
  const text = String(answer || "").trim();
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const statusLine = lines.find(line => /^status:/i.test(line)) || "";
  const summaryLine = lines.find(line => /^summary:/i.test(line)) || "";
  const issueLines = lines.filter(line => line.startsWith("- "));

  return {
    status: cleanMarkdownDecorators(statusLine.replace(/^status:\s*/i, "")).toLowerCase(),
    summary: cleanMarkdownDecorators(summaryLine.replace(/^summary:\s*/i, "")),
    issues: issueLines.map(parseTransportIssue)
  };
}

function parseTransportIssue(line) {
  const cleaned = cleanMarkdownDecorators(line.replace(/^- /, ""));
  const parts = cleaned.split("|").map(part => part.trim());
  const result = {
    lineArea: "",
    issue: "",
    impact: "",
    advice: ""
  };

  for (const part of parts) {
    const [rawKey, ...rest] = part.split(":");
    const key = (rawKey || "").trim().toLowerCase();
    const value = rest.join(":").trim();

    if (key === "line/area") {
      result.lineArea = value;
    } else if (key === "issue") {
      result.issue = value;
    } else if (key === "impact") {
      result.impact = value;
    } else if (key === "advice") {
      result.advice = value;
    }
  }

  return result;
}

function statusClass(status) {
  if (status === "warning") {
    return "warning";
  }

  if (status === "disruption") {
    return "disruption";
  }

  return "good";
}

function transportStatusLabel(status) {
  if (status === "warning") {
    return "Warning";
  }

  if (status === "disruption") {
    return "Disruption";
  }

  return "Normal";
}

function transportHeadline(status) {
  if (status === "warning") {
    return "Some MVG constraints detected";
  }

  if (status === "disruption") {
    return "Major transport disruption detected";
  }

  return "MVG service looks stable";
}

function formatTime(date) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function formatRelativeFuture(date) {
  return `around ${formatTime(date)}`;
}

function toggleBackToTopButton() {
  if (!backToTopButton) {
    return;
  }

  const scrollTop = mainShell && window.innerWidth > 900 ? mainShell.scrollTop : window.scrollY;
  backToTopButton.classList.toggle("visible", scrollTop > 320);
}

function scrollSectionIntoView(target) {
  if (!target) {
    return;
  }

  if (mainShell && window.innerWidth > 900) {
    const top = target.offsetTop - 24;
    mainShell.scrollTo({ top, behavior: "smooth" });
    return;
  }

  target.scrollIntoView({ behavior: "smooth", block: "start" });
}

function setResult(html) {
  resultCard.classList.remove("empty");
  resultCard.innerHTML = html;
}

function setSubjectResult(html) {
  subjectResultCard.classList.remove("empty");
  subjectResultCard.innerHTML = html;
}

function renderMarkdown(markdown) {
  const rich = renderEventCards(markdown);
  if (rich) {
    return rich;
  }

  const blocks = escapeHtml(markdown).split(/\n\s*\n/);

  return blocks.map(renderBlock).join("");
}

function renderSubjectGuide(markdown) {
  const parsed = parseSubjectGuide(markdown);
  if (!parsed) {
    return renderMarkdown(markdown);
  }

  const tipsHtml = parsed.tips.map(tip => `
    <article class="subject-tip-card">
      <h3>${escapeHtml(tip.area || "Study area")}</h3>
      <div class="subject-field">
        <strong>Tip</strong>
        <p>${escapeHtml(tip.tip || "No tip provided.")}</p>
      </div>
      <div class="subject-field">
        <strong>Why it helps</strong>
        <p>${escapeHtml(tip.why || "No explanation provided.")}</p>
      </div>
    </article>
  `).join("");

  const resourcesHtml = parsed.resources
    ? `<section class="subject-resources"><strong>Resources</strong><p>${escapeHtml(parsed.resources)}</p></section>`
    : "";

  return `
    <div class="subject-shell">
      <section class="subject-hero">
        <h2>${escapeHtml(parsed.title || "Subject Guide")}</h2>
        <p>${escapeHtml(parsed.summary || "No summary returned.")}</p>
      </section>
      <section class="subject-tips-grid">${tipsHtml}</section>
      ${resourcesHtml}
    </div>
  `;
}

function parseSubjectGuide(answer) {
  const text = String(answer || "").trim();
  if (!text) {
    return null;
  }

  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const titleLine = lines.find(line => /^title:/i.test(line)) || "";
  const summaryLine = lines.find(line => /^summary:/i.test(line)) || "";
  const tipLines = lines.filter(line => line.startsWith("- "));
  const resourcesLine = lines.find(line => /^resources:/i.test(line)) || "";

  if (!titleLine && !summaryLine && !tipLines.length) {
    return null;
  }

  return {
    title: cleanMarkdownDecorators(titleLine.replace(/^title:\s*/i, "")),
    summary: cleanMarkdownDecorators(summaryLine.replace(/^summary:\s*/i, "")),
    tips: tipLines.map(parseSubjectTip),
    resources: cleanMarkdownDecorators(resourcesLine.replace(/^resources:\s*/i, ""))
  };
}

function parseSubjectTip(line) {
  const cleaned = cleanMarkdownDecorators(line.replace(/^- /, ""));
  const parts = cleaned.split("|").map(part => part.trim());
  const result = {
    area: "",
    tip: "",
    why: ""
  };

  for (const part of parts) {
    const [rawKey, ...rest] = part.split(":");
    const key = (rawKey || "").trim().toLowerCase();
    const value = rest.join(":").trim();

    if (key === "area") {
      result.area = value;
    } else if (key === "tip") {
      result.tip = value;
    } else if (key === "why it helps") {
      result.why = value;
    }
  }

  return result;
}

function renderEventCards(markdown) {
  const parsed = parseEventCardsSource(markdown);
  if (!parsed.events.length) {
    return "";
  }

  const overviewHtml = parsed.overview
    ? `<section class="result-overview"><h3>Overview</h3><p>${renderInline(escapeHtml(cleanMarkdownDecorators(parsed.overview))).replace(/\n/g, "<br />")}</p></section>`
    : "";

  const cardsHtml = parsed.events.map((event, index) => {
    const meta = [event.date, event.location, event.confidence].filter(Boolean)
      .map(item => `<span>${escapeHtml(cleanMarkdownDecorators(item))}</span>`)
      .join("");

    const why = event.why ? `
      <div class="event-field">
        <strong>Why it matches</strong>
        <div>${renderInline(escapeHtml(event.why))}</div>
      </div>
    ` : "";

    const fit = event.fit ? `
      <div class="event-field">
        <strong>Student fit</strong>
        <div>${renderInline(escapeHtml(event.fit))}</div>
      </div>
    ` : "";

    const link = event.link ? `<a class="event-link" href="${escapeHtml(event.link)}" target="_blank" rel="noreferrer">Open Event Link</a>` : "";

    return `
      <article class="event-card">
        <div class="event-card-header">
          <div>
            <h3>${escapeHtml(cleanMarkdownDecorators(event.title || `Event ${index + 1}`))}</h3>
            ${meta ? `<div class="event-meta">${meta}</div>` : ""}
          </div>
          <div class="event-index">${index + 1}</div>
        </div>
        <div class="event-body">
          ${why}
          ${fit}
          ${link}
        </div>
      </article>
    `;
  }).join("");

  const notesHtml = parsed.notes.length
    ? `<section class="result-notes"><h3>Notes</h3><p>${renderInline(escapeHtml(cleanMarkdownDecorators(parsed.notes.join("\n\n")))).replace(/\n/g, "<br />")}</p></section>`
    : "";

  return `
    <div class="results-shell">
      ${overviewHtml}
      <section class="events-grid">${cardsHtml}</section>
      ${notesHtml}
    </div>
  `;
}

function parseEventCardsSource(markdown) {
  const text = String(markdown || "").trim();
  if (!text) {
    return { overview: "", events: [], notes: [] };
  }

  const segments = text.split(/\n\s*(?=\d+\)\s+)/);
  if (segments.length < 2) {
    return { overview: "", events: [], notes: [] };
  }

  const overview = segments.shift()?.trim() || "";
  const events = [];
  const notes = [];

  for (const segment of segments) {
    const event = parseEventSegment(segment.trim());
    if (event) {
      events.push(event);
    } else {
      notes.push(segment.trim());
    }
  }

  return { overview, events, notes };
}

function parseEventSegment(segment) {
  const cleaned = segment.replace(/^\d+\)\s*/, "").replace(/\n+/g, " ").trim();
  if (!cleaned) {
    return null;
  }

  const titleMatch = cleaned.match(/^(.*?)(?=\s+-\s+Date:|\s+Date:|$)/i);
  const date = matchField(cleaned, "Date");
  const location = matchField(cleaned, "Location");
  const why = matchField(cleaned, "Why it matches");
  const fit = matchField(cleaned, "Student fit");
  const confidence = matchField(cleaned, "Confidence");
  const link = matchField(cleaned, "Link");

  return {
    title: titleMatch ? titleMatch[1].trim().replace(/\s+-\s*$/, "") : "",
    date,
    location,
    why,
    fit,
    confidence,
    link
  };
}

function matchField(text, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`${escaped}:\\s*(.*?)(?=\\s+-\\s+[A-Z][^:]*:|$)`, "i");
  const match = text.match(regex);
  return match ? match[1].trim() : "";
}

function cleanMarkdownDecorators(text) {
  return String(text || "")
    .replace(/\*\*/g, "")
    .replace(/__/g, "")
    .replace(/^[\-\s]+/, "")
    .trim();
}

function renderBlock(block) {
  const trimmed = block.trim();
  if (!trimmed) {
    return "";
  }

  if (trimmed.startsWith("- ")) {
    const items = trimmed
      .split("\n")
      .filter(line => line.startsWith("- "))
      .map(line => `<li>${renderInline(line.slice(2))}</li>`)
      .join("");

    return `<ul>${items}</ul>`;
  }

  if (trimmed.startsWith("### ")) {
    return `<h3>${renderInline(trimmed.slice(4))}</h3>`;
  }

  if (trimmed.startsWith("## ")) {
    return `<h2>${renderInline(trimmed.slice(3))}</h2>`;
  }

  if (trimmed.startsWith("# ")) {
    return `<h1>${renderInline(trimmed.slice(2))}</h1>`;
  }

  return `<p>${renderInline(trimmed).replace(/\n/g, "<br />")}</p>`;
}

function renderInline(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`(.+?)`/g, "<code>$1</code>")
    .replace(/\[(.+?)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
