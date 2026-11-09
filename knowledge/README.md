# Knowledge base

The bot can only answer what is written here. If the client's site doesn't say it, the bot won't either.

## What goes in this folder

| File | Content | Owner |
|---|---|---|
| `services.md` | Services page text | Prince (from client) |
| `faq.md` | FAQ page text | Prince |
| `about.md` | About page text | Prince |
| `contact.md` | Contact page text | Prince |
| `privacy.qa.json` | The 8 privacy-policy Q&A pairs | JM |
| `extra.qa.json` | Hand-written Q&A for common questions the pages answer poorly | JM |

## Formats

**Pages (`.md`)**: paste the page text. Start with `# Page Title`. Use `## Subheadings`, because each heading starts a new chunk.

**Q&A (`.qa.json`)**:
```json
[
  { "question": "Do you sell my personal data?", "answer": "..." }
]
```

Files starting with `_` are examples and are **not** ingested.

## After editing

```bash
npm run ingest -- --dry-run   # check the chunks look right
npm run ingest                # embed + store in Supabase
```
