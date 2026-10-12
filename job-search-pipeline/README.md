# Job search pipeline

Two workflows that keep my remote job search organized: one screens job boards every morning, the other watches my inbox and only interrupts me when something is urgent.

## The problem

Looking for remote work means opening five job boards and reading hundreds of ads, most of them wrong for me: wrong role, US-only, asking for more experience than I have, paying below my minimum. Doing that by hand took about 1.5 hours per session. On top of that, a recruiter's message asking for my availability can sit unnoticed between newsletters and job alerts.

## Workflow 1: daily job discovery (`workflows/job-discovery.json`)

Runs every day at 08:00.

1. **Collect.** Pulls listings from five public sources (Remotive, We Work Remotely, Himalayas, Jobicy and Get on Board).
2. **Filter and de-duplicate.** Drops listings I have already seen, roles outside my field and ads that restrict the region (for example "must reside in the United States").
3. **Read.** A local AI model reads each remaining ad and extracts facts only: years of experience required, contract type, monthly pay in USD, tools mentioned, countries allowed. It does not decide anything.
4. **Score.** Fixed, readable rules turn those facts into a score. An ad that wants more experience than I have, pays under my minimum or excludes my country is discarded, with the reason recorded.
5. **Save.** Ads scoring 6 or more go to the `Pipeline` sheet. Every ad that was evaluated, good or bad, goes to the `Vistos` ("seen") sheet so it is never read twice. If the local model fails on an ad, it is not marked as seen and gets another try the next day.
6. **Tell me.** A Telegram digest lists the best new ads with their score and why.
7. **Heartbeat.** At 08:45 a second check confirms that today's digest went out. If it did not, it tells me why: the workflow did not run, every source failed, or there was simply nothing new. Silence never has to be interpreted.

Why this design: the AI model is good at reading messy text and bad at being consistent, so it only extracts facts. The decision is made by rules I can read, change and explain.

## Workflow 2: inbox triage (`workflows/inbox-triage.json`)

Checks my Gmail every 10 minutes.

1. **Pre-filter.** Skips promotions, social, spam, mass newsletters and job-alert senders, and cuts quoted reply threads so the model only reads what is new.
2. **Classify.** A local AI model extracts the topic (job application, client or lead, job alert, vendor pitch, bill, other), whether the message asks me to do something, and a one-line summary with a suggested action.
3. **Decide.** Fixed rules set the urgency. A recruiter or client message that asks for a reply is urgent; a plain status update is not.
4. **Alert.** Only urgent mail reaches Telegram: sender, subject, summary, suggested action and a direct link to the message.
5. **Fallback.** If the model is unavailable, keyword rules classify the mail so nothing important is missed.

The prompts and summaries are written in Spanish because I read my own alerts in Spanish; the structure is the same in any language.

## Result

- **865 job listings screened and 92 shortlisted** (about 11%) since 7 September 2026, when this version started running.
- Replaces roughly 1.5 hours of manual screening per session with a short morning review of a ranked list.
- The inbox triage turns an inbox I do not read in full into a handful of phone alerts.

## Services and nodes used

| Purpose | Service or node |
|---|---|
| Orchestration | n8n: Schedule Trigger, Gmail Trigger, HTTP Request, IF, Code |
| Job sources | Public APIs and feeds of five remote job boards |
| Reading and extracting | Local AI model through Ollama (Qwen), called with an exact request body and a JSON schema |
| Storage | Google Sheets (`Vistos`, `Pipeline`) |
| Notifications | Telegram bot |

## Run it yourself

1. Import `workflows/job-discovery.json` and `workflows/inbox-triage.json` in n8n.
2. Create the credentials listed in [`../.env.example`](../.env.example) and attach them to the nodes.
3. Create a Google Sheet with the tabs of `sheet-template/` (`Vistos`, `Pipeline`) and put its ID in the Google Sheets nodes.
4. Edit the profile text inside the `Armar prompt empleo` node (job discovery) and the `Armar prompt` node (inbox triage) so they describe you, and review the thresholds in `Puntuar` (maximum years of experience, minimum monthly pay, allowed countries).
5. Set `../shared/error-notifier.json` as the Error Workflow in the settings of both workflows.

Check each job board's terms of use before running this regularly.
