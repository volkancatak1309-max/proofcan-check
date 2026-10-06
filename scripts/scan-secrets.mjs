// Pre-publication scan. Looks for secrets and private details in
//   1. every file tracked by git in the working tree, and
//   2. the full git history (every commit's diff, all branches).
// It prints every hit with file and line; it never prints a matched secret in full.
// Exit code 1 if anything is found. Run: npm run scan
import { execFileSync } from "node:child_process";

const git = (...args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 1 << 28 });

const RULES = [
  ["private key block", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["AWS access key id", /\bAKIA[0-9A-Z]{16}\b/],
  ["GitHub token", /\b(ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{20,}/],
  ["Stripe/Paddle-style key", /\b(sk|pk|rk)_(live|test)_[A-Za-z0-9]{10,}|\b(pdl|live|test)_[a-f0-9]{20,}\b/],
  ["Slack token", /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ["JWT", /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ["credential assignment", /\b(api[_-]?key|secret|token|passw(or)?d|authorization)\b\s*[:=]\s*["'][^"'\s]{12,}["']/i],
  ["e-mail address", /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+/],
  ["private / internal IP or host", /\b(10\.\d{1,3}|192\.168|172\.(1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}\b|\b[\w-]+\.(local|internal|lan)\b/],
  // Built from parts so this file does not match its own rules.
  ["engine / infrastructure address", new RegExp([["engine", "proofcan", "com"].join("\."), "trycloud" + "flare", "cfargo" + "tunnel", "libsql:\/\/", "\.tur" + "so\.io", "hetz" + "ner"].join("|"), "i")],
  ["internal product name", new RegExp("proof" + "kit", "i")],
  ["local user path", /[A-Za-z]:\\+Users\\+[^\\\s]+|\/home\/[a-z0-9_-]+\/|\/Users\/[A-Za-z0-9_-]+\//],
];

// Public contact address that is meant to be visible (README footer, commit identity).
const ALLOWED_EMAILS = new Set(["support@proofcan.com"]);
const onlyAllowedEmails = (line) => (line.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g) ?? []).every((e) => ALLOWED_EMAILS.has(e.toLowerCase()));

const SKIP_FILE = /(^|\/)package-lock\.json$/; // integrity hashes look like tokens; scanned separately below
const hits = [];
const note = (where, line, rule, text) =>
  hits.push(`${where}:${line}  [${rule}]  ${text.trim().slice(0, 100).replace(/[A-Za-z0-9+/_-]{24,}/g, (m) => m.slice(0, 6) + "…")}`);

function scanText(where, text) {
  text.split("\n").forEach((l, i) => {
    for (const [rule, re] of RULES) if (re.test(l) && !(rule === "e-mail address" && onlyAllowedEmails(l))) note(where, i + 1, rule, l);
  });
}

// 0. forbidden file names anywhere in the tree or history
const names = new Set([...git("ls-files").split("\n"), ...git("log", "--all", "--name-only", "--pretty=format:").split("\n")].filter(Boolean));
for (const n of names) if (/(^|\/)(\.env(\..*)?|.*\.(pem|key|p12|pfx)|id_rsa.*|\.npmrc|credentials.*)$/i.test(n)) hits.push(`${n}:0  [forbidden file name]`);

// 1. working tree (tracked files)
for (const f of git("ls-files").split("\n").filter(Boolean)) {
  if (SKIP_FILE.test(f)) continue;
  let text;
  try { text = execFileSync("git", ["show", `:${f}`], { encoding: "utf8", maxBuffer: 1 << 28 }); } catch { continue; }
  if (text.includes("\u0000")) continue; // binary
  scanText(f, text);
}

// 2. history: every added line in every commit, plus commit metadata
const log = git("log", "--all", "-p", "--no-color", "--pretty=format:@@COMMIT %H %an <%ae> %cn <%ce>");
let commit = "?";
let file = "?";
log.split("\n").forEach((l, i) => {
  if (l.startsWith("@@COMMIT ")) {
    commit = l.slice(9, 17);
    for (const [rule, re] of RULES) if (rule === "e-mail address" && re.test(l) && !onlyAllowedEmails(l)) note(`history ${commit}`, i + 1, "commit metadata e-mail", l);
  } else if (l.startsWith("+++ b/")) file = l.slice(6);
  else if (l.startsWith("+") && !SKIP_FILE.test(file)) {
    for (const [rule, re] of RULES) if (re.test(l) && !(rule === "e-mail address" && onlyAllowedEmails(l))) note(`history ${commit} ${file}`, i + 1, rule, l.slice(1));
  }
});

// 3. the files that would be published (npm pack list)
const packed = JSON.parse(execFileSync("npm", ["pack", "--dry-run", "--json"], { encoding: "utf8", shell: true }))[0].files.map((f) => f.path);
console.log("published files:", packed.join(", "));

const unique = [...new Set(hits)];
if (unique.length) {
  console.log(`\n${unique.length} finding(s):\n` + unique.join("\n"));
  process.exit(1);
}
console.log("no findings in the working tree, in git history or in the publish list");
