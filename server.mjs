import http from "node:http";
import { readFileSync } from "node:fs";
import { readFile as readFileAsync, writeFile as writeFileAsync, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, "public");
const execFileAsync = promisify(execFile);
const bundledPython = "C:\\Users\\firas\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\python\\python.exe";

loadEnv(path.join(__dirname, ".env"));

const PORT = process.env.PORT || 3000;
const DIFY_API_KEY = process.env.DIFY_API_KEY || "";
const DIFY_BASE_URL = (process.env.DIFY_BASE_URL || "https://api.dify.ai/v1").replace(/\/+$/, "");
const DIFY_USER_ID = process.env.DIFY_USER_ID || "student-events-site";
const DIFY_APP_MODE = process.env.DIFY_APP_MODE || "chat";
const DIFY_TRANSPORT_API_KEY = process.env.DIFY_TRANSPORT_API_KEY || "";
const DIFY_TRANSPORT_MODE = process.env.DIFY_TRANSPORT_MODE || "chat";
const DIFY_SUBJECT_GUIDE_API_KEY = process.env.DIFY_SUBJECT_GUIDE_API_KEY || "";
const DIFY_SUBJECT_GUIDE_MODE = process.env.DIFY_SUBJECT_GUIDE_MODE || "chat";
const CAREER_SCOUT_DEFAULT_LIMIT = clampNumber(process.env.CAREER_SCOUT_DEFAULT_LIMIT, 3, 12, 6);
const CAREER_SCOUT_USER_AGENT = process.env.CAREER_SCOUT_USER_AGENT || "TUMBuddyCareerScout/1.0";
const HIWI_URL = process.env.HIWI_URL || "https://portal.mytum.de/schwarzesbrett/hiwi_stellen";
const REPLY_JOB_PAGES = [
  "https://www.reply.com/de/about/careers/de/job-search?country=de&role=student",
  "https://www.reply.com/de/about/careers/de/job-search?country=de&role=student&page=2",
  "https://www.reply.com/de/about/careers/de/job-search?country=de&role=student&page=3"
];
const CHAIR_SOURCES = [
  {
    name: "CDE",
    url: "https://www.cs.cit.tum.de/cde/jobs/",
    tags: ["data", "engineering", "backend", "software", "distributed systems"]
  },
  {
    name: "MLI",
    url: "https://www.ce.cit.tum.de/mli/openings/",
    tags: ["ai", "machine learning", "deep learning", "python", "research"]
  },
  {
    name: "SEAI",
    url: "https://www.cs.cit.tum.de/seai/stellenangebote/",
    tags: ["software engineering", "ai", "research", "backend", "python"]
  },
  {
    name: "I20 Security",
    url: "https://www.sec.in.tum.de/i20/jobs",
    tags: ["security", "systems", "research", "software", "python"]
  },
  {
    name: "AIR Robotics",
    url: "https://www.ce.cit.tum.de/air/open-positions/hiwi-positions/",
    tags: ["robotics", "ai", "control", "research", "python"]
  }
];
const CHAIR_ALIASES = {
  ml: "machine learning",
  "deep-learning": "deep learning",
  cybersecurity: "security",
  "cyber security": "security",
  "data science": "data",
  "distributed systems": "distributed systems",
  robotics: "robotics",
  "software engineering": "software engineering"
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);

    if (req.method === "GET" && url.pathname === "/api/health") {
      return sendJson(res, 200, {
        ok: true,
        configured: Boolean(DIFY_API_KEY),
        mode: DIFY_APP_MODE,
        baseUrl: DIFY_BASE_URL
      });
    }

    if (req.method === "POST" && url.pathname === "/api/events") {
      const body = await readJson(req);
      return await handleEventsRequest(body, res);
    }

    if (req.method === "GET" && url.pathname === "/api/transport") {
      return await handleTransportRequest(res);
    }

    if (req.method === "POST" && url.pathname === "/api/subject-guide") {
      const body = await readJson(req);
      return await handleSubjectGuideRequest(body, res);
    }

    if (req.method === "POST" && url.pathname === "/api/career-scout") {
      const body = await readJson(req);
      return await handleCareerScoutRequest(body, res);
    }

    if (req.method === "POST" && url.pathname === "/api/cv-profile") {
      const body = await readJson(req, 12_000_000);
      return await handleCvProfileRequest(body, res);
    }

    if (req.method === "POST" && url.pathname === "/api/cv/analyze") {
      return await handleCvAnalyzeUploadRequest(req, res);
    }

    if (req.method === "GET") {
      return serveStatic(url.pathname, res);
    }

    sendJson(res, 404, { error: "Not found" });
  } catch (error) {
    console.error(error);
    sendJson(res, error?.statusCode || 500, {
      error: error instanceof Error ? error.message : "Unexpected server error",
      details: error?.details || (error instanceof Error ? error.message : String(error))
    });
  }
});

