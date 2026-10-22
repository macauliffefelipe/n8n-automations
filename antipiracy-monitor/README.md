# Antipiracy monitor

## The problem

Independent authors lose sales to pirated copies of their books. The copies show up on websites, in search results and above all in Telegram groups and channels. Getting them removed means finding each link, working out who hosts it, writing a formal takedown notice to the right party (search engine, hosting company, registrar, Telegram) and then checking weeks later whether the link is really gone. Doing that by hand is a part-time job nobody has time for, and the existing services I looked at do not watch Telegram.

## What I built

A monitoring and takedown system for one author at a time. Nine n8n workflows run the daily routine, a small Python service reaches the places n8n cannot (Telegram search, link checks, page screenshots), and a Postgres database keeps the evidence. Every decision that has legal weight stays with a person: I approve each notice from a Telegram chat before anything is sent.

| # | Workflow | When it runs | What it does |
|---|---|---|---|
| 00 | Error alert | on any failure | Sends a Telegram alert if another workflow breaks. |
| 01 | Detection | daily 07:00 | Searches Google (optional paid API), Google Alerts feeds, the Telegram groups the monitoring account has joined and a list of public channels. Saves new findings without duplicates. Alerts me if a source fails, for example an expired session or no API credit. |
| 02 | Triage | every 30 minutes | Skips known legitimate sites (a whitelist), then a local AI model classifies each finding as pirate, official or doubtful. Doubtful and pirate findings go to my queue. If the model is down, findings wait and I get an alert at most every 6 hours. |
| 03 | Approval bot | every 5 minutes and on button press | Sends me each finding and each draft email in Telegram with buttons (confirm, discard, send). Only my own chat can press them. |
| 04 | Notifications | every 10 minutes | Builds a plan per finding (search engine, host, registrar, Cloudflare, Telegram) and sends what I approved. Channels with no email, such as web forms, are prepared as ready-to-paste text. |
| 05 | Verification | daily 09:00 | Checks whether notified links are still online. Escalates after 14 days and flags as persistent after 30. Blocked or ambiguous responses (anti-bot pages) count as inconclusive, never as "still online". |
| 06 | Weekly report | Mondays 08:00 | Builds a PDF for the author with a short summary written by the local AI model. |
| 07 | Telegram maintenance | Sundays 03:00 | Exports the groups the account is in and suggests new channels to review. It never joins anything by itself. |
| 08 | Reader reports | when a form is submitted | A public form where readers can report a link. Reports go through the same triage, capped at 30 per hour, and I am told if a report matches no known book. |

### How a finding travels

1. **Detect.** Searches use the book title plus rare literal sentences from inside the book, which find copies that were renamed.
2. **Triage.** Whitelist first, then the AI model. A finding is never discarded automatically while confidence thresholds are at their safe defaults, because a discard is permanent.
3. **Approve.** I get the finding in Telegram with the evidence and decide.
4. **Notify.** The system works out who to contact for each URL (hosting provider and registrar through public registry lookups, plus search engine and Telegram abuse channels) and prepares the notice.
5. **Verify.** Daily checks until the link is gone, with escalation if it is not.
6. **Report.** A weekly PDF shows the author what was found, what was sent and what was removed.

## Built to be safe

- **Dry run by default.** No notice leaves the system, even if approved, until I switch it off. The weekly report goes to me instead of the author while in dry run.
- **No notices without authorization.** The system acts on an author's behalf only when a signed authorization is recorded for that author. Without it, workflows 04 and 06 ignore them.
- **Human approval for emails.** Automatic sending is off, and the confidence thresholds are set so that nothing is confirmed or rejected without a person.
- **Only one chat can press the buttons**, and the public form is rate limited.
- **Secrets stay out of workflows.** Credentials live in n8n and `.env`; the Telegram session file is never stored in the repository.
- **The legal wording is a starting point.** The notice templates are in Portuguese and should be reviewed by a lawyer before production use.

## Status and honest limits

This is a pilot built for one independent author. It is **not in production yet** and I have no results to report, so this README contains no performance numbers.

What was tested: the database schema, all 40 SQL queries, every Code node and the data flow across the five layers, against a real Postgres, with simulated web and AI responses.

What was not tested: a full run inside a live n8n instance, the real Telegram login, the AI model, the paid search API and the registry lookups. A few node parameters (Telegram inline buttons, email attachments, the form trigger) were written from memory of the n8n node format, so a node may need a quick check after import.

## What is in this folder

```
workflows/          the nine n8n workflows, ready to import (generated, inactive by default)
sentinela-tg/       small Python service: Telegram search (Telethon), link checks and screenshots (Playwright)
sql/schema.sql      database schema, default settings and search templates
docker-compose.yml  Postgres, the Python service and Gotenberg (PDF) for a small server
tools/              generator for the workflows, the code inside each Code node, a credential setup script
.env.example        the few values you would need to supply
```

The workflow JSON files are produced by `python3 tools/build_workflows.py`, so the logic can be read and tested as plain JavaScript in `tools/js/` instead of inside exported JSON.

## Stack

n8n, Postgres, Python (FastAPI, Telethon, Playwright), Gotenberg for PDFs, Ollama with an open model (Qwen), Google Alerts feeds, optional DataForSEO for Google results, Telegram Bot API, Docker.

## Run it yourself (short version)

1. Copy `.env.example` to `.env` and fill it in, then `docker compose up -d --build`.
2. Log the monitoring account in once with `docker compose run --rm -it sentinela python login.py`, using a dedicated phone number, not a personal one.
3. Create the n8n credentials with `bash tools/crear_credenciales.sh` and import workflows 00 to 08.
4. In Postgres, set the admin chat ID and the sender details, add an author and a book, then run workflows 01, 02 and 03 by hand and check the Telegram messages.

The workflow and database text is in Spanish and Portuguese, because the pilot was set up that way.
