# Skills Job Dashboard

A local dashboard that searches job listings through JSearch on RapidAPI and ranks the results by skills you choose. Add skill options yourself, select multiple skills, and optionally enter a LinkedIn profile URL and minimum/maximum experience in years. These preferences are saved in your browser. The dashboard does not sign in to, scrape, or read your LinkedIn profile; the profile shortcut is shown only for a valid LinkedIn URL. The RapidAPI key is kept on the local server.

## Run locally

1. Install Node.js 18 or newer.
2. Subscribe to JSearch on RapidAPI and copy your RapidAPI key.
3. Store the key locally in `job-dashboard/.env` (copy `.env.example` and replace the blank value). This file is ignored by Git:

   ```dotenv
   RAPIDAPI_KEY=replace-with-your-rotated-rapidapi-key
   ```

   Or set `RAPIDAPI_KEY` in your environment before starting the server:

   **PowerShell**

   ```powershell
   $env:RAPIDAPI_KEY = "replace-with-your-rotated-rapidapi-key"
   npm start
   ```

   **macOS/Linux**

   ```sh
   RAPIDAPI_KEY="replace-with-your-rotated-rapidapi-key" npm start
   ```

4. Open <http://127.0.0.1:3000>.

Add one or more skill options and select the skills you want matched, then enter a role or keyword and an optional location. The dashboard makes one JSearch request for up to five pages, filters out listings with no selected-skill matches, and shows up to 20 matching jobs ranked by match percentage. Optional experience bounds filter listings whose descriptions state an experience requirement outside the range; listings without a stated experience requirement are retained. Match scores are estimates, not recommendations to apply. The number of matches depends on JSearch availability and your RapidAPI quota.

The server binds only to `127.0.0.1`; do not expose it to the public internet. JSearch availability, result limits, and usage quotas depend on your RapidAPI plan.

The server calls the RapidAPI MCP gateway at `https://mcp.rapidapi.com`, using the `Job_Search` tool and the `x-api-host: jsearch.p.rapidapi.com` and `x-api-key` headers from the MCP configuration. The API key stays on the local server.

The header status indicator checks the gateway for the `Job_Search` tool every 30 seconds. Successful searches set it to green “API is live”; a failed search sets it to “API disconnected” until a search succeeds again.

## Daily email with GitHub Actions

The `Daily Skillset job email` workflow runs every day at 9:00 AM India Standard Time (03:30 UTC). It can also be started manually from the repository’s **Actions** tab. The workflow searches JSearch, ranks by selected skills, applies optional experience bounds, and emails up to 20 matching jobs to `phanikumar.madiraju@gmail.com`. If there are no matches, it sends a no-results email.

Configure these in the Skillset GitHub repository under **Settings → Secrets and variables → Actions**:

**Repository variables**

- `JOB_ROLE` — role or search phrase, for example `Site Reliability Engineer`
- `JOB_SKILLS` — comma-separated skills, for example `AWS, Kubernetes, SRE`
- `JOB_LOCATION` — optional location, for example `Bengaluru, India`
- `MIN_EXPERIENCE` — optional minimum years (whole number)
- `MAX_EXPERIENCE` — optional maximum years (whole number)

**Repository secrets**

- `RAPIDAPI_KEY` — your RapidAPI key
- `GMAIL_ADDRESS` — the Gmail account that sends the digest
- `GMAIL_APP_PASSWORD` — an App Password generated for that Gmail account (not its regular password)

The scheduled job cannot read browser-local preferences. Set `JOB_ROLE` and `JOB_SKILLS` before the first run. Credentials belong in Actions secrets, never in `.env.example` or committed files. GitHub scheduled workflows may start a little later than their scheduled time during periods of high load.

## Troubleshooting

- **"Failed to fetch" / can't reach the dashboard server:** Start the server with `npm start` from the `job-dashboard` folder, then open <http://127.0.0.1:3000>. Keep the terminal running while using the dashboard. Do not open `index.html` directly as a file.
- **RAPIDAPI_KEY setup message:** Add the key to `job-dashboard/.env` or set it in the same terminal session before running `npm start`. If the server is already running, stop it with `Ctrl+C`, set the key, then start it again.
- **JSearch rejects the key or returns an error:** Check that your RapidAPI key is correct and that your account has an active JSearch subscription and available quota.
