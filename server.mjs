import http from "node:http";
import { readFileSync } from "node:fs";
import { readFile as readFileAsync } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, "public");

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

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";

    req.on("data", chunk => {
      body += chunk;
      if (body.length > 1_000_000) {
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
