const {
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  SeparatorBuilder,
  TextDisplayBuilder,
} = require("discord.js");
const { evaluate } = require("mathjs");
const sharp = require("sharp");
const { expandCompactNumbersInExpression } = require("../../../utils/numberParser");

function formatCompactNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);

  const abs = Math.abs(n);
  if (abs >= 1e12) return `${(n / 1e12).toFixed(2)}t`;
  if (abs >= 1e9) return `${(n / 1e9).toFixed(2)}b`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(2)}m`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(2)}k`;
  return n.toFixed(2);
}

function basicCommonLatex(input) {
  let latex = String(input || "").trim();
  if (!latex) return "";

  latex = latex
    .replace(/\\/g, "\\\\")
    .replace(/<=/g, " \\le ")
    .replace(/>=/g, " \\ge ")
    .replace(/!=/g, " \\ne ")
    .replace(/\bpi\b/gi, "\\pi")
    .replace(/\*/g, " \\times ");

  latex = latex.replace(
    /\b(sqrt|sin|cos|tan|log|ln|abs)\s*\(([^()]+)\)/gi,
    (_, fn, inner) => {
      const f = String(fn).toLowerCase();
      if (f === "sqrt") return `\\sqrt{${inner}}`;
      if (f === "abs") return `\\left|${inner}\\right|`;
      return `\\${f}\\left(${inner}\\right)`;
    },
  );

  latex = latex.replace(
    /([A-Za-z0-9)\]}]+)\s*\^\s*([A-Za-z0-9({\[][A-Za-z0-9+\-*/().,\s]*)/g,
    (_, left, right) => `${left}^{${String(right).trim()}}`,
  );

  latex = latex.replace(
    /([A-Za-z0-9)\]}]+)\s*\/\s*([A-Za-z0-9({\[][A-Za-z0-9+\-*/().,\s]*)/g,
    (_, left, right) => `\\frac{${String(left).trim()}}{${String(right).trim()}}`,
  );

  return latex.replace(/\s{2,}/g, " ").trim();
}

async function renderLatexToScaledPng(latex) {
  const latexImageUrl = `https://latex.codecogs.com/svg.image?${encodeURIComponent(latex)}`;
  const response = await fetch(latexImageUrl, {
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    throw new Error(`LaTeX image request failed (${response.status})`);
  }

  const sourceBuffer = Buffer.from(await response.arrayBuffer());
  const renderedPng = await sharp(sourceBuffer, { density: 600 }).png().toBuffer();
  const metadata = await sharp(renderedPng).metadata();
  const width = Number(metadata.width) || 0;
  const height = Number(metadata.height) || 0;

  if (!width || !height) {
    return renderedPng;
  }

  const scaled = await sharp(renderedPng)
    .resize(
      Math.max(1, Math.floor(width * 0.05)),
      Math.max(1, Math.floor(height * 0.05)),
      {
        kernel: sharp.kernel.nearest,
      },
    )
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const yellow = { r: 255, g: 221, b: 87 };
  for (let i = 0; i < scaled.data.length; i += 4) {
    const alpha = scaled.data[i + 3];
    if (alpha === 0) continue;
    scaled.data[i] = yellow.r;
    scaled.data[i + 1] = yellow.g;
    scaled.data[i + 2] = yellow.b;
  }

  return sharp(scaled.data, {
    raw: {
      width: scaled.info.width,
      height: scaled.info.height,
      channels: 4,
    },
  })
    .png()
    .toBuffer();
}

function buildCalculatorPayload({ attachmentName, solution, raw, compact }) {
  return {
    components: [
      new ContainerBuilder()
        .setAccentColor(0x2ecc71)
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent("## Calculator"),
        )
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
        .addMediaGalleryComponents(
          new MediaGalleryBuilder().addItems(
            new MediaGalleryItemBuilder().setURL(`attachment://${attachmentName}`),
          ),
        )
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `**Solution:** ${solution}\n**Raw:** ${raw}\n**Compact:** ${compact}`,
          ),
        ),
    ],
    flags: MessageFlags.IsComponentsV2,
  };
}

async function runCalculator(interaction) {
  const prompt = interaction.options.getString("prompt", true);
  const normalizedInput = expandCompactNumbersInExpression(prompt);

  let result;
  try {
    result = evaluate(normalizedInput);
  } catch (error) {
    await interaction.reply({
      content: `Invalid equation: ${error?.message || "Could not parse input."}`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const latex = basicCommonLatex(normalizedInput);
  const numeric = Number(result);
  const solution = Number.isFinite(numeric)
    ? String(Math.trunc(numeric))
    : String(result);
  const raw = Number.isFinite(numeric)
    ? numeric.toLocaleString("en-US", {
        minimumFractionDigits: 1,
        maximumFractionDigits: 12,
      })
    : String(result);
  const compact = Number.isFinite(numeric)
    ? formatCompactNumber(numeric)
    : String(result);

  let scaledLatex;
  try {
    scaledLatex = await renderLatexToScaledPng(latex);
  } catch (error) {
    await interaction.reply({
      content: `Failed to render LaTeX image: ${error?.message || "unknown error"}`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const attachmentName = "calculator-latex.png";

  await interaction.reply(
    {
      ...buildCalculatorPayload({
        attachmentName,
        solution,
        raw,
        compact,
      }),
      files: [{ attachment: scaledLatex, name: attachmentName }],
    },
  );
}

module.exports = {
  runCalculator,
};
