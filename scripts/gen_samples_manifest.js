import { promises as fs } from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();
const samplesRoot = path.join(projectRoot, "public", "samples");
const outputPath = path.join(projectRoot, "public", "samples.json");

async function walkDirectory(dirPath, collector) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const absolutePath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      await walkDirectory(absolutePath, collector);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    if (path.extname(entry.name).toLowerCase() !== ".wav") {
      continue;
    }

    const relativeFromSamples = path
      .relative(samplesRoot, absolutePath)
      .split(path.sep)
      .join("/");

    const [pack = "unknown-pack"] = relativeFromSamples.split("/");
    collector.push({
      path: `samples/${relativeFromSamples}`,
      name: path.basename(entry.name),
      pack
    });
  }
}

async function main() {
  try {
    const rootStat = await fs.stat(samplesRoot).catch(() => null);
    if (!rootStat || !rootStat.isDirectory()) {
      console.error(
        `Missing samples directory: ${samplesRoot}\nCreate it and add WAV packs before running gen:samples.`
      );
      process.exit(1);
    }

    const manifest = [];
    await walkDirectory(samplesRoot, manifest);

    manifest.sort((a, b) => {
      const packCompare = a.pack.localeCompare(b.pack, undefined, {
        sensitivity: "base"
      });
      if (packCompare !== 0) {
        return packCompare;
      }
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });

    await fs.writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    console.log(`Wrote ${manifest.length} sample entries to ${outputPath}`);

    if (manifest.length === 0) {
      console.warn("No WAV files were found under public/samples.");
    }
  } catch (error) {
    console.error("Failed to generate samples manifest.");
    console.error(error);
    process.exit(1);
  }
}

main();
