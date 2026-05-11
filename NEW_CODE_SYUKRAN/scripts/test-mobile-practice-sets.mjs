/**
 * Test the mobile backend practice-sets route (same as the app).
 *
 * Run (PowerShell), after signing in once and copying a JWT from the app or API:
 *   $env:MYSPM_JWT = "eyJ..."
 *   $env:MYSPM_MOBILE_API_PREFIX = "http://127.0.0.1:3000"
 *   npm run test:mobile-api
 *
 * n8n Code node (JavaScript) — paste as the full code body; set env MYSPM_MOBILE_API_PREFIX + MYSPM_JWT on the workflow:
 *   const base = `${process.env.MYSPM_MOBILE_API_PREFIX?.replace(/\/+$/, "")}/api/mobile`;
 *   const res = await fetch(`${base}/practice-sets`, { headers: { Authorization: `Bearer ${process.env.MYSPM_JWT}` } });
 *   return [{ json: await res.json() }];
 */

const prefix = (process.env.MYSPM_MOBILE_API_PREFIX ?? "http://127.0.0.1:3000").replace(/\/+$/, "");
const base = `${prefix}/api/mobile`;
const token = process.env.MYSPM_JWT?.trim();

if (!token) {
  console.error("Set MYSPM_JWT to a valid Bearer token (same as the app uses).");
  process.exit(1);
}

const url = `${base}/practice-sets`;
const res = await fetch(url, {
  headers: { Authorization: `Bearer ${token}` },
  cache: "no-store",
});

const text = await res.text();
let body;
try {
  body = JSON.parse(text);
} catch {
  body = text;
}

console.log("GET", url);
console.log("status", res.status, res.ok ? "ok" : "error");
console.log(typeof body === "string" ? body : JSON.stringify(body, null, 2));

if (!res.ok) {
  process.exit(1);
}

const sets = body?.data?.sets;
if (!Array.isArray(sets)) {
  process.exit(0);
}

const bioF4 = sets.find(
  (s) => /biology/i.test(String(s.subject ?? "")) && /form\s*4|^4$/i.test(String(s.formLevel ?? "")),
);

if (bioF4) {
  const detailUrl = `${base}/practice-sets/${bioF4.id}`;
  const dRes = await fetch(detailUrl, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  const dText = await dRes.text();
  let detail;
  try {
    detail = JSON.parse(dText);
  } catch {
    detail = dText;
  }
  console.log("\nGET", detailUrl);
  console.log("status", dRes.status, dRes.ok ? "ok" : "error");
  console.log(typeof detail === "string" ? detail : JSON.stringify(detail, null, 2));
  if (!dRes.ok) {
    process.exit(1);
  }
} else {
  console.log("\n(No set matched Biology + Form 4 in list; list-only test succeeded.)");
}
