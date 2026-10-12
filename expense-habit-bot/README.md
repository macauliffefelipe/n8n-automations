# Expense and habit bot

A personal assistant on Telegram that logs what I spend and which habits I kept, in plain language, into a spreadsheet.

## The problem

I wanted to know where my money goes and whether I was keeping my habits (walking, gym, water, reading), but opening a spreadsheet and filling columns every time was a chore I kept skipping. Anything that takes more than ten seconds does not survive a busy week.

## How it works

I write a message the way I would say it, from Telegram or from a shortcut on my iPhone, and the bot files it.

| I write | The bot records |
|---|---|
| `supe 50000` | Expense, category Supermarket, 50,000 pesos, today |
| `nafta 30 lucas ayer` | Expense, category Fuel, 30,000 pesos, yesterday |
| `cobré 500 usd de un cliente` | Income, category Freelance, 500 USD |
| `gym 45 min y agua 2l` | Two habit entries in one message |
| `8500 pasos` | Habit, steps, 8,500 (also sent automatically by the iPhone shortcut) |
| `borrá lo último` | Undo: deletes exactly what the last message created |

1. **Who is talking?** Only my own Telegram account is accepted. Any other sender is ignored. The iPhone shortcut authenticates with a secret token.
2. **Rules first.** A router recognizes the common phrases with plain rules: category aliases ("supe" is supermarket, "nafta" is fuel), amounts like `50k` or `30 lucas`, currencies, dates like "yesterday", habit names. This covers most messages instantly and at no cost.
3. **AI only as a fallback.** If the rules understand nothing, a small local AI model reads the message. Its answer is checked against my real list of categories and habits before anything is written; an answer outside the list is rejected rather than saved.
4. **Write it down.** The entry goes to the right tab with its date, original amount, converted amounts in pesos and dollars, and an `Origen` column that says whether rules or the model handled it.
5. **Undo safely.** Each message creates a batch that remembers the exact rows it wrote, so "undo" removes those rows and nothing else. Every expense and habit row carries an `ID` column for this, so keep that column in your sheet.
6. **Reminder.** At 19:00 the bot checks which habits are still missing today and nudges me on Telegram.

The messages and categories are in Spanish and Argentine slang because that is how I use it; the aliases, categories and habits are plain data you can change.

## Result

- **262 expenses and 216 habit entries logged** by sending short messages instead of editing a spreadsheet, about 24 hours of manual entry avoided at 3 minutes each.
- The `Origen` column lets me measure over time how many entries needed the AI model and which phrases are worth adding to the rules.
- No finance or health data leaves my machine: the model runs locally and the sheet is private.

## Services and nodes used

| Purpose | Service or node |
|---|---|
| Entry points | Telegram Trigger, Webhook (Header Auth) for the iPhone shortcut, Schedule Trigger |
| Routing | Code (rules router), Switch, IF |
| Fallback understanding | AI Agent node with a local model through Ollama (Qwen) |
| Storage | Google Sheets: `Gastos`, `Habitos_Log`, `Config_Habitos`, `Ultimo_Registro` |
| Replies | Telegram bot |

## Run it yourself

1. Import `workflows/expense-habit-bot.json` in n8n.
2. Create the credentials listed in [`../.env.example`](../.env.example).
3. Create a Google Sheet with the four tabs of `sheet-template/` and put its ID in the Google Sheets nodes. The sample rows are made up.
4. Open the `Settings` node and enter your Telegram chat ID, your name and the greeting the bot uses.
5. Optional: build an iPhone shortcut that posts `{"text": "8500 pasos"}` to the webhook with the token header.
