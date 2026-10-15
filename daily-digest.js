const nodemailer = require("nodemailer");

const MCP_URL = "https://mcp.rapidapi.com";
const API_HOST = "jsearch.p.rapidapi.com";
const RECIPIENT = "phanikumar.madiraju@gmail.com";
const countryCodes = {
  australia: "au",
  brazil: "br",
  canada: "ca",
  france: "fr",
  germany: "de",
  india: "in",
  ireland: "ie",
  japan: "jp",
  netherlands: "nl",
  singapore: "sg",
  "united arab emirates": "ae",
  "united kingdom": "gb",
  "united states": "us",
  uk: "gb",
  usa: "us",
};

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required GitHub variable or secret: ${name}`);
  return value;
}

function optionalExperience(name) {
  const value = process.env[name]?.trim();
  if (!value) return null;
  const years = Number(value);
  if (!Number.isInteger(years) || years < 0 || years > 60) {
    throw new Error(`${name} must be a whole number between 0 and 60.`);
  }
  return years;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

function hasSkill(text, skill) {
  const words = skill.toLocaleLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (!words.length) return false;
  const phrase = skill.toLocaleLowerCase() === "cicd"
    ? "(?:ci\\s*[/&-]?\\s*cd|cicd)"
    : words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\W+");
  return new RegExp(`(?:^|[^a-z0-9])${phrase}(?=$|[^a-z0-9])`, "i").test(text);
}

function matchesExperience(job, minimum, maximum) {
  if (minimum === null && maximum === null) return true;
  const text = `${job.title} ${job.description}`;
  const intervals = [];
  const ranges = /\b(\d{1,2})\s*(?:-|\u2013|to)\s*(\d{1,2})\s*(?:years?|yrs?)\b/gi;
  for (const match of text.matchAll(ranges)) {
    intervals.push([Number(match[1]), Number(match[2])]);
  }
  const withoutRanges = text.replace(ranges, " ");
  const singleYears = /\b(?:at least\s+|minimum of\s+|min(?:imum)?\s+)?(\d{1,2})\s*(\+|or more)?\s*(?:years?|yrs?)\s*(?:of\s+)?(?:relevant\s+|professional\s+|related\s+)?experience\b/gi;
  for (const match of withoutRanges.matchAll(singleYears)) {
    intervals.push([Number(match[1]), match[2] ? Number.POSITIVE_INFINITY : Number(match[1])]);
  }
  if (intervals.length === 0) return true;
  return intervals.some(([requiredMinimum, requiredMaximum]) =>
    (maximum === null || requiredMinimum <= maximum) &&
    (minimum === null || requiredMaximum >= minimum));
}

async function searchJobs(query, location, apiKey) {
  const searchArguments = {
    query: location ? `${query} in ${location}` : query,
    num_pages: 5,
  };
  const country = location.split(",").pop()?.trim().toLocaleLowerCase();
  if (country && countryCodes[country]) searchArguments.country = countryCodes[country];

  const upstream = await fetch(MCP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
      "x-api-key": apiKey,
      "x-api-host": API_HOST,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "Job_Search", arguments: searchArguments },
    }),
    signal: AbortSignal.timeout(60000),
  });
  if (!upstream.ok) throw new Error(`JSearch returned HTTP ${upstream.status}.`);

  const mcpResponse = await upstream.json();
  const toolResult = mcpResponse.result;
  if (mcpResponse.error || toolResult?.isError) {
    const message = toolResult?.content?.find((item) => item.type === "text")?.text;
    throw new Error(message || mcpResponse.error?.message || "JSearch could not complete the search.");
  }

  const resultText = toolResult?.content?.find((item) => item.type === "text")?.text;
  if (!resultText) throw new Error("JSearch returned an empty response.");
  let payload;
  try {
    payload = JSON.parse(resultText);
  } catch {
    throw new Error("JSearch returned an unexpected response.");
  }
  const records = Array.isArray(payload.data) ? payload.data : payload.data?.jobs;
  if (!Array.isArray(records)) throw new Error("JSearch returned an unexpected response shape.");

  return records.map((job) => ({
    id: job.job_id || "",
    title: job.job_title || "Untitled role",
    company: job.employer_name || "Company not listed",
    location: job.job_location || [job.job_city, job.job_state, job.job_country].filter(Boolean).join(", ") || "Location not listed",
    type: job.job_employment_type || job.job_employment_types?.join(", ") || "",
    description: job.job_description || "",
    url: job.job_apply_link || job.apply_options?.[0]?.apply_link || "",
    posted: job.job_posted_at || job.job_posted_at_datetime_utc || "",
    remote: Boolean(job.job_is_remote),
  }));
}

function rankJobs(jobs, skills, minimum, maximum) {
  const uniqueJobs = new Map();
  for (const job of jobs) {
    const description = `${job.title} ${job.description}`;
    const matched = skills.filter((skill) => hasSkill(description, skill));
    if (!matched.length || !matchesExperience(job, minimum, maximum)) continue;
    const score = Math.round((matched.length / skills.length) * 100);
    const key = job.id || `${job.title}|${job.company}|${job.location}`;
    const existing = uniqueJobs.get(key);
    if (!existing || score > existing.score) uniqueJobs.set(key, { ...job, matched, score });
  }
  return [...uniqueJobs.values()].sort((left, right) => right.score - left.score).slice(0, 20);
}

function buildEmail(jobs, skills, query, location, minimum, maximum) {
  const criteria = [
    `Role: ${query}`,
    location ? `Location: ${location}` : "",
    `Skills: ${skills.join(", ")}`,
    minimum !== null || maximum !== null
      ? `Experience: ${minimum ?? 0}–${maximum ?? "any"} years`
      : "",
  ].filter(Boolean);

  if (jobs.length === 0) {
    const message = `No matching jobs were found today.\n\n${criteria.join("\n")}`;
    return { text: message, html: `<p>No matching jobs were found today.</p><p>${criteria.map(escapeHtml).join("<br>")}</p>` };
  }

  const textJobs = jobs.map((job, index) => [
    `${index + 1}. ${job.title} — ${job.company} (${job.score}% match)`,
    `${job.location}${job.remote ? " · Remote" : ""}${job.type ? ` · ${job.type}` : ""}`,
    `Matched skills: ${job.matched.join(", ")}`,
    job.posted ? `Posted: ${job.posted}` : "",
    job.url,
  ].filter(Boolean).join("\n"));
  const htmlJobs = jobs.map((job) => {
    const link = /^https?:\/\//i.test(job.url)
      ? `<p><a href="${escapeHtml(job.url)}">View job listing</a></p>`
      : "";
    return `<li><strong>${escapeHtml(job.title)}</strong> — ${escapeHtml(job.company)} (${job.score}% match)<br>
      ${escapeHtml(job.location)}${job.remote ? " · Remote" : ""}${job.type ? ` · ${escapeHtml(job.type)}` : ""}<br>
      Matched skills: ${job.matched.map(escapeHtml).join(", ")}${job.posted ? `<br>Posted: ${escapeHtml(job.posted)}` : ""}
      ${link}</li>`;
  });
  return {
    text: `${jobs.length} matching jobs found.\n\n${criteria.join("\n")}\n\n${textJobs.join("\n\n")}`,
    html: `<h2>${jobs.length} matching jobs found</h2><p>${criteria.map(escapeHtml).join("<br>")}</p><ol>${htmlJobs.join("")}</ol>`,
  };
}

async function main() {
  const query = requiredEnvironment("JOB_ROLE");
  const skills = requiredEnvironment("JOB_SKILLS").split(",").map((skill) => skill.trim()).filter(Boolean);
  if (skills.length === 0) throw new Error("JOB_SKILLS must contain at least one comma-separated skill.");
  const location = process.env.JOB_LOCATION?.trim() || "";
  const minimum = optionalExperience("MIN_EXPERIENCE");
  const maximum = optionalExperience("MAX_EXPERIENCE");
  if (minimum !== null && maximum !== null && minimum > maximum) {
    throw new Error("MIN_EXPERIENCE cannot be greater than MAX_EXPERIENCE.");
  }

  const apiKey = requiredEnvironment("RAPIDAPI_KEY");
  const gmailAddress = requiredEnvironment("GMAIL_ADDRESS");
  const gmailAppPassword = requiredEnvironment("GMAIL_APP_PASSWORD");
  const jobs = rankJobs(await searchJobs(query, location, apiKey), skills, minimum, maximum);
  const email = buildEmail(jobs, skills, query, location, minimum, maximum);
  const transport = nodemailer.createTransport({
    service: "gmail",
    auth: { user: gmailAddress, pass: gmailAppPassword },
  });
  await transport.sendMail({
    from: gmailAddress,
    to: RECIPIENT,
    subject: `Skillset daily job matches — ${jobs.length} found`,
    text: email.text,
    html: email.html,
  });
  console.log(`Daily job digest sent to ${RECIPIENT} with ${jobs.length} matching listing(s).`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error("Daily job digest failed:", error.message);
    process.exitCode = 1;
  });
}

module.exports = { buildEmail, hasSkill, matchesExperience, rankJobs };
