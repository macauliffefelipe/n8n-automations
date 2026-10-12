# Offline tests

The interesting logic of each workflow lives in n8n Code nodes (routing rules, scoring, validation, de-duplication, reply matching). These scripts load the published workflow files, run those Code nodes with a small mock of the n8n environment and check the results against realistic made-up inputs. No n8n instance, network access or credentials are needed.

```
cd tests
npm install
npm test
```

| Script | What it covers |
|---|---|
| `run_lead.js` | Lead generation: lead selection and daily cap, contact filtering, duplicate guard, prompt building, the validation gate, reply matching and classification, follow-up selection, discovery sources, de-duplication and scoring, weekly report, intake webhook |
| `run_expense_and_jobsearch.js` | Expense and habit bot (user check, rules router, undo) and the job search scoring, de-duplication and heartbeat |

The tests cover the code inside the nodes. They do not replace running a workflow end to end in n8n with real credentials.