server.listen(PORT, () => {
  console.log(`Student events site running at http://localhost:${PORT}`);
});

async function handleEventsRequest(body, res) {
  if (!DIFY_API_KEY) {
    return sendJson(res, 500, {
      error: "DIFY_API_KEY is missing. Add it to your .env file before using the app."
    });
  }

  const interests = normalizeList(body.interests);
  const city = cleanString(body.city);
  const dateRange = cleanString(body.dateRange);
  const notes = cleanString(body.notes);
  const maxEvents = clampNumber(body.maxEvents, 3, 20, 8);
  const conversationId = cleanString(body.conversationId);

  if (!interests.length) {
    return sendJson(res, 400, {
      error: "Please provide at least one interest."
    });
  }

  if (!dateRange) {
    return sendJson(res, 400, {
      error: "Please provide a time range."
    });
  }

  const query = buildPrompt({
    interests,
    city,
    dateRange,
    notes,
    maxEvents
  });

  if (DIFY_APP_MODE === "workflow") {
    const workflowResult = await runWorkflowRequest({
      apiKey: DIFY_API_KEY,
      interests,
      city,
      dateRange,
      notes,
      maxEvents,
      query
    });

    return sendJson(res, 200, workflowResult);
  }

  const chatResult = await runChatRequest({
    apiKey: DIFY_API_KEY,
    mode: DIFY_APP_MODE,
    interests,
    city,
    dateRange,
    notes,
    maxEvents,
    query,
    conversationId
  });

  return sendJson(res, 200, chatResult);
}

async function handleTransportRequest(res) {
  if (!DIFY_TRANSPORT_API_KEY) {
    return sendJson(res, 500, {
      error: "DIFY_TRANSPORT_API_KEY is missing. Add it to your .env file before using the transport detector."
    });
  }

  const query = buildTransportPrompt();

  if (DIFY_TRANSPORT_MODE === "workflow") {
    const workflowResult = await runWorkflowRequest({
      apiKey: DIFY_TRANSPORT_API_KEY,
      interests: ["transport constraints", "MVG updates"],
      city: "Munich",
      dateRange: "right now and the next few hours",
      notes: "No user input is required. Focus on MVG changes, disruptions, and travel constraints affecting students.",
      maxEvents: 3,
      query
    });

    return sendJson(res, 200, workflowResult);
  }

  const chatResult = await runTransportChatRequest({
    apiKey: DIFY_TRANSPORT_API_KEY,
    mode: DIFY_TRANSPORT_MODE,
    query
  });

  return sendJson(res, 200, chatResult);
}

async function handleSubjectGuideRequest(body, res) {
  if (!DIFY_SUBJECT_GUIDE_API_KEY) {
    return sendJson(res, 500, {
      error: "DIFY_SUBJECT_GUIDE_API_KEY is missing. Add it to your .env file before using Subject Guide."
    });
  }

  const subject = cleanString(body.subject);
  const degree = cleanString(body.degree);

  if (!subject) {
    return sendJson(res, 400, {
      error: "Please provide a subject name."
    });
  }

  if (!degree) {
    return sendJson(res, 400, {
      error: "Please provide a degree."
    });
  }

  const query = buildSubjectGuidePrompt({ subject, degree });

  if (DIFY_SUBJECT_GUIDE_MODE === "workflow") {
    const workflowResult = await runWorkflowRequest({
      apiKey: DIFY_SUBJECT_GUIDE_API_KEY,
      interests: [subject, degree],
      city: degree,
      dateRange: "current semester",
      notes: `Subject guide request for ${subject} in ${degree}.`,
      maxEvents: 4,
      query
    });

    return sendJson(res, 200, workflowResult);
  }

  const chatResult = await runSubjectGuideChatRequest({
    apiKey: DIFY_SUBJECT_GUIDE_API_KEY,
    subject,
    degree,
    query
  });

  return sendJson(res, 200, chatResult);
}

