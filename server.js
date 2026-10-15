const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const PORT = Number(process.env.PORT || 3000);
const MCP_URL = "https://mcp.rapidapi.com";
const HOST = "127.0.0.1";
const MAX_QUERY_LENGTH = 200;
const indexPath = path.join(__dirname, "index.html");
const envPath = path.join(__dirname, ".env");
let lastSearchFailed = false;
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

if (fs.existsSync(envPath)) {
  const envFile = fs.readFileSync(envPath, "utf8");
  for (const line of envFile.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || match[1] in process.env) continue;
    const value = match[2].replace(/^(['"])(.*)\1$/, "$2");
    process.env[match[1]] = value;
  }
}

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(body));
}

async function searchJSearch(query, location, country, apiKey) {
  const searchArguments = {
    query: location ? `${query} in ${location}` : query,
    num_pages: 5,
  };
  if (country && countryCodes[country]) searchArguments.country = countryCodes[country];

  const upstream = await fetch(MCP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
      "x-api-key": apiKey,
      "x-api-host": "jsearch.p.rapidapi.com",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "Job_Search",
        arguments: searchArguments,
      },
    }),
    signal: AbortSignal.timeout(60000),
  });

  if (!upstream.ok) {
    throw new Error(`RapidAPI MCP returned HTTP ${upstream.status}.`);
  }

  const mcpResponse = await upstream.json();
  const toolResult = mcpResponse.result;
  if (mcpResponse.error || toolResult?.isError) {
    const toolMessage = toolResult?.content?.find((item) => item.type === "text")?.text;
    throw new Error(toolMessage || mcpResponse.error?.message || "JSearch could not complete the search.");
  }

  const resultText = toolResult?.content?.find((item) => item.type === "text")?.text;
  if (!resultText) {
    throw new Error("JSearch returned an empty response.");
  }

  let payload;
  try {
    payload = JSON.parse(resultText);
  } catch {
    throw new Error("JSearch returned an unexpected response.");
  }

  const records = Array.isArray(payload.data) ? payload.data : payload.data?.jobs;
  if (!Array.isArray(records)) {
    throw new Error("JSearch returned an unexpected response shape.");
  }

  return records.map((job) => ({
    jobId: job.job_id || "",
    title: job.job_title || "Untitled role",
    company: job.employer_name || "Company not listed",
    location: job.job_location || [job.job_city, job.job_state, job.job_country].filter(Boolean).join(", ") || "Location not listed",
    employmentType: job.job_employment_type || job.job_employment_types?.join(", ") || "",
    description: job.job_description || "",
    applyUrl: job.job_apply_link || job.apply_options?.[0]?.apply_link || "",
    postedAt: job.job_posted_at_datetime_utc || "",
    postedLabel: job.job_posted_at || "",
    salary: job.job_salary_string || "",
    isRemote: Boolean(job.job_is_remote),
  }));
}

const server = http.createServer(async (request, response) => {
  const requestUrl = new URL(request.url, `http://${request.headers.host || HOST}`);

  if (request.method === "GET" && requestUrl.pathname === "/") {
    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    });
    fs.createReadStream(indexPath).pipe(response);
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/status") {
    const apiKey = process.env.RAPIDAPI_KEY?.trim();
    if (!apiKey || lastSearchFailed) {
      sendJson(response, 200, { connected: false });
      return;
    }

    try {
      const upstream = await fetch(MCP_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json, text/event-stream",
          "x-api-key": apiKey,
          "x-api-host": "jsearch.p.rapidapi.com",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/list",
          params: {},
        }),
        signal: AbortSignal.timeout(10000),
      });

      if (!upstream.ok) {
        console.error(`RapidAPI MCP health check failed with HTTP ${upstream.status}.`);
        sendJson(response, 200, { connected: false });
        return;
      }

      const mcpResponse = await upstream.json();
      const hasSearchTool = mcpResponse.result?.tools?.some((tool) => tool.name === "Job_Search");
      sendJson(response, 200, { connected: Boolean(hasSearchTool) });
    } catch (error) {
      console.error("RapidAPI MCP health check failed:", error.message);
      sendJson(response, 200, { connected: false });
    }
    return;
  }

  if (request.method !== "GET" || requestUrl.pathname !== "/api/jobs") {
    sendJson(response, 404, { error: "Not found." });
    return;
  }

  const query = (requestUrl.searchParams.get("q") || "").trim();
  const location = (requestUrl.searchParams.get("location") || "").trim();

  if (query.length < 2 || query.length > MAX_QUERY_LENGTH || location.length > 100) {
    sendJson(response, 400, { error: "Enter a search query (2–200 characters) and a location under 100 characters." });
    return;
  }

  const apiKey = process.env.RAPIDAPI_KEY?.trim();
  if (!apiKey) {
    sendJson(response, 503, { error: "Set the RAPIDAPI_KEY environment variable and restart the dashboard." });
    return;
  }

  const country = location.split(",").pop()?.trim().toLocaleLowerCase();

  try {
    const jobs = await searchJSearch(query, location, country, apiKey);
    lastSearchFailed = false;
    sendJson(response, 200, { jobs });
  } catch (error) {
    lastSearchFailed = true;
    console.error("JSearch request could not be completed:", error.message);
    sendJson(response, 502, { error: error.message || "Could not reach JSearch. Check your connection and try again." });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Skills Job Dashboard is running at http://${HOST}:${PORT}`);
});
