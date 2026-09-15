# Aiconic Daily Reach-Out List

A small live web app. It reads the Free Trial Funnels pipeline from GoHighLevel every time the page loads, shows each salesperson their booked pipeline, flags anyone our automatic confirmation could not reach, shows the reason on every lead, and lets a rep send the SMS through GoHighLevel with one click.

The link is meant to live in the portal for now. Later the same logic moves inside the portal itself.

## How the list works

Every person who books a call needs a personal message from their salesperson. That is what lifts the show-up rate. So every booked lead appears in the list, under the rep who owns them. Nobody is left off because an automatic message happened to go out.

On top of that, each lead shows what GoHighLevel already sent (the last email and the last SMS, with its delivery status) so the personal message never repeats the automated one. Anything the rep should know is flagged:

1. There is no phone number on file, so the automatic SMS could not be sent.
2. The SMS failed to deliver, usually a carrier or country block.
3. The confirmation email bounced, so the address is invalid.

A flag does not decide whether we contact someone. We contact everyone. The flag just says what is going on and which channel to use. The logic lives in `lib/evaluate.js` and is also shown at the top of the page.

## How it is put together

- `public/` the page the team sees (index.html, styles.css, app.js). No secrets here.
- `api/leads.js` reads GoHighLevel live, applies the rule, returns the pipeline grouped by salesperson.
- `api/send-sms.js` sends an SMS through GoHighLevel.
- `lib/ghl.js` the GoHighLevel client. `lib/evaluate.js` the flagging rule.

The GoHighLevel token stays on the server. The browser never sees it.

## Deploy in five steps

1. Put this folder in a new GitHub repository.
2. In Vercel, choose Add New Project and import that repository. No build command or framework is needed; Vercel serves `public/` and runs `api/` automatically.
3. In Vercel, open Settings then Environment Variables and add the values from `.env.example`:
   - `GHL_TOKEN` the GoHighLevel Private Integration token.
   - `GHL_LOCATION_ID` already filled with the Aiconic location.
   - `GHL_PIPELINE_ID` already filled with Free Trial Funnels.
   - `REP_NAMES` optional, only if a salesperson shows blank.
4. Deploy. Vercel gives you a live link.
5. Put that link in the portal.

Every visit reads live data, so there is nothing to update by hand.

## The GoHighLevel token

Create a Private Integration token in GoHighLevel: Settings, then Private Integrations, then create one with access to Opportunities, Contacts, Conversations, and Users. Paste it into Vercel as `GHL_TOKEN`. If a token is ever exposed, delete it in GoHighLevel and create a new one.

## Local check (optional, for John)

```
npm i -g vercel
vercel dev
```

Set the same environment variables locally in a `.env` file first. Open the local link and the page loads live data.
