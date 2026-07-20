import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

// Quick inline import won't work for TS - duplicate minimal test by reading compiled logic
// Use dynamic import if tsx available
try {
  const { parseAiGeneratedMcqAnswer } = await import("../utils/parseAiMcq.ts");
  const sample = `Soalan 1
EN: An atom X has 14 neutrons and forms an ion X3? with 14 electrons. What is the nucleon number of atom X?
BM: Satu atom X mempunyai 14 neutron dan membentuk ion X3? dengan 14 elektron. Berapakah nombor nukleon bagi atom X?
A. 14
B. 24
C. 27
D. 30

Jawapan: C
Penjelasan: Ion X3? mempunyai 14 elektron

Soalan 2
EN: Element J is a Group 1 element
BM: Unsur J ialah unsur Kumpulan 1
A. JM
B. JM2
C. J2M
D. J2M3

Jawapan: C
Penjelasan: Unsur M dengan nombor proton 16`;
  const parsed = parseAiGeneratedMcqAnswer(sample);
  console.log("parsed count:", parsed.length);
  console.log(JSON.stringify(parsed, null, 2));
} catch (e) {
  console.error("import failed", e.message);
  process.exit(1);
}
