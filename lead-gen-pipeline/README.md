# Lead generation pipeline

## The problem

Finding good outbound prospects meant 30 to 40 minutes of research per company: read a job ad, check the company size, find the right person, find a valid email, write something that is not generic. I also had three almost identical workflows (one per business I prospected for), and every fix had to be copied three times.

## What I built

One workflow, six independent lanes, driven by a configuration block at the start of each lane. Change the configuration and the same logic prospects for a different business, in a different language, through a different contact service.

| # | Lane | When it runs | What it does |
|---|---|---|---|
| 1 | Lead intake | when called | A protected web address that other tools (for example a scheduled research agent) can send a lead to. Invalid and duplicate leads are rejected with a clear message. |
| 2 | Discovery | weekdays 07:00 | Collects candidate companies from job ads, a company database and news headlines, merges them, scores them and saves the good ones. |
| 3 | Outreach | weekdays, 3 times a day | Takes the best pending lead, finds a decision maker, writes an email and a LinkedIn note, validates the draft, then sends it or parks it. |
| 4 | Reply tracking | every 10 minutes | Matches incoming mail to contacted leads and records whether the reply shows real interest. |
| 5 | Follow-up | weekdays 10:00 | Drafts a short follow-up for leads that went quiet and sends it to me to review. |
| 6 | Weekly report | Mondays 08:00 | Emails which source, signal and market segment converts best. |

### How a lead travels through it

1. **Find.** Discovery looks for buying signals: a company posting a sales hire, a funding round, an expansion in the news. Each signal has a weight.
2. **Score.** A rule-based matrix scores fit from 0 to 12 (company size, revenue, growth, urgency, reachability). A local AI model then gives its own 1 to 12 score using the same rubric. The final score blends both. If the model applies a hard rule (for example "this company already has someone in the role"), the model wins and the lead is dropped.
3. **Filter.** Competitors, staffing firms and very large corporations are blocked. Companies already in the sheet, or evaluated recently with no new signal, are skipped.
4. **Contact.** The outreach lane looks up a decision maker (founder, owner, CEO and similar) with Hunter or Apollo, whichever the configuration selects. Generic mailboxes such as `info@` are ignored.
5. **Duplicate guard.** It will not write to an email that was already contacted, nor to a second person at the same company.
6. **Draft.** A local AI model writes the email and a LinkedIn note from the lead's concrete signal (for example "posted a VP of Sales role"), following the tone and rules in the configuration.
7. **Validation gate.** The draft must pass every check: valid format, length range, the right language, the signature present, no banned filler phrases ("recent growth", "impressed by your work") and no template leftovers. Fail one and the lead is parked with the reason and I get an alert.
8. **Send mode.** In `review` mode the email goes to my own inbox so I can read it and send it myself. In `auto` mode it goes to the prospect. A lead is marked "Sent" only after the send succeeds.
9. **Track.** Replies are matched to the lead (same sender, or a colleague from the same company), out-of-office and bounce messages are ignored, and the model labels the reply Yes, No or Unclear. If the model is down, the label is Unclear and a person decides. It never guesses.
10. **Follow up.** After 3 business days of silence, a 50-word follow-up draft arrives in my inbox, to be sent as a reply in the original thread.

## Profiles: one workflow, different businesses

The `config/` folder holds two ready-made profiles. A profile is the content of the `Config (...)` nodes: who is writing, which AI models to use, the scoring rubric, the target markets, the blocklists, the email prompts and the send rules.

| Profile | Language | Contact service | Where leads come from |
|---|---|---|---|
| `profile-b2b-services-consultancy.json` | English | Apollo | Automatic discovery (job ads, company database, news). A generic version of a profile I ran for a B2B services consultancy; the targeting values are examples. |
| `profile-fma-solutions.json` | Spanish | Hunter | A pool of leads researched by hand or sent to the intake webhook. It is the profile of my own business, FMA Solutions. |

The workflow in `workflows/lead-gen.json` ships with the first profile loaded. Both profiles start in `review` mode, so nothing is emailed to a stranger until you change the mode on purpose.

## Result

| | Profile 1 (B2B consultancy) | Profile 2 (FMA Solutions) |
|---|---|---|
| Leads found | about 350 | 125 |
| Emails sent | 250+ | 79 |
| Replies | about 20 | about 5% of sent |
| Calls booked | 10 (taken by the company's sales team) | about 3% of sent |
| Estimated time saved (15 min per prospect) | about 62 hours | about 20 hours |

Notes on these numbers: they come from the production versions of the workflows that this one consolidates (two separate copies at the time). The consolidated workflow in this repository is the cleaned-up successor, checked with offline tests but not yet run through a full campaign. Replies are counted as received, so they include negative answers, and in the earlier versions they were logged by hand because automatic reply detection did not work; the matching in this version fixes that; the weekly report separates replies from "interested". The 15-minute figure is conservative against the 30 to 40 minutes the research took by hand.

During the period some runs failed because the contact service ran out of credits. In this version a failure raises an alert through the shared error workflow, and the lead stays pending instead of being lost.

## What I improved while consolidating three workflows into one

- Merged three near-identical workflows into one, so a fix is made once.
- The Google Sheet row is marked "Sent" only after the email is sent, so a failed send can never look like a sent email.
- The validation gate used to exist in only one of the three variants. Now every profile has it.
- Duplicate protection by email and by company, on both contact services.
- A line at the end of each cold email lets the recipient opt out, which is also what the CAN-SPAM rules expect.
- Reply matching ignores automatic replies and recognises a colleague from the same company.
- If Apollo finds no company or no person, the lead is discarded instead of searching with an empty filter, so a message can never reach the wrong person.
- The webhook secret moved out of a node condition into a proper n8n credential.
- Dates in the sheet use one unambiguous format (`yyyy-MM-dd`).
- While testing I found that a job-title filter silently dropped every "VP of Sales" listing. The offline tests in `tests/` now cover it.

## Services and nodes used

| Purpose | Service or node |
|---|---|
| Orchestration | n8n: Schedule Trigger, Webhook (Header Auth), Gmail Trigger, Switch, IF, Merge, Code, Respond to Webhook |
| Database | Google Sheets (service account), one tab named `Leads` |
| Finding companies | Adzuna job search API, Apollo company search, Google News RSS |
| Finding contacts | Hunter domain search or Apollo people search and enrichment |
| Writing and judging | Local AI models through Ollama (Qwen, Llama), called with an exact request body and a JSON schema |
| Email | Gmail (send, trigger) |

## Run it yourself

1. In n8n choose Import from file and select `workflows/lead-gen.json`.
2. Create the credentials listed in [`../.env.example`](../.env.example) and attach them to the nodes (they show a warning until you do).
3. Create a Google Sheet with a tab named `Leads` and the columns of `sheet-template/Leads.csv`. Share it with your service account and put its ID in the Google Sheets nodes.
4. Open each `Config (...)` node and edit the sender name, company, review email and, if you like, paste in the other profile.
5. Run each lane once manually before activating.

Limits worth knowing: the "already evaluated" memory uses n8n workflow static data, which is only saved in production (active) runs; the Ollama address assumes n8n in Docker and Ollama on the host; and the Apollo and Hunter calls spend credits.
