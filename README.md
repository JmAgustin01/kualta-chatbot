# Kualta Agency Support Chatbot (Greek AI · PDC60 MC01)

Rules-first RAG chatbot on the demo **Facebook Page's Messenger**, connected through Meta's
Messenger webhook ([docs/messenger-setup.md](docs/messenger-setup.md)). When the bot hands off,
the team answers from the Business Suite inbox and the bot steps aside for that customer.
No AWS, and $0 to run: hosting, database, embeddings and the LLM are all on free tiers.

```
Messenger user
   │  (Meta webhook, signature-verified)
   ▼
Express on Render ── 1. Screen: prohibited data (CB-17), abuse (CB-18)
                    2. Session: lead flow / consent / delete-my-data (CB-08, 09, 19)
                    3. Fixed intents from config/business-rules.json ──► reply instantly
                       (pricing, policies, discounts, results, complaints, services…)
                         │ no match
                         ▼
                    1. Embed question (Gemini gemini-embedding-001, 1536 dims)
                    2. Search Supabase pgvector (top-K, similarity ≥ threshold)
                         │ nothing relevant? → fallback + handoff, NO LLM call
                         ▼
                    3. Gemini Flash answers ONLY from retrieved chunks
                         │ says NO_ANSWER? → fallback + handoff
                         ▼
                    Reply via Messenger Send API · every message logged (CB-20)
```

## Business rules
All agency values (services, starting rates, hours, policy wording, privacy notice) live in
**`config/business-rules.json`**, copied from *Kualta Agency - Business Rules*. The bot quotes
them word for word. Any value left empty makes the bot hand off for that topic instead of
guessing. To change a price or policy, edit that file and redeploy; no code changes.

| CB rule | Where |
|---|---|
| CB-01 identity, CB-02 tone | `rules.js` greeting/identity, system prompt |
| CB-03 services, CB-04 pricing, CB-05 discounts, CB-06 results, CB-15 policies | `rules.js` (values from config) |
| CB-07 consultation, CB-08 lead capture, CB-09 consent, CB-10 booking, CB-11 after hours | `flows/leadFlow.js`, `business/hours.js` |
| CB-12 sources, CB-13 rule override, CB-14 no guessing | `rag/pipeline.js` (prompt + threshold) |
| CB-16 escalation | `rules.js` (human, complaint, dispute, custom quote, discount) + `chat.js` (low confidence, 2 failures) |
| CB-17 prohibited data | `business/validators.js` (Luhn card check, password/bank patterns, log redaction) |
| CB-18 abuse | `business/abuse.js` (3 strikes → chat ended 24 h) |
| CB-19 retention / deletion | `supabase/schema.sql` (`purge_expired_data`, `delete_user_data`), "DELETE MY DATA" |
| CB-20 logging | `message_logs` table, written by `chat.js` |

Still to fill in: `booking.url` (Calendly / Google Calendar page) and `CONTACT_EMAIL` /
`CONTACT_PHONE`. Until then the bot says the team will email to schedule.

## What we control now (vs. Tidio/Lyro)
| Lever | Where |
|---|---|
| Chunk size / overlap | `src/rag/chunker.js` |
| Similarity threshold | `SIMILARITY_THRESHOLD` env |
| Chunks sent to model | `TOP_K` env + context budget in `pipeline.js` |
| System prompt | `SYSTEM_PROMPT` in `src/rag/pipeline.js` |
| Which content produced an answer | `sources` + `topSimilarity` in every response/log |

## Project layout
```
src/
  server.js            Express app: /health, /chat (test), /webhook/messenger
  config.js            env vars
  chat.js              rules → RAG orchestration (one entry point for all channels)
  rules/rules.js       the rule list (edit here)
  rules/engine.js      normalizer + matcher
  rag/embeddings.js    Gemini embeddings (OpenAI optional via EMBEDDING_PROVIDER)
  rag/vectorStore.js   Supabase pgvector search + upsert
  rag/llm.js           Gemini REST call
  rag/pipeline.js      retrieval + restricted generation + fallbacks
  rag/chunker.js       text splitter
  rag/knowledge.js     loads /knowledge files
  channels/messenger.js webhook verify, signature check, dedupe, send, human takeover
scripts/
  ingest.js            Step 0: load /knowledge into Supabase
  run-eval.js          runs the 18-question test set → eval-results.csv
supabase/schema.sql    table, index, match_documents()
knowledge/             client content goes here (see knowledge/README.md)
tests/                 unit tests + test-set.json
```

