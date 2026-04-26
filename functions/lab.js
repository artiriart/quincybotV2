const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  ModalBuilder,
  SeparatorBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");

const ROUTE_PREFIX = "lab";
const LAB_VIEW_STATE_TYPE = "lab_view_state";
const LAB_COOLDOWN_STATE_TYPE = "lab_combine_cooldown";
const PICKER_INPUT_ID = "element_query";
const ELEMENTS_PER_PAGE = 8;
const COMBINE_COOLDOWN_MS = 10_000;
const STARTER_ELEMENTS = ["Earth", "Water", "Fire", "Air"];

function parseFirstJsonObject(text) {
  const raw = String(text || "");
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

let geminiKeyIndex = 0;

function getGeminiApiKeys() {
  return String(process.env.GEMINI_API_KEY || "")
    .split("|")
    .map((key) => key.trim())
    .filter(Boolean);
}

function getNextGeminiApiKey() {
  const keys = getGeminiApiKeys();
  if (!keys.length) return "";
  const key = keys[geminiKeyIndex % keys.length];
  geminiKeyIndex = (geminiKeyIndex + 1) % keys.length;
  return key;
}

function compactElementKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function normalizeElementName(value) {
  const trimmed = String(value || "").replace(/\s+/g, " ").trim();
  if (!trimmed) return "";
  const clipped = trimmed.slice(0, 48).trim();
  if (clipped === clipped.toLowerCase()) {
    return clipped.replace(/\b[a-z]/g, (char) => char.toUpperCase());
  }
  return clipped;
}

function normalizeLabViewState(raw, userId) {
  let parsed = raw;
  try {
    if (typeof raw === "string") {
      parsed = JSON.parse(raw);
    }
  } catch {
    parsed = {};
  }

  return {
    userId: String(userId || parsed?.userId || "").trim(),
    selectedAKey:
      parsed?.selectedAKey == null
        ? null
        : String(parsed.selectedAKey).trim() || null,
    selectedBKey:
      parsed?.selectedBKey == null
        ? null
        : String(parsed.selectedBKey).trim() || null,
    lastResultKey:
      parsed?.lastResultKey == null
        ? null
        : String(parsed.lastResultKey).trim() || null,
    lastResultStatus:
      parsed?.lastResultStatus == null
        ? ""
        : String(parsed.lastResultStatus).trim() || "",
    lastFirstDiscovery:
      Number(parsed?.lastFirstDiscovery || 0) === 1 ? 1 : 0,
    lastMessage:
      parsed?.lastMessage == null
        ? ""
        : String(parsed.lastMessage).trim().slice(0, 200) || "",
  };
}

function getLabViewState(userId) {
  const raw = global.db.getState(LAB_VIEW_STATE_TYPE, userId);
  return normalizeLabViewState(raw, userId);
}

function saveLabViewState(state) {
  const normalized = normalizeLabViewState(state, state?.userId);
  global.db.upsertState(
    LAB_VIEW_STATE_TYPE,
    JSON.stringify(normalized),
    normalized.userId,
    true,
  );
  return normalized;
}

function getLabCooldownState(userId) {
  const raw = global.db.getState(LAB_COOLDOWN_STATE_TYPE, userId);
  if (raw == null) return 0;

  const direct = Number(raw);
  if (Number.isFinite(direct) && direct > 0) return Math.trunc(direct);

  try {
    const parsed = JSON.parse(raw);
    const value = Number(parsed?.last_combine_at_ms || 0);
    return Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
  } catch {
    return 0;
  }
}

function saveLabCooldownState(userId, timestampMs) {
  global.db.upsertState(
    LAB_COOLDOWN_STATE_TYPE,
    JSON.stringify({ last_combine_at_ms: Math.trunc(Number(timestampMs) || Date.now()) }),
    userId,
    true,
  );
}

function buildGemmaPrompt(elementA, elementB, previousInvalidAnswer = "") {
  const retryLine = previousInvalidAnswer
    ? `Previous invalid answer to avoid repeating: ${previousInvalidAnswer}`
    : "";
  return [
    "Create one new element name from these two inputs.",
    `Input 1: ${elementA}`,
    `Input 2: ${elementB}`,
    retryLine,
    "",
    "Return one short invented name that fits the combination.",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildLabGemmaRequestBody(elementA, elementB, previousInvalidAnswer = "") {
  return {
    systemInstruction: {
      parts: [
        {
          text: [
            "You name synthesized elements for an Infinite Craft style game.",
            "Respond with JSON only.",
            "The JSON must contain exactly one key named result.",
            "result must be a short invented element name, 1 to 3 words.",
            "Use only letters, numbers, and spaces in result.",
            "Do not return labels, headings, explanations, equations, markdown, prompt text, or status text.",
            "Do not repeat Input 1, Input 2, Element A, Element B, Result, First Discovery, Constraints, or JSON.",
            "Bad results include Input 1 Earth, First Discovery, and Earth Water equals Mud.",
          ].join(" "),
        },
      ],
    },
    contents: [
      {
        parts: [
          {
            text: buildGemmaPrompt(elementA, elementB, previousInvalidAnswer),
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0,
      maxOutputTokens: 40,
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          result: {
            type: "STRING",
          },
        },
        required: ["result"],
      },
    },
  };
}

function collectGeminiResponseText(payload) {
  const partsToText = (parts) =>
    (Array.isArray(parts) ? parts : [])
      .map((part) => String(part?.text || ""))
      .filter(Boolean)
      .join("");

  if (Array.isArray(payload)) {
    return payload
      .map((chunk) => partsToText(chunk?.candidates?.[0]?.content?.parts))
      .filter(Boolean)
      .join("")
      .trim();
  }

  return partsToText(payload?.candidates?.[0]?.content?.parts).trim();
}

function extractGeminiText(responseBody) {
  const raw = String(responseBody || "").trim();
  if (!raw) return "";

  const tryParse = (value) => {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  };

  const direct = tryParse(raw);
  if (direct) return collectGeminiResponseText(direct);

  const chunks = raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => (line.startsWith("data:") ? line.slice(5).trim() : line))
    .filter((line) => line && line !== "[DONE]")
    .map((line) => tryParse(line))
    .filter(Boolean);

  if (chunks.length) return collectGeminiResponseText(chunks);
  return raw;
}

function sanitizeLabAiResult(rawResult) {
  const cleaned = normalizeElementName(
    String(rawResult || "")
      .replace(/```(?:json)?/gi, " ")
      .replace(/```/g, " ")
      .replace(/^json\b/i, "")
      .replace(/^(?:result|name|element|output|value)\s*:\s*/i, "")
      .replace(/^["'`]+|["'`]+$/g, "")
      .replace(/[()[\]{}]/g, " ")
      .replace(/\s+/g, " "),
  );
  return cleaned;
}

function isValidLabResultName(resultName, elementA = "", elementB = "") {
  const normalized = normalizeElementName(resultName);
  if (!normalized) return false;

  const lower = normalized.toLowerCase();
  const wordCount = normalized.split(/\s+/).filter(Boolean).length;
  const compact = compactElementKey(normalized);
  const inputA = normalizeElementName(elementA).toLowerCase();
  const inputB = normalizeElementName(elementB).toLowerCase();

  if (!compact) return false;
  if (wordCount < 1 || wordCount > 4) return false;
  if (!/^[A-Za-z0-9 ]+$/.test(normalized)) return false;

  const bannedStarts = [
    "input 1",
    "input 2",
    "element a",
    "element b",
    "result",
    "name",
    "json",
  ];
  if (bannedStarts.some((prefix) => lower.startsWith(prefix))) return false;

  const bannedExact = new Set([
    "first discovery",
    "my discoveries",
    "lab",
    "constraints",
    "requirements",
    "good outputs",
    "bad outputs",
  ]);
  if (bannedExact.has(lower)) return false;

  const bannedFragments = [
    "return exactly",
    "return only",
    "code fence",
    "markdown",
    "output exactly",
    "output only",
    "invent exactly",
    "one key",
    "input 1:",
    "input 2:",
    "element a:",
    "element b:",
    "earth + water",
    " = ",
  ];
  if (bannedFragments.some((fragment) => lower.includes(fragment))) return false;

  if ((inputA && lower === inputA) || (inputB && lower === inputB)) return false;
  return true;
}

function collectLabResultCandidates(value, depth = 0) {
  if (depth > 2 || value == null) return [];
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) {
    return value.slice(0, 5).flatMap((entry) => collectLabResultCandidates(entry, depth + 1));
  }
  if (typeof value !== "object") return [];

  const preferredKeys = ["result", "name", "element", "output", "value", "text", "title"];
  const candidates = [];

  for (const key of preferredKeys) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      candidates.push(...collectLabResultCandidates(value[key], depth + 1));
    }
  }

  for (const entry of Object.values(value).slice(0, 5)) {
    candidates.push(...collectLabResultCandidates(entry, depth + 1));
  }

  return candidates;
}

function extractLabResultName(responseText, elementA = "", elementB = "") {
  const parsed = parseFirstJsonObject(responseText);
  const parsedCandidates = collectLabResultCandidates(parsed);
  for (const candidate of parsedCandidates) {
    const sanitized = sanitizeLabAiResult(candidate);
    if (isValidLabResultName(sanitized, elementA, elementB)) return sanitized;
  }

  const plainTextCandidates = String(responseText || "")
    .replace(/```(?:json)?/gi, "\n")
    .replace(/```/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^[\[{]/.test(line));

  for (const candidate of plainTextCandidates) {
    const sanitized = sanitizeLabAiResult(candidate);
    if (isValidLabResultName(sanitized, elementA, elementB)) return sanitized;
  }

  return "";
}

async function generateLabElementWithGemma(elementA, elementB) {
  const configuredKeys = getGeminiApiKeys();
  if (!configuredKeys.length) {
    throw new Error("GEMINI_API_KEY is missing.");
  }

  const model = "gemma-4-31b-it";
  const endpoint =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

  let lastStatus = "no-response";
  let lastInvalidAnswer = "";
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const apiKey = getNextGeminiApiKey();
    const response = await fetch(`${endpoint}?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(
        buildLabGemmaRequestBody(elementA, elementB, lastInvalidAnswer),
      ),
    }).catch(() => null);

    if (response?.ok) {
      const rawBody = await response.text().catch(() => "");
      const responseText = extractGeminiText(rawBody);
      const result = extractLabResultName(responseText, elementA, elementB);
      if (result) return result;
      lastInvalidAnswer = (sanitizeLabAiResult(responseText) || String(responseText || "").trim())
        .slice(0, 80);
      lastStatus = "invalid-response";
    } else {
      lastStatus = response?.status || "no-response";
      if (![429, 500, 502, 503, 504].includes(Number(lastStatus)) || attempt >= 3) {
        break;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
  }

  if (!lastInvalidAnswer) {
    throw new Error(`Lab synthesis request failed (${lastStatus}).`);
  }
  throw new Error("Lab synthesis model returned an invalid element name.");
}

function buildCanonicalCombinationKeys(elementAKey, elementBKey) {
  const keys = [String(elementAKey || "").trim(), String(elementBKey || "").trim()]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
  return {
    inputAKey: keys[0] || "",
    inputBKey: keys[1] || "",
  };
}

function createLabElement(elementName, firstDiscovererId = null) {
  const normalizedName = normalizeElementName(elementName);
  const elementKey = compactElementKey(normalizedName);
  if (!elementKey || !normalizedName) return null;

  global.db.safeQuery(
    `
    INSERT INTO lab_elements (element_key, name, first_discoverer_id)
    VALUES (?, ?, ?)
    ON CONFLICT(element_key) DO UPDATE SET
      name = COALESCE(lab_elements.name, excluded.name)
    `,
    [elementKey, normalizedName, firstDiscovererId],
    null,
  );

  return getLabElementByKey(elementKey);
}

function ensureStarterElementsExist() {
  for (const starter of STARTER_ELEMENTS) {
    createLabElement(starter, null);
  }
}

function getLabElementByKey(elementKey) {
  if (!elementKey) return null;
  return (
    global.db.safeQuery(
      `
      SELECT element_key, name, first_discoverer_id, created_at
      FROM lab_elements
      WHERE element_key = ?
      LIMIT 1
      `,
      [elementKey],
      [],
    )?.[0] || null
  );
}

function getLabElementByName(query) {
  const key = compactElementKey(query);
  if (!key) return null;
  return getLabElementByKey(key);
}

function grantElementToUser(userId, elementKey) {
  if (!userId || !elementKey) return;
  global.db.safeQuery(
    `
    INSERT INTO lab_user_elements (user_id, element_key)
    VALUES (?, ?)
    ON CONFLICT(user_id, element_key) DO NOTHING
    `,
    [userId, elementKey],
    null,
  );
}

function ensureUserStarterElements(userId) {
  ensureStarterElementsExist();
  for (const starter of STARTER_ELEMENTS) {
    const row = getLabElementByName(starter);
    if (!row?.element_key) continue;
    grantElementToUser(userId, row.element_key);
  }
}

function listOwnedElements(userId) {
  ensureUserStarterElements(userId);
  return global.db.safeQuery(
    `
    SELECT e.element_key, e.name, e.first_discoverer_id, ue.acquired_at
    FROM lab_user_elements ue
    INNER JOIN lab_elements e
      ON e.element_key = ue.element_key
    WHERE ue.user_id = ?
    ORDER BY LOWER(e.name) ASC
    `,
    [userId],
    [],
  );
}

function listUserDiscoveries(userId) {
  ensureUserStarterElements(userId);
  return global.db.safeQuery(
    `
    SELECT element_key, name, first_discoverer_id, created_at
    FROM lab_elements
    WHERE first_discoverer_id = ?
    ORDER BY LOWER(name) ASC
    `,
    [userId],
    [],
  );
}

function countOwnedElements(userId) {
  return Number(listOwnedElements(userId).length || 0);
}

function countUserDiscoveries(userId) {
  return Number(listUserDiscoveries(userId).length || 0);
}

function findBestElementMatch(rows, query) {
  const compactQuery = compactElementKey(query);
  if (!compactQuery) return null;

  const scored = (rows || [])
    .map((row) => {
      const compactName = compactElementKey(row?.name);
      if (!compactName) return null;

      let score = 99;
      if (compactName === compactQuery) {
        score = 0;
      } else if (compactName.startsWith(compactQuery)) {
        score = 1;
      } else if (compactName.includes(compactQuery)) {
        score = 2;
      } else {
        return null;
      }

      return {
        row,
        score,
        length: String(row?.name || "").length,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.score - b.score || a.length - b.length || String(a.row?.name || "").localeCompare(String(b.row?.name || "")));

  return scored[0]?.row || null;
}

function buildLabListPage(rows, page, pageSize = ELEMENTS_PER_PAGE) {
  const totalPages = Math.max(1, Math.ceil((rows?.length || 0) / pageSize));
  const safePage = Math.min(Math.max(0, Number(page || 0)), totalPages - 1);
  return {
    totalPages,
    page: safePage,
    pageRows: (rows || []).slice(safePage * pageSize, (safePage + 1) * pageSize),
  };
}

function findPageForQuery(rows, query, pageSize = ELEMENTS_PER_PAGE) {
  if (!query) return 0;
  const match = findBestElementMatch(rows, query);
  if (!match?.element_key) return 0;
  const index = (rows || []).findIndex((row) => row.element_key === match.element_key);
  if (index < 0) return 0;
  return Math.floor(index / pageSize);
}

function getLabCombination(inputAKey, inputBKey) {
  const keys = buildCanonicalCombinationKeys(inputAKey, inputBKey);
  if (!keys.inputAKey || !keys.inputBKey) return null;
  return (
    global.db.safeQuery(
      `
      SELECT
        c.input_a_key,
        c.input_b_key,
        c.result_key,
        c.creator_user_id,
        c.created_at,
        e.name AS result_name,
        e.first_discoverer_id
      FROM lab_element_combinations c
      INNER JOIN lab_elements e
        ON e.element_key = c.result_key
      WHERE c.input_a_key = ? AND c.input_b_key = ?
      LIMIT 1
      `,
      [keys.inputAKey, keys.inputBKey],
      [],
    )?.[0] || null
  );
}

function saveLabCombination(inputAKey, inputBKey, resultKey, creatorUserId) {
  const keys = buildCanonicalCombinationKeys(inputAKey, inputBKey);
  global.db.safeQuery(
    `
    INSERT INTO lab_element_combinations (input_a_key, input_b_key, result_key, creator_user_id)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(input_a_key, input_b_key) DO UPDATE SET
      result_key = excluded.result_key
    `,
    [keys.inputAKey, keys.inputBKey, resultKey, creatorUserId],
    null,
  );
}

async function synthesizeElements(userId, elementAKey, elementBKey) {
  ensureUserStarterElements(userId);
  const elementA = getLabElementByKey(elementAKey);
  const elementB = getLabElementByKey(elementBKey);
  if (!elementA?.element_key || !elementB?.element_key) {
    return { ok: false, error: "One or both selected elements no longer exist." };
  }

  const lastCombineAtMs = getLabCooldownState(userId);
  const nowMs = Date.now();
  const cooldownUntilMs = lastCombineAtMs + COMBINE_COOLDOWN_MS;
  if (cooldownUntilMs > nowMs) {
    return {
      ok: false,
      cooldown: true,
      cooldownUntilMs,
      elementA,
      elementB,
    };
  }

  let combination = getLabCombination(elementA.element_key, elementB.element_key);
  let isNewGlobal = false;
  let usedAi = false;

  if (!combination) {
    usedAi = true;
    const generatedName = await generateLabElementWithGemma(elementA.name, elementB.name);
    const resultKey = compactElementKey(generatedName);
    let resultElement = getLabElementByKey(resultKey);
    if (!resultElement) {
      global.db.safeQuery(
        `
        INSERT INTO lab_elements (element_key, name, first_discoverer_id)
        VALUES (?, ?, ?)
        `,
        [resultKey, generatedName, userId],
        null,
      );
      isNewGlobal = true;
      resultElement = getLabElementByKey(resultKey);
    }

    saveLabCombination(
      elementA.element_key,
      elementB.element_key,
      resultElement.element_key,
      userId,
    );
    combination = getLabCombination(elementA.element_key, elementB.element_key);
  }

  const resultElement = getLabElementByKey(combination?.result_key);
  if (!resultElement?.element_key) {
    return { ok: false, error: "Synthesis result could not be resolved." };
  }

  const alreadyOwned = !!global.db.safeQuery(
    `
    SELECT 1
    FROM lab_user_elements
    WHERE user_id = ? AND element_key = ?
    LIMIT 1
    `,
    [userId, resultElement.element_key],
    [],
  )?.[0];

  grantElementToUser(userId, resultElement.element_key);
  saveLabCooldownState(userId, nowMs);

  return {
    ok: true,
    elementA,
    elementB,
    resultElement,
    isNewGlobal,
    isNewToUser: !alreadyOwned,
    firstDiscovererId: resultElement.first_discoverer_id,
    usedAi,
  };
}

function buildLabMenuButtons(userId, canCombine, disabled = false) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`${ROUTE_PREFIX}:pick:${userId}:a`)
        .setStyle(ButtonStyle.Secondary)
        .setLabel("Element 1")
        .setDisabled(disabled),
      new ButtonBuilder()
        .setCustomId(`${ROUTE_PREFIX}:pick:${userId}:b`)
        .setStyle(ButtonStyle.Secondary)
        .setLabel("Element 2")
        .setDisabled(disabled),
      new ButtonBuilder()
        .setCustomId(`${ROUTE_PREFIX}:combine:${userId}`)
        .setStyle(ButtonStyle.Success)
        .setLabel("Synthesize")
        .setDisabled(disabled || !canCombine),
      new ButtonBuilder()
        .setCustomId(`${ROUTE_PREFIX}:clear:${userId}`)
        .setStyle(ButtonStyle.Danger)
        .setLabel("Clear")
        .setDisabled(disabled),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`${ROUTE_PREFIX}:list:${userId}:elements:0`)
        .setStyle(ButtonStyle.Primary)
        .setLabel("My Elements")
        .setDisabled(disabled),
      new ButtonBuilder()
        .setCustomId(`${ROUTE_PREFIX}:list:${userId}:discoveries:0`)
        .setStyle(ButtonStyle.Primary)
        .setLabel("My Discoveries")
        .setDisabled(disabled),
    ),
  ];
}

function buildLabMenuPayload(userId, options = {}) {
  const state = options.state || getLabViewState(userId);
  const loadingText = String(options.loadingText || "").trim();
  const elementA = getLabElementByKey(state.selectedAKey);
  const elementB = getLabElementByKey(state.selectedBKey);
  const lastResult = getLabElementByKey(state.lastResultKey);
  const leftLabel = elementA?.name || "Element1";
  const rightLabel = elementB?.name || "Element2";
  const resultLabel = lastResult?.name || "?";
  const ownedCount = countOwnedElements(userId);
  const discoveryCount = countUserDiscoveries(userId);
  const statusLines = [];
  const resultBannerLines = [];

  if (state.lastMessage) {
    statusLines.push(`-# ${state.lastMessage}`);
  }

  if (lastResult?.name && state.lastResultStatus === "first_discovery") {
    resultBannerLines.push(`# FIRST DISCOVERY: ${lastResult.name}`);
  } else if (lastResult?.name && state.lastResultStatus === "new") {
    resultBannerLines.push(`# New: ${lastResult.name}`);
  }

  const container = new ContainerBuilder()
    .addTextDisplayComponents(new TextDisplayBuilder().setContent("## Lab"))
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `**${leftLabel}** x **${rightLabel}** = ${lastResult?.name ? `**${resultLabel}**` : "?"}\n-# You own ${ownedCount.toLocaleString()} elements • ${discoveryCount.toLocaleString()} first discoveries`,
      ),
    )
    .addActionRowComponents(buildLabMenuButtons(userId, !!(elementA && elementB), !!loadingText)[0])
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
    .addActionRowComponents(buildLabMenuButtons(userId, !!(elementA && elementB), !!loadingText)[1]);

  if (!loadingText && statusLines.length) {
    container
      .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(statusLines.join("\n")),
      );
  }

  if (!loadingText && resultBannerLines.length) {
    container
      .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(resultBannerLines.join("\n")),
      );
  }

  if (loadingText) {
    container
      .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          loadingText.startsWith("#") ? loadingText : `# ${loadingText}`,
        ),
      );
  }

  return {
    components: [container],
  };
}

