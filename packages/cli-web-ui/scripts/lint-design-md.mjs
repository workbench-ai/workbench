import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const designPath = path.join(packageRoot, "DESIGN.md");

function findFrontmatterBounds(content) {
  if (!content.startsWith("---\n")) {
    throw new Error("DESIGN.md must start with YAML frontmatter for design.md linting.");
  }

  const endIndex = content.indexOf("\n---", 4);
  if (endIndex === -1) {
    throw new Error("DESIGN.md frontmatter is missing the closing --- delimiter.");
  }

  return {
    start: 4,
    end: endIndex,
  };
}

function parseOklch(value) {
  const [channelsPart, alphaPart] = value.split("/").map((part) => part.trim());
  const channels = channelsPart.split(/\s+/).filter(Boolean);
  if (channels.length !== 3) {
    throw new Error(`Expected three OKLCH channels, received: ${value}`);
  }

  const lightness = channels[0].endsWith("%")
    ? Number.parseFloat(channels[0]) / 100
    : Number.parseFloat(channels[0]);
  const chroma = Number.parseFloat(channels[1]);
  const hue = parseHue(channels[2]);
  const alpha = alphaPart ? parseAlpha(alphaPart) : 1;

  for (const [name, channel] of [
    ["lightness", lightness],
    ["chroma", chroma],
    ["hue", hue],
    ["alpha", alpha],
  ]) {
    if (!Number.isFinite(channel)) {
      throw new Error(`Invalid OKLCH ${name} in: ${value}`);
    }
  }

  return { lightness, chroma, hue, alpha };
}

function parseHue(value) {
  if (value.endsWith("deg")) {
    return Number.parseFloat(value);
  }
  if (value.endsWith("rad")) {
    return (Number.parseFloat(value) * 180) / Math.PI;
  }
  if (value.endsWith("turn")) {
    return Number.parseFloat(value) * 360;
  }
  return Number.parseFloat(value);
}

function parseAlpha(value) {
  if (value.endsWith("%")) {
    return Number.parseFloat(value) / 100;
  }
  return Number.parseFloat(value);
}

function clamp01(value) {
  if (value < 0) {
    return { value: 0, clipped: true };
  }
  if (value > 1) {
    return { value: 1, clipped: true };
  }
  return { value, clipped: false };
}

function linearToSrgb(value) {
  return value <= 0.0031308
    ? 12.92 * value
    : 1.055 * value ** (1 / 2.4) - 0.055;
}

function channelToHex(value) {
  return Math.round(value * 255)
    .toString(16)
    .padStart(2, "0");
}

function oklchToHex(oklch) {
  const hueRadians = (oklch.hue * Math.PI) / 180;
  const a = oklch.chroma * Math.cos(hueRadians);
  const b = oklch.chroma * Math.sin(hueRadians);

  const lPrime = oklch.lightness + 0.3963377774 * a + 0.2158037573 * b;
  const mPrime = oklch.lightness - 0.1055613458 * a - 0.0638541728 * b;
  const sPrime = oklch.lightness - 0.0894841775 * a - 1.291485548 * b;

  const l = lPrime ** 3;
  const m = mPrime ** 3;
  const s = sPrime ** 3;

  const linearRgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];

  let clipped = false;
  const srgb = linearRgb.map((channel) => {
    const clampedLinear = clamp01(channel);
    clipped ||= clampedLinear.clipped;
    const encoded = clamp01(linearToSrgb(clampedLinear.value));
    clipped ||= encoded.clipped;
    return encoded.value;
  });

  const hex = `#${srgb.map(channelToHex).join("")}`;
  return { hex, clipped };
}

function preprocessOklchInFrontmatter(content) {
  const bounds = findFrontmatterBounds(content);
  const frontmatter = content.slice(bounds.start, bounds.end);
  const body = content.slice(bounds.end);
  const conversions = [];

  const transformedFrontmatter = frontmatter.replace(/oklch\(([^)]+)\)/g, (original, value) => {
    const conversion = oklchToHex(parseOklch(value));
    conversions.push({ original, ...conversion });
    return conversion.hex;
  });

  return {
    content: `---\n${transformedFrontmatter}${body}`,
    conversions,
  };
}

async function runDesignMdLint(content) {
  return await new Promise((resolve) => {
    const child = spawn(
      "npx",
      ["--yes", "@google/design.md", "lint", "--", "-"],
      {
        cwd: packageRoot,
        stdio: ["pipe", "inherit", "inherit"],
      }
    );

    child.stdin.end(content);
    child.on("close", resolve);
  });
}

async function main() {
  const source = await readFile(designPath, "utf8");
  const { content, conversions } = preprocessOklchInFrontmatter(source);
  const clipped = conversions.filter((conversion) => conversion.clipped);

  if (conversions.length > 0) {
    console.error(
      `design.md OKLCH preprocess: converted ${conversions.length} color token${conversions.length === 1 ? "" : "s"} to sRGB for upstream lint.`
    );
  }

  if (clipped.length > 0) {
    console.error("design.md OKLCH preprocess: gamut clipping occurred:");
    for (const conversion of clipped) {
      console.error(`- ${conversion.original} -> ${conversion.hex}`);
    }
  }

  const exitCode = await runDesignMdLint(content);
  process.exit(exitCode ?? 1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