async function handleCareerScoutRequest(body, res) {
  const profile = {
    degree: cleanString(body.degree),
    skills: normalizeList(body.skills),
    interests: normalizeList(body.interests),
    preferredTypes: normalizeList(body.preferredTypes),
    preferredLocations: normalizeList(body.preferredLocations),
    preferredLanguages: normalizeList(body.preferredLanguages),
    summary: cleanString(body.summary)
  };

  const limit = clampNumber(body.limit, 3, 12, CAREER_SCOUT_DEFAULT_LIMIT);

  if (!profile.degree) {
    return sendJson(res, 400, {
      error: "Please provide your degree."
    });
  }

  if (!profile.skills.length) {
    return sendJson(res, 400, {
      error: "Please provide at least one skill."
    });
  }

  const sourceLimit = Math.max(limit * 3, 10);
  const items = [];
  const sourcesScanned = [];

  try {
    const hiwiItems = await fetchHiwiItems(sourceLimit);
    items.push(...hiwiItems);
    sourcesScanned.push("TUM HiWi Board");
  } catch (error) {
    console.error("HiWi source failed:", error);
  }

  try {
    const replyItems = await fetchReplyJobs(sourceLimit);
    items.push(...replyItems);
    sourcesScanned.push("Reply Student Jobs");
  } catch (error) {
    console.error("Reply jobs source failed:", error);
  }

  try {
    const chairSources = routeChairSources(profile);
    const chairItems = await fetchChairItems(chairSources, sourceLimit);
    items.push(...chairItems);
    if (chairItems.length) {
      sourcesScanned.push(...new Set(chairItems.map(item => item.source)));
    }
  } catch (error) {
    console.error("Chair sources failed:", error);
  }

  const ranked = rankCareerOpportunities(items, profile);
  const topResults = diversifyCareerResults(ranked, limit);
  const digest = buildCareerDigest(topResults, profile);

  return sendJson(res, 200, {
    count: topResults.length,
    topResults,
    digest,
    sourcesScanned
  });
}

async function handleCvProfileRequest(body, res) {
  const filename = cleanString(body.filename) || "cv.pdf";
  const contentBase64 = cleanString(body.contentBase64);

  if (!filename.toLowerCase().endsWith(".pdf")) {
    return sendJson(res, 400, {
      error: "Only PDF CV files are supported."
    });
  }

  if (!contentBase64) {
    return sendJson(res, 400, {
      error: "Missing CV file content."
    });
  }

  try {
    const fileBytes = Buffer.from(contentBase64, "base64");
    if (!fileBytes.length) {
      throw new Error("Decoded CV file is empty.");
    }
    const analysis = await analyzeCvFileBytes(filename, fileBytes);

    return sendJson(res, 200, {
      filename,
      analysis
    });
  } catch (error) {
    return sendJson(res, 500, {
      error: "CV analysis failed.",
      details: error instanceof Error ? error.message : String(error)
    });
  }
}

