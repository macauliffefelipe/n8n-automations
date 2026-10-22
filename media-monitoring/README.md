# Media monitoring report

## The problem

Communications agencies send their clients a media report several times a day: what was published about the company, how it was covered and whether the tone was good or bad. Done by hand, someone reads dozens of news feeds, decides which articles matter, groups articles that tell the same story, writes a short summary of each one and lays it all out in a slide report. It is repetitive, it has to happen on time every day, and the reading is the part that eats the hours.

## What I built

One n8n workflow, a small local Python service and a local AI model. Every weekday at 9:45 and 15:45 a draft report is ready for a person to check. The AI does the reading and the first draft. A person approves every report before it goes to a client.

| Rhythm | What happens |
|---|---|
| Every hour, every day | Collects articles from Google News, Bing News and the RSS feeds of 10 news sites, keeps the ones that mention the client and stores them for 7 days. News feeds only show the last few hours, so collecting hourly means nothing is missed. |
| Weekdays 9:45 and 15:45 | Builds the report for the 10:00 and 16:00 cut-offs. The two time windows meet exactly, so no article falls in a gap or is counted twice. The Monday morning report covers the whole weekend. |
| When a reviewer clicks a button in the email | Records a correction ("not relevant", "this was negative") so the AI's accuracy can be measured. |

### How a report is built

1. **Collect and filter.** Articles must mention the client in the headline or summary. Duplicates are removed, including the same story republished by another outlet with a slightly edited headline.
2. **Classify.** A local AI model reads each article and returns four things: is it relevant, which topic (investment, demand, operations, corporate), the sentiment for the client and a one-line reason. Its rules and examples come from the configuration, not from the code.
3. **Group into stories.** The model groups articles that tell the same story. If it fails, a rule-based fallback groups them by shared words, and a negative story about the client is never dropped.
4. **Write.** The model writes a short card per story, using only what the headlines and summaries say. The prompt forbids invented figures, motives or consequences.
5. **Lay out.** The local service turns the result into a slide report (PowerPoint), with charts for topics and sentiment.
6. **Review.** The draft arrives by email with every article, its link and correction buttons. Nothing reaches the client without a human check.

## Built to be trusted

- **One configuration node.** Client name, how the press refers to it, what counts as relevant, examples for the AI, search terms and news sources all live in a single `Config` node. This published version uses a fictitious client, **Ejemplo S.A.**; switching to a real client means editing that node only.
- **Quality is measured, not assumed.** Every correction click is stored, and the review email shows the running accuracy for relevance and sentiment, counted only on reports a person marked as fully reviewed.
- **Nothing fails silently.** Each report pings a monitoring service (healthchecks.io). A failure sends `/fail`, and if the computer or n8n did not run at all, the missing ping raises the alarm. Report emails carry a warning block when something went wrong but the report still went out, for example a gap of more than 2 hours in collection.
- **Damaged data is quarantined.** If a storage file cannot be read, the service sets it aside, starts a clean one and keeps warning until a person looks at it.
- **Private by design.** The AI model runs locally, so articles and drafts never go to an outside AI service.
- **Correction links are signed**, so a forged link cannot write fake corrections.

## Honest limits

- Web news only: no social networks.
- No audience reach figures, because open sources do not publish them. Replacing the source step with a paid monitoring tool's export or API would add them without changing the rest of the flow.
- The workflow and report text are in Spanish, because the reports were meant for Spanish-language clients.
- I have no client results to report for this one, so this README contains no performance numbers.

## What is in this folder

```
workflows/media-monitoring.json   the n8n workflow (inactive, no credentials)
service/server.py                 local service: stores articles, cut-offs and corrections, builds the PowerPoint
service/gen_monitoreo.py          builds the report slides from scratch (the format the workflow uses)
service/gen_informe.py            alternative layout that fills an existing .pptx template (template not included)
service/requirements.txt          Python dependency (python-pptx)
```

To run it: start the service with `python3 service/server.py plantilla.pptx 8787` (the template argument is only needed for the alternative layout), put a random token in `service/token.txt`, import the workflow, fill in the `Config` node (token, healthcheck URL, your n8n address) and the review email address, and assign the Ollama and Gmail credentials.

## Stack

n8n, Ollama with an open model (Qwen 2.5 14B), Python with python-pptx, Google News and Bing News RSS, Gmail, healthchecks.io.
