const { createCalculatorResponse } = require("../interactions/slashHandlers/calculator");

const NUMBER = String.raw`[+-]?(?:\d+(?:,\d{3})*|\d+)(?:\.\d+)?[kmbt]?`;
const TOKEN = String.raw`(?:${NUMBER}|\(|\))`;
const OPERATOR = String.raw`[+\-*/^]`;
const MATH_EXPRESSION_RE = new RegExp(
  String.raw`^\s*${TOKEN}(?:\s*(?:${OPERATOR}|${TOKEN})\s*)+\s*$`,
  "i",
);
const HAS_OPERATOR_RE = /[+\-*/^]/;
const HAS_NUMBER_RE = /\d/;

function isLikelyMathExpression(content) {
  const text = String(content || "").trim();
  if (text.length < 3 || text.length > 160) return false;
  if (!HAS_NUMBER_RE.test(text) || !HAS_OPERATOR_RE.test(text)) return false;
  if (/[a-z]/i.test(text.replace(/[kmbt]/gi, ""))) return false;
  return MATH_EXPRESSION_RE.test(text);
}

async function handleUserMathMessage(message) {
  if (!message || message.author?.bot) return false;
  if (!isLikelyMathExpression(message.content)) return false;

  const response = await createCalculatorResponse(message.content);
  if (response.error) return false;

  await message.reply(response).catch(() => {});
  return true;
}

module.exports = {
  handleUserMathMessage,
  isLikelyMathExpression,
};