async function analyzeCvFileBytes(filename, fileBytes) {
  let tempDir = "";

  try {
    tempDir = await mkdtemp(path.join(tmpdir(), "tum-buddy-cv-"));
    const tempFilePath = path.join(tempDir, sanitizeFilename(filename));
    await writeFileAsync(tempFilePath, fileBytes);

    const scriptPath = path.join(__dirname, "tools", "extract_cv_profile.py");
    const { stdout, stderr } = await execFileAsync(bundledPython, [scriptPath, tempFilePath], {
      windowsHide: true,
      maxBuffer: 2_000_000
    });

    if (stderr && stderr.trim()) {
      console.error(stderr);
    }

    const analysis = tryParseJson(stdout);
    if (!analysis || analysis.error) {
      throw new Error(analysis?.error || "Could not analyze CV.");
    }

    return analysis;
  } finally {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

async function handleCvAnalyzeUploadRequest(req, res) {
  try {
    const form = await readMultipartForm(req, 12_000_000);
    const file = form.files.find(item => item.name === "file") || form.files[0];

    if (!file) {
      return sendJson(res, 400, {
        error: "No file uploaded."
      });
    }

    if (!file.filename.toLowerCase().endsWith(".pdf")) {
      return sendJson(res, 400, {
        error: "Only PDF CV files are supported."
      });
    }

    const analysis = await analyzeCvFileBytes(file.filename, file.content);

    return sendJson(res, 200, {
      filename: file.filename,
      text_preview: analysis.text_preview || "",
      analysis
    });
  } catch (error) {
    return sendJson(res, 500, {
      error: "CV analysis failed.",
      details: error instanceof Error ? error.message : String(error)
    });
  }
}

async function serveStatic(requestPath, res) {
  const relativePath = requestPath === "/" ? "index.html" : requestPath.replace(/^\/+/, "");
  const filePath = path.normalize(path.join(publicDir, relativePath));

  if (!filePath.startsWith(publicDir)) {
    return sendJson(res, 403, { error: "Forbidden" });
  }

  try {
    const file = await readFileAsync(filePath);
    res.writeHead(200, { "Content-Type": contentType(filePath) });
    res.end(file);
  } catch {
    sendJson(res, 404, { error: "File not found" });
  }
}

function buildPrompt({ interests, city, dateRange, notes, maxEvents }) {
  const locationLine = city ? `Location preference: ${city}.` : "Location preference: not specified.";
  const notesLine = notes ? `Extra student context: ${notes}.` : "Extra student context: none.";

  return [
    "You are helping a student find upcoming tech events they could realistically attend.",
    `Interests: ${interests.join(", ")}.`,
    `Time range: ${dateRange}.`,
    locationLine,
    notesLine,
    `Return up to ${maxEvents} relevant upcoming events.`,
    "Use this exact response structure.",
    "Start with a short overview paragraph.",
    "Then list each event on its own numbered item using this single-line field format:",
    "1) Event Name - Date: ... - Location: ... - Why it matches: ... - Student fit: ... - Confidence: high, medium, or low - Link: https://...",
    "Keep each event concise but informative.",
    "If information is uncertain, say so clearly.",
    "Do not ask follow-up questions."
  ].join(" ");
}

function extractAnswer(data) {
  if (!data) {
    return "No response body returned by Dify.";
  }

  if (typeof data.answer === "string" && data.answer.trim()) {
    return data.answer;
  }

  if (typeof data.data?.outputs?.result === "string" && data.data.outputs.result.trim()) {
    return data.data.outputs.result;
  }

  if (data.data?.outputs && typeof data.data.outputs === "object") {
    return JSON.stringify(data.data.outputs, null, 2);
  }

  return JSON.stringify(data, null, 2);
}

async function runWorkflowRequest({ apiKey, interests, city, dateRange, notes, maxEvents, query }) {
  const payload = {
    inputs: {
      interests: interests.join(", "),
      location: city || "online or nearby"
    },
    response_mode: "blocking",
    user: DIFY_USER_ID
  };

  const difyResponse = await fetch(`${DIFY_BASE_URL}/workflows/run`, {
    method: "POST",
    headers: difyHeaders(apiKey),
    body: JSON.stringify(payload)
  });

  const rawText = await difyResponse.text();
  const data = tryParseJson(rawText);

  if (!difyResponse.ok) {
    throwDifyError(difyResponse.status, data || rawText);
  }

  return {
    answer: extractAnswer(data),
    conversationId: null,
    raw: data
  };
}

async function runChatRequest({ apiKey, interests, city, dateRange, notes, maxEvents, query, conversationId }) {
  const payload = {
    inputs: {
      interests: interests.join(", "),
      location: city || "online or nearby"
    },
    query,
    response_mode: "streaming",
    user: DIFY_USER_ID,
    ...(conversationId ? { conversation_id: conversationId } : {})
  };

  const difyResponse = await fetch(`${DIFY_BASE_URL}/chat-messages`, {
    method: "POST",
    headers: difyHeaders(apiKey),
    body: JSON.stringify(payload)
  });

  if (!difyResponse.ok) {
    const rawText = await difyResponse.text();
    const data = tryParseJson(rawText);
    throwDifyError(difyResponse.status, data || rawText);
  }

  const data = await readSseResponse(difyResponse);

  return {
    answer: extractAnswer(data),
    conversationId: data?.conversation_id || conversationId || null,
    raw: data
  };
}

async function runTransportChatRequest({ apiKey, query }) {
  const payload = {
    inputs: {},
    query,
    response_mode: "streaming",
    user: `${DIFY_USER_ID}-transport`
  };

  const difyResponse = await fetch(`${DIFY_BASE_URL}/chat-messages`, {
    method: "POST",
    headers: difyHeaders(apiKey),
    body: JSON.stringify(payload)
  });

  if (!difyResponse.ok) {
    const rawText = await difyResponse.text();
    const data = tryParseJson(rawText);
    throwDifyError(difyResponse.status, data || rawText);
  }

  const data = await readSseResponse(difyResponse);

  return {
    answer: extractAnswer(data),
    raw: data
  };
}

async function runSubjectGuideChatRequest({ apiKey, subject, degree, query }) {
  const payload = {
    inputs: {
      subject,
      degree
    },
    query,
    response_mode: "streaming",
    user: `${DIFY_USER_ID}-subject-guide`
  };

  const difyResponse = await fetch(`${DIFY_BASE_URL}/chat-messages`, {
    method: "POST",
    headers: difyHeaders(apiKey),
    body: JSON.stringify(payload)
  });

  if (!difyResponse.ok) {
    const rawText = await difyResponse.text();
    const data = tryParseJson(rawText);
    throwDifyError(difyResponse.status, data || rawText);
  }

  const data = await readSseResponse(difyResponse);

  return {
    answer: extractAnswer(data),
    raw: data
  };
}

async function readSseResponse(response) {
  if (!response.body) {
    throw new Error("Dify returned an empty streaming response.");
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let answer = "";
  let latestConversationId = null;
  let latestMessage = null;
  let messageEnd = null;

  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });

    while (true) {
      const boundaryMatch = buffer.match(/\r?\n\r?\n/);
      if (!boundaryMatch || boundaryMatch.index == null) {
        break;
      }

      const boundary = boundaryMatch.index;
      const separatorLength = boundaryMatch[0].length;
      const rawEvent = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + separatorLength);

      const parsed = parseSseEvent(rawEvent);
      if (!parsed) {
        continue;
      }

      if (parsed.event === "error") {
        throw new Error(parsed.message || "Dify streaming request failed.");
      }

      if (typeof parsed.answer === "string") {
        answer += parsed.answer;
      }

      if (typeof parsed.conversation_id === "string" && parsed.conversation_id) {
        latestConversationId = parsed.conversation_id;
      }

      if (parsed.event === "message") {
        latestMessage = parsed;
      }

      if (parsed.event === "message_end") {
        messageEnd = parsed;
      }
    }
  }

  buffer += decoder.decode();
  if (buffer.trim()) {
    const parsed = parseSseEvent(buffer);
    if (parsed?.event === "error") {
      throw new Error(parsed.message || "Dify streaming request failed.");
    }

    if (typeof parsed?.answer === "string") {
      answer += parsed.answer;
    }

    if (typeof parsed?.conversation_id === "string" && parsed.conversation_id) {
      latestConversationId = parsed.conversation_id;
    }
  }

  return {
    ...(latestMessage || {}),
    ...(messageEnd || {}),
    answer: answer || latestMessage?.answer || "",
    conversation_id: latestConversationId || latestMessage?.conversation_id || null
  };
}