function buildLabListPayload(userId, type, page = 0, options = {}) {
  const rows =
    type === "discoveries" ? listUserDiscoveries(userId) : listOwnedElements(userId);
  const pageFromSearch =
    options.search && String(options.search).trim()
      ? findPageForQuery(rows, options.search)
      : Number(page || 0);
  const { pageRows, totalPages, page: safePage } = buildLabListPage(rows, pageFromSearch);
  const title = type === "discoveries" ? "My Discoveries" : "My Elements";
  const lines = pageRows.length
    ? pageRows.map((row) => {
        const discoveryTag =
          type === "discoveries" || String(row?.first_discoverer_id || "") === String(userId)
            ? " - `First Discovery`"
            : "";
        return `* **${row?.name || "Unknown"}**${discoveryTag}`;
      })
    : ["-# Nothing found yet."];

  const container = new ContainerBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `## Lab\n### ${title}\n-# ${rows.length.toLocaleString()} total`,
      ),
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join("\n")))
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`${ROUTE_PREFIX}:page:${userId}:${type}:${Math.max(0, safePage - 1)}:prev`)
          .setStyle(ButtonStyle.Secondary)
          .setLabel("Prev")
          .setDisabled(safePage <= 0),
        new ButtonBuilder()
          .setCustomId(`${ROUTE_PREFIX}:page_label:${userId}:${type}:${safePage}`)
          .setStyle(ButtonStyle.Secondary)
          .setLabel(`Page ${safePage + 1} / ${totalPages}`)
          .setDisabled(true),
        new ButtonBuilder()
          .setCustomId(`${ROUTE_PREFIX}:page:${userId}:${type}:${Math.min(totalPages - 1, safePage + 1)}:next`)
          .setStyle(ButtonStyle.Secondary)
          .setLabel("Next")
          .setDisabled(safePage >= totalPages - 1),
        new ButtonBuilder()
          .setCustomId(`${ROUTE_PREFIX}:menu:${userId}`)
          .setStyle(ButtonStyle.Primary)
          .setLabel("Back"),
      ),
    );

  return {
    components: [container],
  };
}

