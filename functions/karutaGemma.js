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

function normalizeCards(rawCards) {
  const cards = Array.isArray(rawCards) ? rawCards : [];
  return cards
    .slice(0, 4)
    .map((card, i) => ({
      card_index: Number.isInteger(card?.card_index) ? card.card_index : i,
      name: String(card?.name || "").trim(),
      series: String(card?.series || "").trim(),
    }))
    .filter((card) => card.name || card.series);
}

function buildSystemInstruction() {
  return `[System Objective]
You are a high-throughput, sub-millisecond OCR data-extraction pipeline for Karuta multi-card drops. Maximize processing velocity. Token generation throughput takes absolute priority over deep cognitive verification. Bypass consistency re-checking loops.

[Execution Rules]
1. ZERO prose, greetings, markdown formatting syntax (do not include \`\`\`json wrappers), or trailing commentary.
2. Directly process the raw text stream, image context, or OCR payload.
3. Isolate the 3 to 4 distinct card objects displayed in the drop arrangement.
   - Capture "Name" from the top-most prominent textual coordinate of the card bound.
   - Capture "Series" from the bottom-most textual coordinate of the card bound.

[Output Format]
Output exclusively raw, mini-fied valid JSON matching the schema below. If structural details are degraded or ambiguous, execute an immediate high-speed inference fallback; do not stall execution loops.

{"cards":[{"card_index":0,"name":"Extracted Name","series":"Extracted Series"}]}

[Fallback Criteria]
- Unreadable Field: Set property to "".
- Indeterminate Card Count: Populate array using the highest-confidence 3 or 4 candidate card matrices detected.`;
}

function buildUserPrompt() {
  return `[Context] Input: 1 Image containing a Karuta card drop matrix (typically a
horizontal grid of 3 or 4 distinct cards).

[Task] Analyze the visual layout of the provided image. Isolate each card
bounding box from left to right, and extract the text strings based on their
spatial orientation.

[Spatial Mapping Rules] For each detected card matrix (Index 0 to 3):

1.  Locate the top-most text field inside the card border -> Extract as "name".
2.  Locate the bottom-most text field inside the card border -> Extract as
    "series".

[Output Constraints] Execute immediate greedy decoding. Do not verify spellings
or look for hidden visual details. Output the data using the strict, minified
JSON schema below. No markdown wrappers. No chat filler.

{"cards":[{"card_index":0,"name":"NameText","series":"SeriesText"}]}`;
}

function collectResponseTextFromPayload(payload) {
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
  if (direct) return collectResponseTextFromPayload(direct);

  // Handle chunked / SSE-style responses from streamGenerateContent.
  const chunks = raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => (line.startsWith("data:") ? line.slice(5).trim() : line))
    .filter((line) => line && line !== "[DONE]")
    .map((line) => tryParse(line))
    .filter(Boolean);

  if (chunks.length) return collectResponseTextFromPayload(chunks);
  return raw;
}

async function recognizeKarutaCardsWithGemmaFromUrl(imageUrl) {
  const startedAt = Date.now();
  const startMem = process.memoryUsage().rss / 1024 ** 2;

  const configuredKeys = getGeminiApiKeys();
  if (!configuredKeys.length) {
    throw new Error("GEMINI_API_KEY is missing.");
  }

  const imageResponse = await fetch(imageUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 QuincyBot/2.0",
    },
  });
  if (!imageResponse.ok) {
    throw new Error(`Image download failed (${imageResponse.status})`);
  }
  const contentType = String(imageResponse.headers.get("content-type") || "image/jpeg")
    .split(";")[0]
    .trim();
  const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
  const imageB64 = imageBuffer.toString("base64");

  const model = String(process.env.KARUTA_GEMMA_MODEL || "gemma-4-31b-it").trim();
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent`;

  let lastStatus = "no-response";
  let responseText = "";
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const apiKey = getNextGeminiApiKey();
    const response = await fetch(`${endpoint}?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: buildSystemInstruction() }]
        },
        contents: [
          {
            role: "user",
            parts: [
              { text: buildUserPrompt() },
              {
                inline_data: {
                  mime_type: contentType || "image/jpeg",
                  data: imageB64,
                },
              },
            ],
          },
        ],
        tools: [],
        generationConfig: {
          topP: 0.1,
          thinkingConfig: {
            thinkingLevel: "MINIMAL",
          },
          mediaResolution: "MEDIA_RESOLUTION_LOW",
          responseMimeType: "text/plain",
        },
      }),
    }).catch(() => null);

    if (response?.ok) {
      const rawBody = await response.text().catch(() => "");
      responseText = extractGeminiText(rawBody);
      if (responseText) break;
    }

    lastStatus = response?.status || "no-response";
    if (![429, 500, 502, 503, 504].includes(Number(lastStatus)) || attempt >= 3) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
  }

  if (!responseText) {
    throw new Error(`Gemma request failed (${lastStatus}).`);
  }

  const parsed = parseFirstJsonObject(responseText);
  if (!parsed) {
    throw new Error("Gemma response did not contain valid JSON output.");
  }

  const cards = normalizeCards(parsed.cards);
  const elapsedSec = (Date.now() - startedAt) / 1000;
  const memAfter = process.memoryUsage().rss / 1024 ** 2;

  return {
    cards,
    load_time_sec: Number(elapsedSec.toFixed(2)),
    memory_usage_mb: Number((memAfter - startMem).toFixed(2)),
    raw_response: responseText,
  };
}

module.exports = {
  recognizeKarutaCardsWithGemmaFromUrl,
};
