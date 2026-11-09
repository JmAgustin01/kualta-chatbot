# Facebook Messenger setup

**Owner:** Prince (Page) + JM (Meta app, webhook) · **QA:** JM · **Screenshots:** Jerry

The bot answers on the demo Facebook Page's Messenger. Our Express backend receives messages
through Meta's Messenger webhook, so the bot itself handles greetings, prices, policies,
lead capture with consent, and every other business rule.

> Menu names below are how Meta labels them at the time of writing. If a screen looks different,
> screenshot it and tell the team before improvising.

## 1. The Page
- Name: **Kualta Agency Demo (Greek AI)** (rename takes up to 3 days to be approved)
- Category: Marketing Agency
- Bio: *Demo Page for the Greek AI PDC60 chatbot project. Not an active business.*
- Hours: Monday–Friday, 9:00 AM–6:00 PM (BR-02)
- Action button: **Send message**
- Profile picture / cover: Greek AI branding (no checkmark-style badges)

## 2. Turn OFF the Business Suite Messenger automations
The bot replaces them. If they stay on, customers get two replies.
Business Suite → **Inbox** → **Automations** → switch off **Instant reply**, **Away message**,
**Frequently asked questions** and any **Custom keywords** for Messenger.
Also leave **Meta Business Agent** (Meta's AI replies) off.

## 3. Create the Meta app (JM)
1. developers.facebook.com → **My Apps** → **Create app**. Pick the use case for messaging
   customers on **Messenger** (Business app type). Connect it to the same Facebook account that
   manages the Page.
2. **App settings → Basic**: copy **App ID** → `META_APP_ID` and **App secret** → `META_APP_SECRET`.
3. **Messenger → Messenger API settings**: connect the demo Page, then **Generate token**
   → `MESSENGER_PAGE_ACCESS_TOKEN`. Treat it like a password; it only goes into Render.
4. Note the **Graph API version** shown in the dashboard → `GRAPH_API_VERSION` (e.g. v25.0).

## 4. Connect the webhook (after Render is live)
1. In Render, make sure `/health` returns `{"ok":true}` and these env vars are set:
   `MESSENGER_PAGE_ACCESS_TOKEN`, `META_VERIFY_TOKEN` (any random string you choose),
   `META_APP_ID`, `META_APP_SECRET`.
2. Messenger API settings → **Configure webhooks**:
   - Callback URL: `https://<your-app>.onrender.com/webhook/messenger`
   - Verify token: the same string as `META_VERIFY_TOKEN`
   - **Verify and save**
3. Under the Page's webhook subscriptions, subscribe to **messages**, **messaging_postbacks**
   and **message_echoes**. (`message_echoes` is what lets the bot notice when a human replies.)

## 5. Who can chat with the bot
While the app is in **Development mode**, Messenger only delivers messages from people who have
a role on the app. Add Jerry, Prince and any demo testers under **App roles → Roles** (as
developers or testers) and have them accept the invite. Letting the general public use the bot
requires Meta's App Review for messaging permissions, which is out of scope for the class demo.

## 6. Human handoff
When the bot hands off (complaint, discount, "talk to a person", low confidence…), reply to the
customer from the Business Suite **Inbox** as the Page. The bot sees your reply and stays quiet
for that customer for 12 hours (`HUMAN_PAUSE_HOURS`), so it won't talk over you.

## 7. Test (QA)
From a teammate's account that has an app role, message the Page:
`hi` · `How much is SEO?` · `Can I get 30% off?` · `How do I get started?` (go through consent and
the details) · `Write me a poem` · `DELETE MY DATA`. Then reply once from the inbox and confirm
the bot goes quiet. Jerry screenshots each step plus the Meta app webhook settings.