## Setup (about 1 hour)

### 1. Local
```bash
npm install
cp .env.example .env     # fill in keys as you get them
npm test                 # 71 tests, no keys needed
```

### 2. Supabase (free)
1. supabase.com → New project.
2. SQL Editor → paste `supabase/schema.sql` → Run.
3. Database → Extensions → enable **pg_cron**, then run the `cron.schedule(...)` line at the bottom of `schema.sql` (12-month auto-deletion, CB-19).
4. Project Settings → API → copy **Project URL** → `SUPABASE_URL`, **service_role** key → `SUPABASE_SERVICE_ROLE_KEY`.

### 3. API keys
- Gemini: aistudio.google.com → Get API key → `GEMINI_API_KEY`.

### 4. Load the knowledge base
`/knowledge` already holds `services.md`, `policies.md` and `privacy.md` from the Business Rules doc.
**On Render you don't need to do anything:** when the bot starts it checks whether these files
changed since the last deploy and, if so, embeds and loads them into Supabase automatically
(no API cost when nothing changed). To add pages (About, FAQ), commit them to `/knowledge` and
push. To preview chunking or load from your own computer instead:
```bash
npm run ingest -- --dry-run   # inspect chunks
npm run ingest
```

### 5. Deploy to Render (free)
1. Push this repo to GitHub (**check `.env` is not committed**).
2. Render → New → Blueprint → pick the repo (uses `render.yaml`).
3. Fill in the secret env vars in the dashboard.
4. Open `https://<app>.onrender.com/health` → `{"ok":true}`.

> Free instances sleep after ~15 min idle and take ~1 min to wake. **Open `/health` a few
> minutes before the demo.** Meta retries webhooks that time out; the bot de-duplicates
> them, so a cold start won't cause double replies.

### 6. Facebook Messenger
Follow [docs/messenger-setup.md](docs/messenger-setup.md): turn off the Business Suite
Messenger automations, create the Meta app, add the Page token and app ID/secret to Render,
connect the webhook (`https://<app>.onrender.com/webhook/messenger`), subscribe to
`messages`, `messaging_postbacks` and `message_echoes`, and add teammates as app testers
(Development mode only delivers messages from people with an app role).

### 7. Run the test set
```bash
npm run eval                                        # in-process
npm run eval -- --url https://<app>.onrender.com    # against deployed bot (needs CHAT_API_KEY)
```

## Security notes
- All keys live in Render env vars. Nothing secret in the repo.
- Webhook requests are HMAC-verified with the app secret; unsigned requests get 401.
- Supabase table has RLS on with no policies, so only the server's service key can touch it.
- `/chat` is off unless `CHAT_API_KEY` is set; turn it off after QA by removing the key. Send `userKey` back to continue a conversation.
- Messenger user IDs are hashed (`DATA_HASH_SALT`) in sessions and logs; leads hold contact details only after consent.
- Card numbers and passwords are never stored: they're detected before processing and redacted from logs.
- Phone numbers are masked in handoff logs.

## Known limits (say these in the demo)
- **Handoff goes to the Page inbox.** Escalations are flagged in `message_logs` (escalated = true); a human replies from Business Suite and the bot pauses for that customer. There is no alert yet, so someone has to watch the inbox.
- **Development mode.** Only people with a role on the Meta app can chat with the bot until Meta's App Review.
- **Short memory.** The bot remembers the lead-capture step and recent failures for 24 h, not the full chat history, so follow-up questions should be self-contained.
- **Public holidays** must be listed by date in `hours_BR02.holidays`.
- **Text only.** Images and voice notes get a polite "please type".
- **Content ceiling.** If the client's content doesn't say it, the bot hands off.