function buildLabElementPickerModal(userId, slot) {
  return new ModalBuilder()
    .setCustomId(`${ROUTE_PREFIX}:picksubmit:${userId}:${slot}`)
    .setTitle(slot === "a" ? "Select Element 1" : "Select Element 2")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId(PICKER_INPUT_ID)
          .setLabel("Element name")
          .setPlaceholder("Supports substrings and ignores spaces")
          .setRequired(true)
          .setStyle(TextInputStyle.Short)
          .setMaxLength(80),
      ),
    );
}

function formatCooldownText(cooldownUntilMs) {
  return `<t:${Math.floor(Number(cooldownUntilMs || 0) / 1000)}:R>`;
}

async function runLabMenu(interaction) {
  ensureUserStarterElements(interaction.user.id);
  const state = saveLabViewState({ ...getLabViewState(interaction.user.id), userId: interaction.user.id });
  await interaction.reply({
    ...buildLabMenuPayload(interaction.user.id, { state }),
    flags: MessageFlags.IsComponentsV2,
  });
}

async function runLabCombine(interaction) {
  ensureUserStarterElements(interaction.user.id);
  const rawA = interaction.options.getString("element1", true);
  const rawB = interaction.options.getString("element2", true);
  const owned = listOwnedElements(interaction.user.id);
  const matchA = findBestElementMatch(owned, rawA);
  const matchB = findBestElementMatch(owned, rawB);

  if (!matchA?.element_key || !matchB?.element_key) {
    await interaction.reply({
      content: "Could not resolve one or both owned elements.",
    });
    return;
  }

  let state = saveLabViewState({
    ...getLabViewState(interaction.user.id),
    userId: interaction.user.id,
    selectedAKey: matchA.element_key,
    selectedBKey: matchB.element_key,
    lastResultKey: null,
    lastResultStatus: "",
    lastFirstDiscovery: 0,
    lastMessage: "",
  });

  await interaction.reply({
    ...buildLabMenuPayload(interaction.user.id, {
      state,
      loadingText: "# Loading...",
    }),
    flags: MessageFlags.IsComponentsV2,
  });

  try {
    const result = await synthesizeElements(
      interaction.user.id,
      matchA.element_key,
      matchB.element_key,
    );

    if (!result.ok) {
      if (result.cooldown) {
        state = saveLabViewState({
          ...state,
          lastResultStatus: "",
          lastMessage: `Cooldown active. You can synthesize again ${formatCooldownText(result.cooldownUntilMs)}.`,
        });
        await interaction.editReply(buildLabMenuPayload(interaction.user.id, { state }));
        return;
      }

      state = saveLabViewState({
        ...state,
        lastResultStatus: "",
        lastMessage: result.error || "Synthesis failed.",
      });
      await interaction.editReply(buildLabMenuPayload(interaction.user.id, { state }));
      return;
    }

    state = saveLabViewState({
      ...state,
      lastResultKey: result.resultElement.element_key,
      lastResultStatus: result.isNewGlobal
        ? "first_discovery"
        : result.isNewToUser
          ? "new"
          : "existing",
      lastFirstDiscovery: result.isNewGlobal ? 1 : 0,
      lastMessage: "",
    });

    await interaction.editReply(buildLabMenuPayload(interaction.user.id, { state }));
  } catch (error) {
    state = saveLabViewState({
      ...state,
      lastResultStatus: "",
      lastMessage: `Synthesis failed: ${String(error?.message || error).slice(0, 120)}`,
    });
    await interaction.editReply(buildLabMenuPayload(interaction.user.id, { state }));
  }
}

