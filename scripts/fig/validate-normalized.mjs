import { loadNormalizedJson, summarizePayload, validateNormalizedPayload } from "./shared.mjs";

async function main() {
  const inputPath = process.argv[2];

  if (!inputPath) {
    throw new Error("Uso: node scripts/fig/validate-normalized.mjs <path-json-normalizzato>");
  }

  const { absolutePath, data } = await loadNormalizedJson(inputPath);
  validateNormalizedPayload(data);

  const summary = summarizePayload(data);

  console.log("Normalized JSON valido.");
  console.log(`File: ${absolutePath}`);
  console.log(`Club: ${summary.club}`);
  console.log(`Percorsi: ${summary.routes}`);
  console.log(`Combinazioni ufficiali: ${summary.routeCombinations}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
