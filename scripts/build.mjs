import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";

const outputDirectory = new URL("../dist/", import.meta.url);
const sourceDirectory = new URL("../", import.meta.url);
let localEnvironment = "";
try {
  localEnvironment = await readFile(new URL("../.env", import.meta.url), "utf8");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const localValues = Object.fromEntries(localEnvironment.split(/\r?\n/).flatMap((line) => {
  const match = line.match(/^\s*(SUPABASE_URL|SUPABASE_ANON_KEY)\s*=\s*(.*?)\s*$/);
  if (!match) return [];
  const rawValue = match[2];
  const value = rawValue.length >= 2 && rawValue[0] === rawValue.at(-1) && ["'", '"'].includes(rawValue[0])
    ? rawValue.slice(1, -1)
    : rawValue;
  return [[match[1], value]];
}));
const supabaseUrl = process.env.SUPABASE_URL ?? localValues.SUPABASE_URL ?? "";
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY ?? localValues.SUPABASE_ANON_KEY ?? "";
const isConfigured = supabaseUrl.startsWith("https://") && supabaseAnonKey.length > 20;

if (process.env.CONTEXT === "production" && !isConfigured) {
  throw new Error("Production builds require SUPABASE_URL and SUPABASE_ANON_KEY.");
}

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });
for (const entry of ["index.html", "css", "js"]) {
  await cp(new URL(entry, sourceDirectory), new URL(entry, outputDirectory), { recursive: true });
}

const config = `window.APP_CONFIG = Object.freeze({\n  supabaseUrl: ${JSON.stringify(supabaseUrl)},\n  supabaseAnonKey: ${JSON.stringify(supabaseAnonKey)}\n});\n`;
await writeFile(new URL("js/config.js", outputDirectory), config, "utf8");
console.log(isConfigured ? "Built with Supabase public configuration." : "Built without Supabase configuration; admin features will be unavailable.");