function parseSseEvent(rawEvent) {
  const dataLines = rawEvent
    .split(/\r?\n/)
    .filter(line => line.startsWith("data:"))
    .map(line => line.slice(5).trim())
    .filter(Boolean);

  if (!dataLines.length) {
    return null;
  }

  const payload = dataLines.join("\n");
  if (payload === "[DONE]") {
    return null;
  }

  return tryParseJson(payload);
}

function difyHeaders(apiKey) {
  return {
    "Authorization": `Bearer ${apiKey}`,
    "Content-Type": "application/json"
  };
}

function buildTransportPrompt() {
  return [
    "You are a transport detector for a TUM student in Munich.",
    "Check whether there are any MVG transport constraints, delays, disruptions, closures, or important service changes right now or in the next few hours.",
    "No user input is required.",
    "Use this exact response structure.",
    "First line: Status: normal, warning, or disruption.",
    "Second line: Summary: one short sentence.",
    "Then provide up to 4 bullet points in this format:",
    "- Line/Area: ... | Issue: ... | Impact: ... | Advice: ...",
    "If there are no meaningful issues, say that service appears normal and give one short reassurance line.",
    "Be concise and practical."
  ].join(" ");
}

function buildSubjectGuidePrompt({ subject, degree }) {
  return [
    "You are Subject Guide for a university student.",
    `Subject: ${subject}.`,
    `Degree: ${degree}.`,
    "Give practical and encouraging guidance for succeeding in this subject.",
    "Use this exact response structure.",
    "First line: Title: short helpful title.",
    "Second line: Summary: one short paragraph.",
    "Then provide exactly 4 bullet points in this format:",
    "- Area: ... | Tip: ... | Why it helps: ...",
    "Then finish with one final line in this format:",
    "Resources: ...",
    "Keep it concise, useful, and student-friendly.",
    "Do not ask follow-up questions."
  ].join(" ");
}

function throwDifyError(status, details) {
  const error = new Error("Dify request failed");
  error.statusCode = status;
  error.details = details;
  throw error;
}

function loadEnv(filePath) {
  try {
    const raw = readFileSync(filePath, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }

      const eqIndex = trimmed.indexOf("=");
      if (eqIndex === -1) {
        continue;
      }

      const key = trimmed.slice(0, eqIndex).trim();
      const value = trimmed.slice(eqIndex + 1).trim();
      if (key && !process.env[key]) {
        process.env[key] = stripQuotes(value);
      }
    }
  } catch {
    return;
  }
}

function readJson(req, maxBytes = 1_000_000) {
  return new Promise((resolve, reject) => {
    let body = "";

    req.on("data", chunk => {
      body += chunk;
      if (body.length > maxBytes) {
        reject(new Error("Request body is too large."));
      }
    });

    req.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Invalid JSON body."));
      }
    });

    req.on("error", reject);
  });
}

function readRawBody(req, maxBytes = 12_000_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;

    req.on("data", chunk => {
      totalBytes += chunk.length;
      if (totalBytes > maxBytes) {
        reject(new Error("Request body is too large."));
        return;
      }

      chunks.push(chunk);
    });

    req.on("end", () => {
      resolve(Buffer.concat(chunks));
    });

    req.on("error", reject);
  });
}

