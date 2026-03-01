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

function buildGemmaPrompt() {
  return [
    "You see 3 or 4 cards. Extract and list the following details for each card:",
    "",
    "Name (Top first text)",
    "Series (Bottom Text)",
    "",
    "Provide the output as a consistent JSON with this format:",
    '{ "cards": [ { "card_index": 0, "name": "Name", "series": "Series" } ] }',
    "",
    "Fallback:",
    '- If a field is unreadable, set it to "".',
    "- If card count is uncertain, return the best 3 or 4 cards detected.",
    "- Return only JSON without markdown or extra explanation.",
  ].join("\n");
}

async function recognizeKarutaCardsWithGemmaFromUrl(imageUrl) {
  const startedAt = Date.now();
  const startMem = process.memoryUsage().rss / 1024 ** 2;

  const apiKey = String(process.env.GEMINI_API_KEY || "").trim();
  if (!apiKey) {
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

  const model = String(process.env.KARUTA_GEMMA_MODEL || "gemma-3-27b-it").trim();
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

  let lastStatus = "no-response";
  let responseText = "";
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const response = await fetch(`${endpoint}?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: buildGemmaPrompt() },
              {
                inline_data: {
                  mime_type: contentType || "image/jpeg",
                  data: imageB64,
                },
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.1,
        },
      }),
    }).catch(() => null);

    if (response?.ok) {
      const json = await response.json().catch(() => null);
      responseText = String(
        json?.candidates?.[0]?.content?.parts?.map((part) => part?.text || "").join("\n") || "",
      ).trim();
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