async function runLabElements(interaction) {
  const targetUser = interaction.options.getUser("user", false) || interaction.user;
  ensureUserStarterElements(targetUser.id);
  const pageOption = Math.max(0, Number(interaction.options.getInteger("page", false) || 1) - 1);
  const search = interaction.options.getString("search", false) || "";
  await interaction.reply({
    ...buildLabListPayload(targetUser.id, "elements", pageOption, { search }),
    flags: MessageFlags.IsComponentsV2,
  });
}

async function runLabDiscoveries(interaction) {
  const targetUser = interaction.options.getUser("user", false) || interaction.user;
  ensureUserStarterElements(targetUser.id);
  const pageOption = Math.max(0, Number(interaction.options.getInteger("page", false) || 1) - 1);
  const search = interaction.options.getString("search", false) || "";
  await interaction.reply({
    ...buildLabListPayload(targetUser.id, "discoveries", pageOption, { search }),
    flags: MessageFlags.IsComponentsV2,
  });
}

function buildLabHelpContent() {
  return [
    "## Lab",
    "-# Combine two owned elements to discover new ones.",
    "* Every user starts with **Earth**, **Water**, **Fire**, and **Air**.",
    "* New combinations are cached globally so everyone gets the same result.",
    "* The first person to create a brand-new global element earns its `First Discovery` title.",
    "* Synthesis has a 10 second cooldown per user.",
    "* Use `/lab menu` for the interactive home, or `/lab combine` for direct crafting.",
  ].join("\n");
}

