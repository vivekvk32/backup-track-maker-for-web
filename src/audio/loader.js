import { analyzeBuffer } from "./analysis";

export const SAMPLE_CATEGORIES = [
  "kick",
  "snare",
  "clap",
  "closed_hat",
  "open_hat",
  "crash",
  "ride",
  "tom",
  "shaker",
  "perc",
  "cowbell",
  "unknown"
];

function toPublicUrl(relativePath) {
  const encoded = relativePath.split("/").map((segment) => encodeURIComponent(segment));
  return `/${encoded.join("/")}`;
}

function containsAny(name, keywords) {
  return keywords.some((keyword) => name.includes(keyword));
}

function containsRegex(name, pattern) {
  return pattern.test(name);
}

export function categorizeSampleName(fileName, samplePath = "") {
  const name = String(fileName || "")
    .toLowerCase()
    .replace(/[_-]+/g, " ");
  const pathHint = String(samplePath || "")
    .toLowerCase()
    .replace(/[\\/]+/g, " ")
    .replace(/[_-]+/g, " ");
  const context = `${name} ${pathHint}`;

  if (
    containsAny(context, ["open", "ohh", "hho", "openhat", "hatopen", "open hatz"]) ||
    containsRegex(context, /\brd\s*c\s*oh\b/) ||
    containsRegex(context, /\bcym\s*oh\b/)
  ) {
    return "open_hat";
  }

  if (
    containsAny(context, ["closed", "chh", "hhc", "closedhat", "hatclosed", "closed hatz"]) ||
    containsRegex(context, /\brd\s*c\s*hh\b/) ||
    containsRegex(context, /\bcym\s*hh\b/)
  ) {
    return "closed_hat";
  }

  if (
    containsAny(context, ["kick", "kicks", "kickz", "bass drum", "bassdrum", "bombo", "bombos"]) ||
    containsRegex(context, /\bbd\b/) ||
    containsRegex(context, /\brd\s*k\b/)
  ) {
    return "kick";
  }
  if (
    containsAny(context, ["snare", "tambor", "tambores"]) ||
    containsRegex(context, /\brd\s*s\b/) ||
    containsRegex(context, /\brim\s*shot\b/) ||
    containsRegex(context, /\brimshot\b/)
  ) {
    return "snare";
  }
  if (containsAny(context, ["crash", "platillo"]) || containsRegex(context, /\brd\s*c\s*c\b/)) {
    return "crash";
  }
  if (containsAny(context, ["ride"]) || containsRegex(context, /\brd\s*c\s*r\b/)) return "ride";
  if (containsAny(context, ["clap"]) || containsRegex(context, /\brd\s*c\s*\d/)) return "clap";
  if (containsAny(context, ["tom"]) || containsRegex(context, /\brd\s*t\b/)) return "tom";
  if (containsAny(context, ["shaker"]) || containsRegex(context, /\brd\s*p\s*sh\b/))
    return "shaker";
  if (
    containsAny(context, ["perc", "percussion", "percu", "voxp", "impacto", "impactos", "golpes"]) ||
    containsRegex(context, /\brd\s*p\b/)
  ) {
    return "perc";
  }
  if (containsAny(context, ["cowbell", "cencerro"]) || containsRegex(context, /\brd\s*p\s*bb\b/))
    return "cowbell";

  if (containsAny(context, ["hihat", "hats", "hat"])) {
    return "closed_hat";
  }

  return "unknown";
}

function createCategoryMap() {
  return new Map(SAMPLE_CATEGORIES.map((category) => [category, []]));
}

export async function loadSamples(audioContext, { onProgress } = {}) {
  const manifestResponse = await fetch("/samples.json", { cache: "no-store" });
  if (!manifestResponse.ok) {
    throw new Error(
      "Could not load /samples.json. Run `npm run gen:samples` and restart the dev server."
    );
  }

  const rawManifest = await manifestResponse.json();
  if (!Array.isArray(rawManifest)) {
    throw new Error("Invalid samples.json format. Expected an array.");
  }

  const manifest = rawManifest
    .filter((entry) => entry && typeof entry.path === "string")
    .map((entry) => ({
      path: entry.path,
      name: entry.name || entry.path.split("/").at(-1) || "unknown.wav",
      pack: entry.pack || "unknown-pack"
    }));

  const buffersByPath = new Map();
  const sampleMetaByPath = new Map();
  const samplesByCategory = createCategoryMap();
  const failed = [];

  const total = manifest.length;
  let loaded = 0;

  for (const entry of manifest) {
    try {
      const sampleResponse = await fetch(toPublicUrl(entry.path));
      if (!sampleResponse.ok) {
        throw new Error(`HTTP ${sampleResponse.status}`);
      }

      const arrayBuffer = await sampleResponse.arrayBuffer();
      const decoded = await audioContext.decodeAudioData(arrayBuffer.slice(0));

      const category = categorizeSampleName(entry.name, entry.path);
      const analysis = analyzeBuffer(decoded);
      const meta = {
        ...entry,
        category,
        analysis
      };

      buffersByPath.set(entry.path, decoded);
      sampleMetaByPath.set(entry.path, meta);
      samplesByCategory.get(category).push(meta);
    } catch (error) {
      failed.push({
        path: entry.path,
        reason: String(error?.message || error)
      });
    } finally {
      loaded += 1;
      if (onProgress) {
        onProgress({ loaded, total });
      }
    }
  }

  for (const list of samplesByCategory.values()) {
    list.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  }

  return {
    manifest,
    buffersByPath,
    sampleMetaByPath,
    samplesByCategory,
    failed
  };
}