async function readMultipartForm(req, maxBytes = 12_000_000) {
  const contentType = req.headers["content-type"] || "";
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);

  if (!boundaryMatch) {
    throw new Error("Missing multipart boundary.");
  }

  const boundary = boundaryMatch[1] || boundaryMatch[2];
  const rawBody = await readRawBody(req, maxBytes);
  const bodyString = rawBody.toString("latin1");
  const parts = bodyString.split(`--${boundary}`);
  const files = [];
  const fields = [];

  for (const part of parts) {
    if (!part || part === "--\r\n" || part === "--") {
      continue;
    }

    const trimmedPart = part.startsWith("\r\n") ? part.slice(2) : part;
    const separatorIndex = trimmedPart.indexOf("\r\n\r\n");
    if (separatorIndex === -1) {
      continue;
    }

    const rawHeaders = trimmedPart.slice(0, separatorIndex);
    let rawValue = trimmedPart.slice(separatorIndex + 4);
    rawValue = rawValue.replace(/\r\n$/, "");
    rawValue = rawValue.replace(/--$/, "");

    const nameMatch = rawHeaders.match(/name="([^"]+)"/i);
    if (!nameMatch) {
      continue;
    }

    const filenameMatch = rawHeaders.match(/filename="([^"]*)"/i);
    if (filenameMatch) {
      files.push({
        name: nameMatch[1],
        filename: filenameMatch[1] || "upload.bin",
        content: Buffer.from(rawValue, "latin1")
      });
      continue;
    }

    fields.push({
      name: nameMatch[1],
      value: rawValue
    });
  }

  return { files, fields };
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function normalizeList(value) {
  if (Array.isArray(value)) {
    return value.map(cleanString).filter(Boolean);
  }

  return cleanString(value)
    .split(",")
    .map(item => item.trim())
    .filter(Boolean);
}

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.round(number)));
}

function tryParseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function stripQuotes(value) {
  return value.replace(/^['"]|['"]$/g, "");
}

function sanitizeFilename(value) {
  return cleanString(value).replace(/[^\w.-]+/g, "_") || "cv.pdf";
}

async function fetchHiwiItems(limit = 10) {
  const html = await fetchHtml(HIWI_URL);
  const items = [];
  const seen = new Set();

  for (const anchor of extractAnchors(html)) {
    const href = cleanString(anchor.href);
    const text = cleanText(anchor.text);

    if (!href || !text || text.length < 5) {
      continue;
    }

    if (!href.includes("NewsArticle")) {
      continue;
    }

    const fullUrl = new URL(href, HIWI_URL).toString();
    if (seen.has(fullUrl)) {
      continue;
    }
    seen.add(fullUrl);

    items.push({
      title: text,
      type: "job",
      source: "TUM HiWi Board",
      url: fullUrl,
      description: "TUM HiWi opportunity",
      tags: ["hiwi", "student job", "tum"],
      score: 0,
      reason: null
    });

    if (items.length >= limit) {
      break;
    }
  }

  return items;
}

async function fetchReplyJobs(limit = 10) {
  const results = [];
  const seenUrls = new Set();

  for (const listingUrl of REPLY_JOB_PAGES) {
    try {
      const html = await fetchHtml(listingUrl);
      const jobLinks = extractReplyJobLinks(html);

      for (const jobUrl of jobLinks) {
        if (seenUrls.has(jobUrl)) {
          continue;
        }

        seenUrls.add(jobUrl);
        const item = await extractReplyJobDetail(jobUrl);
        if (!item) {
          continue;
        }

        results.push(item);
        if (results.length >= limit) {
          return results;
        }
      }
    } catch (error) {
      console.error(`Reply listing scrape failed for ${listingUrl}:`, error);
    }
  }

  if (!results.length) {
    results.push({
      title: "Reply student jobs page could not be parsed",
      type: "job",
      source: "Reply Student Jobs",
      url: REPLY_JOB_PAGES[0],
      description: "The Reply student jobs pages were reached, but no job details were extracted.",
      tags: ["reply", "student", "fallback"],
      score: 0,
      reason: null
    });
  }

  return results.slice(0, limit);
}

async function extractReplyJobDetail(url) {
  try {
    const html = await fetchHtml(url);
    const title = cleanText(
      firstMatch(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i)
      || firstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i)
    );

    if (!title || title.length < 4) {
      return null;
    }

    const pageText = cleanText(stripHtml(html));
    const description = pageText ? `${pageText.slice(0, 900)}${pageText.length > 900 ? "..." : ""}` : "Reply student job opportunity";
    const location = ["München", "Munich", "Berlin", "Hamburg", "Frankfurt", "Köln", "Stuttgart"]
      .find(city => pageText.toLowerCase().includes(city.toLowerCase())) || null;

    return {
      title,
      type: "job",
      source: "Reply Student Jobs",
      url,
      description,
      location,
      tags: ["reply", "student", "job"],
      score: 0,
      reason: null
    };
  } catch (error) {
    console.error(`Reply detail scrape failed for ${url}:`, error);
    return null;
  }
}

async function fetchChairItems(sources, limit = 10) {
  const items = [];
  const seenUrls = new Set();

  for (const source of sources) {
    try {
      const html = await fetchHtml(source.url);

      for (const anchor of extractAnchors(html)) {
        const text = cleanText(anchor.text);
        const href = cleanString(anchor.href);

        if (!text || text.length < 4 || !href) {
          continue;
        }

        if (!looksLikeJobText(text)) {
          continue;
        }

        const fullUrl = new URL(href, source.url).toString();
        if (seenUrls.has(fullUrl)) {
          continue;
        }
        seenUrls.add(fullUrl);

        items.push({
          title: text,
          type: "job",
          source: `TUM Chair - ${source.name}`,
          url: fullUrl,
          description: `Opportunity from ${source.name} (${source.url})`,
          tags: ["tum", "chair", "research", ...source.tags.slice(0, 3)],
          score: 0,
          reason: null
        });

        if (items.length >= limit) {
          return items;
        }
      }
    } catch (error) {
      console.error(`Chair scrape error for ${source.url}:`, error);
    }
  }

  return items;
}

function routeChairSources(profile) {
  const profileTerms = normalizeTerms([
    ...profile.skills,
    ...profile.interests,
    ...profile.preferredTypes
  ]);
  const profileText = profileTerms.join(" ");
  const scoredSources = [];

  for (const source of CHAIR_SOURCES) {
    let score = 0;

    for (const tag of source.tags) {
      const tagLower = tag.toLowerCase();

      if (profileText.includes(tagLower)) {
        score += 2;
      }

      for (const term of profileTerms) {
        if (term.includes(tagLower) || tagLower.includes(term)) {
          score += 1;
        }
      }
    }

    if (score > 0) {
      scoredSources.push({ score, source });
    }
  }

  scoredSources.sort((a, b) => b.score - a.score);
  return scoredSources.map(item => item.source);
}

function normalizeTerms(values) {
  const normalized = [];

  for (const value of values) {
    const text = cleanString(value).toLowerCase();
    if (!text) {
      continue;
    }

    normalized.push(text);
    if (CHAIR_ALIASES[text]) {
      normalized.push(CHAIR_ALIASES[text]);
    }
  }

  return normalized;
}

function rankCareerOpportunities(items, profile) {
  const profileTextValues = [
    ...profile.skills,
    ...profile.interests,
    ...profile.preferredTypes,
    ...profile.preferredLocations,
    ...profile.preferredLanguages
  ];

  return items
    .map(item => {
      let score = 1.0;
      const reasons = ["base opportunity score"];
      const itemText = cleanText([
        item.title,
        item.description,
        item.source,
        item.type,
        item.location,
        ...(item.tags || [])
      ].join(" "));
      const itemTitleLower = cleanString(item.title).toLowerCase();

      if (item.source === "TUM HiWi Board") {
        score += 2.0;
        reasons.push("high-confidence TUM source");
      }

      if (item.source === "Reply Student Jobs") {
        score += 1.5;
        reasons.push("high-confidence student jobs source");
      }

      if ((item.source || "").startsWith("TUM Chair")) {
        score += 1.0;
        reasons.push("relevant TUM chair source");
      }

      if ((item.tags || []).some(tag => tag.toLowerCase() === "fallback")) {
        score -= 2.0;
        reasons.push("fallback result");
      }

      if (["open positions", "open position", "jobs", "stellenangebote"].some(term => itemTitleLower.includes(term))) {
        score -= 2.5;
        reasons.push("generic title penalty");
      }

      if (["phd", "doctoral", "postdoc", "professorship", "faculty"].some(term => itemTitleLower.includes(term))) {
        score -= 3.0;
        reasons.push("non-student role penalty");
      }

      if (["thesis", "master thesis", "bachelor thesis", "masterarbeit", "bachelorarbeit"].some(term => itemTitleLower.includes(term))) {
        score -= 2.5;
        reasons.push("thesis role penalty");
      }

      for (const match of containsAny(itemText, profile.interests)) {
        score += 1.5;
        reasons.push(`matches interest '${match}'`);
      }

      for (const match of containsAny(itemText, profile.skills)) {
        score += 1.2;
        reasons.push(`matches skill '${match}'`);
      }

      if (item.type && profile.preferredTypes.some(type => type.toLowerCase() === item.type.toLowerCase())) {
        score += 1.5;
        reasons.push(`preferred type '${item.type}'`);
      }

      if (item.location) {
        const matchedLocation = profile.preferredLocations.find(location => item.location.toLowerCase().includes(location.toLowerCase()));
        if (matchedLocation) {
          score += 1.0;
          reasons.push(`preferred location '${matchedLocation}'`);
        }
      }

      for (const match of containsAny(itemText, profile.preferredLanguages)) {
        score += 0.8;
        reasons.push(`preferred language '${match}'`);
      }

      const matchedProfileTerms = containsAny(itemText, profileTextValues);
      if (matchedProfileTerms.length) {
        score += Math.min(matchedProfileTerms.length * 0.2, 1.0);
        reasons.push("general profile overlap");
      }

      if (profile.summary) {
        const summaryMatches = containsAny(itemText, profile.summary.split(/[\s,;|/]+/));
        if (summaryMatches.length) {
          score += Math.min(summaryMatches.length * 0.12, 0.8);
          reasons.push("matches profile summary");
        }
      }

      return {
        ...item,
        score: Math.round(score * 100) / 100,
        reason: reasons.join(", ")
      };
    })
    .sort((a, b) => b.score - a.score);
}

function diversifyCareerResults(ranked, limit) {
  const topResults = [];
  const seenSources = new Map();

  for (const item of ranked) {
    const sourceCount = seenSources.get(item.source) || 0;
    if (sourceCount >= 2) {
      continue;
    }

    topResults.push(item);
    seenSources.set(item.source, sourceCount + 1);

    if (topResults.length >= limit) {
      break;
    }
  }

  ensureRepresentativeSource(topResults, ranked, "Reply Student Jobs", limit);
  ensureRepresentativeSource(topResults, ranked, "TUM HiWi Board", limit);

  return topResults.slice(0, limit);
}

function ensureRepresentativeSource(topResults, ranked, sourceName, limit) {
  if (topResults.some(item => item.source === sourceName)) {
    return;
  }

  const bestSourceItem = ranked.find(item => item.source === sourceName);
  if (!bestSourceItem) {
    return;
  }

  if (topResults.length >= limit) {
    topResults[topResults.length - 1] = bestSourceItem;
    return;
  }

  topResults.push(bestSourceItem);
}

function buildCareerDigest(items, profile) {
  if (!items.length) {
    return `No strong job matches were found yet for ${profile.degree}. Try broader skills, interests, or locations and scan again.`;
  }

  const highlights = items.slice(0, 3).map((item, index) => {
    const reason = item.reason ? item.reason.split(",").slice(0, 2).join(", ") : "strong profile overlap";
    return `${index + 1}. ${item.title} (${item.source}) fits because it shows ${reason}.`;
  });

  return [
    `Career Scout found ${items.length} promising matches for a ${profile.degree} profile.`,
    ...highlights,
    "Start with the top result and compare the required skills against your strongest projects or coursework."
  ].join(" ");
}

async function fetchHtml(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": CAREER_SCOUT_USER_AGENT
    }
  });

  if (!response.ok) {
    throw new Error(`Request failed for ${url} with status ${response.status}`);
  }

  return await response.text();
}