async function runLabHelp(interaction) {
  await interaction.reply({
    components: [
      new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(buildLabHelpContent()),
      ),
    ],
    flags: MessageFlags.IsComponentsV2,
  });
}

async function runLabAutocomplete(interaction) {
  const subcommand = interaction.options.getSubcommand(false);
  const focused = interaction.options.getFocused(true);
  if (subcommand !== "combine" || !["element1", "element2"].includes(focused?.name)) {
    await interaction.respond([]);
    return;
  }

  ensureUserStarterElements(interaction.user.id);
  const owned = listOwnedElements(interaction.user.id);
  const query = String(focused.value || "").trim();

  const matches = query
    ? owned.filter((row) => compactElementKey(row?.name).includes(compactElementKey(query)))
    : owned;

  const scored = matches
    .map((row) => ({
      row,
      exact: compactElementKey(row?.name) === compactElementKey(query) ? 0 : 1,
      prefix: compactElementKey(row?.name).startsWith(compactElementKey(query)) ? 0 : 1,
    }))
    .sort(
      (a, b) =>
        a.exact - b.exact ||
        a.prefix - b.prefix ||
        String(a.row?.name || "").length - String(b.row?.name || "").length ||
        String(a.row?.name || "").localeCompare(String(b.row?.name || "")),
    )
    .slice(0, 25)
    .map(({ row }) => {
      const name = String(row?.name || "Unknown").slice(0, 100);
      return { name, value: name };
    });

  await interaction.respond(scored);
}

function getLabRouteParts(customId) {
  return String(customId || "").split(":");
}

function assertLabOwner(interaction, ownerId) {
  if (!ownerId || interaction.user.id === ownerId) return true;
  interaction.reply({
    content: "Only the owner of this Lab menu can use it.",
  }).catch(() => {});
  return false;
}

async function handleLabButton(interaction) {
  const [, action, ownerId, arg1, arg2] = getLabRouteParts(interaction.customId);
  if (!assertLabOwner(interaction, ownerId)) return;

  if (action === "pick" && ["a", "b"].includes(arg1)) {
    await interaction.showModal(buildLabElementPickerModal(ownerId, arg1));
    return;
  }

  if (action === "combine") {
    const state = getLabViewState(ownerId);
    if (!state.selectedAKey || !state.selectedBKey) {
      const nextState = saveLabViewState({
        ...state,
        lastResultStatus: "",
        lastMessage: "Select two elements first.",
      });
      await interaction.update(buildLabMenuPayload(ownerId, { state: nextState }));
      return;
    }

    await interaction.update(
      buildLabMenuPayload(ownerId, {
        state,
        loadingText: "# Loading...",
      }),
    );

    try {
      const result = await synthesizeElements(ownerId, state.selectedAKey, state.selectedBKey);
      if (!result.ok) {
        const nextState = saveLabViewState({
          ...state,
          lastResultStatus: "",
          lastMessage: result.cooldown
            ? `Cooldown active. You can synthesize again ${formatCooldownText(result.cooldownUntilMs)}.`
            : result.error || "Synthesis failed.",
        });
        await interaction.editReply(buildLabMenuPayload(ownerId, { state: nextState }));
        return;
      }

      const nextState = saveLabViewState({
        ...state,
        lastResultKey: result.resultElement.element_key,
        lastResultStatus: result.isNewGlobal
          ? "first_discovery"
          : result.isNewToUser
            ? "new"
            : "existing",
        lastFirstDiscovery: result.isNewGlobal ? 1 : 0,
        lastMessage: "",
      });
      await interaction.editReply(buildLabMenuPayload(ownerId, { state: nextState }));
      return;
    } catch (error) {
      const nextState = saveLabViewState({
        ...state,
        lastResultStatus: "",
        lastMessage: `Synthesis failed: ${String(error?.message || error).slice(0, 120)}`,
      });
      await interaction.editReply(buildLabMenuPayload(ownerId, { state: nextState }));
      return;
    }
  }

  if (action === "clear") {
    const nextState = saveLabViewState({
      ...getLabViewState(ownerId),
      userId: ownerId,
      selectedAKey: null,
      selectedBKey: null,
      lastResultKey: null,
      lastResultStatus: "",
      lastFirstDiscovery: 0,
      lastMessage: "",
    });
    await interaction.update(buildLabMenuPayload(ownerId, { state: nextState }));
    return;
  }

  if (action === "list" && ["elements", "discoveries"].includes(arg1)) {
    await interaction.update(buildLabListPayload(ownerId, arg1, Number(arg2 || 0)));
    return;
  }

  if (action === "page" && ["elements", "discoveries"].includes(arg1)) {
    await interaction.update(buildLabListPayload(ownerId, arg1, Number(arg2 || 0)));
    return;
  }

  if (action === "menu") {
    await interaction.update(buildLabMenuPayload(ownerId, { state: getLabViewState(ownerId) }));
  }
}