function extractReplyJobLinks(html) {
  const links = [];

  for (const anchor of extractAnchors(html)) {
    const href = cleanString(anchor.href);
    if (!href) {
      continue;
    }

    const fullUrl = new URL(href, "https://www.reply.com").toString();
    if (!fullUrl.includes("/de/about/careers/")) {
      continue;
    }
    if (fullUrl.includes("job-search?")) {
      continue;
    }
    if (links.includes(fullUrl)) {
      continue;
    }

    const text = cleanText(anchor.text);
    if (text && text.length >= 4) {
      links.push(fullUrl);
    }
  }

  return links;
}

function extractAnchors(html) {
  const anchors = [];
  const anchorRegex = /<a\b[^>]*href\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi;
  let match = anchorRegex.exec(html);

  while (match) {
    anchors.push({
      href: decodeHtmlEntities(match[2]),
      text: stripHtml(match[3])
    });
    match = anchorRegex.exec(html);
  }

  return anchors;
}

function containsAny(text, values) {
  const textLower = cleanString(text).toLowerCase();
  const matches = [];

  for (const value of values) {
    const valueLower = cleanString(value).toLowerCase();
    if (valueLower && textLower.includes(valueLower)) {
      matches.push(value);
    }
  }

  return matches;
}

function looksLikeJobText(text) {
  const value = cleanString(text).toLowerCase();
  const positiveKeywords = [
    "hiwi",
    "student assistant",
    "studentische hilfskraft",
    "student assistant position",
    "werkstudent",
    "research assistant",
    "student job"
  ];
  const negativeKeywords = [
    "phd",
    "doctoral",
    "professorship",
    "postdoc",
    "open positions",
    "faculty position",
    "bachelor thesis",
    "master thesis",
    "thesis"
  ];

  if (negativeKeywords.some(term => value.includes(term))) {
    return false;
  }

  return positiveKeywords.some(term => value.includes(term));
}

function cleanText(value) {
  return decodeHtmlEntities(String(value || ""))
    .replace(/\s+/g, " ")
    .trim();
}

function stripHtml(value) {
  return decodeHtmlEntities(String(value || "").replace(/<[^>]+>/g, " "));
}

function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

function firstMatch(value, regex) {
  const match = String(value || "").match(regex);
  return match ? stripHtml(match[1]) : "";
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "application/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    default:
      return "text/plain; charset=utf-8";
  }
}