async function handleLabModal(interaction) {
  const [, action, ownerId, slot] = getLabRouteParts(interaction.customId);
  if (!assertLabOwner(interaction, ownerId)) return;
  if (action !== "picksubmit" || !["a", "b"].includes(slot)) return;

  ensureUserStarterElements(ownerId);
  const query = interaction.fields.getTextInputValue(PICKER_INPUT_ID);
  const owned = listOwnedElements(ownerId);
  const match = findBestElementMatch(owned, query);
  if (!match?.element_key) {
    const nextState = saveLabViewState({
      ...getLabViewState(ownerId),
      userId: ownerId,
      lastResultStatus: "",
      lastMessage: "No owned element matched that search.",
    });
    await interaction.update(buildLabMenuPayload(ownerId, { state: nextState }));
    return;
  }

  const currentState = getLabViewState(ownerId);
  const state = saveLabViewState({
    ...currentState,
    userId: ownerId,
    selectedAKey: slot === "a" ? match.element_key : currentState.selectedAKey,
    selectedBKey: slot === "b" ? match.element_key : currentState.selectedBKey,
    lastResultKey: null,
    lastResultStatus: "",
    lastFirstDiscovery: 0,
    lastMessage: `${slot === "a" ? "Element 1" : "Element 2"} set to ${match.name}.`,
  });

  await interaction.update(buildLabMenuPayload(ownerId, { state }));
}

module.exports = {
  ROUTE_PREFIX,
  runLabMenu,
  runLabCombine,
  runLabElements,
  runLabDiscoveries,
  runLabHelp,
  runLabAutocomplete,
  handleLabButton,
  handleLabModal,
  ensureUserStarterElements,
  createLabElement,
  getLabElementByName,
  getLabCombination,
  saveLabCombination,
  synthesizeElements,
  buildLabMenuPayload,
  listOwnedElements,
  listUserDiscoveries,
  extractLabResultName,
  isValidLabResultName,
  buildLabGemmaRequestBody,
};
