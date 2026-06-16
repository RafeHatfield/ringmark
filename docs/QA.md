# Ringmark — Manual QA Checklist

Work through this top-to-bottom on production (`ringmark.org`) after every deploy.
Each block is independently testable. Open a second browser in incognito for anonymous-user checks.

---

## Auth

- [ ] `/auth` loads with email + password form (no OTP, no magic link)
- [ ] Submitting with wrong password shows an inline error message (not a blank page, not a redirect)
- [ ] Submitting with correct credentials lands on `/` with the Ringmark header and account name visible
- [ ] Navigating to `/` while logged out redirects to `/auth`
- [ ] Navigating to `/objects/[any-id]` while logged out redirects to `/auth`
- [ ] Navigating to `/auth` while already logged in redirects to `/`

---

## Create a source

- [ ] Home page has both **+ Add Source** and **+ Add Object** buttons
- [ ] Tapping **+ Add Source** opens `/objects/new?type=source` with "Source" pre-selected in the type dropdown
- [ ] Workshop ID field is pre-filled with the next available root ID (e.g. `RH1`)
- [ ] Can save with just ID + type — no other fields required
- [ ] After save, lands on the object detail page with the workshop ID in the heading
- [ ] Object appears in the **Recent** list on the home page

---

## Create a child (log)

- [ ] On the source detail page, the **+ Add Child** button is visible
- [ ] Tapping it opens the child creation form showing "Child of RH1" indicator
- [ ] Select type **Log**, leave ID as suggested (`RH1-1`), save
- [ ] After save, the detail page for `RH1-1` shows **Parent: RH1** in the Lineage section
- [ ] Navigating back to `RH1` shows `RH1-1` listed under Children

---

## Create a grandchild (blank) — flat ID test

- [ ] On `RH1-1`, tap **+ Add Child**, set type to **Blank**
- [ ] Suggested ID is `RH1-2` — NOT `RH1-1-1` (flat counter under root, not a path)
- [ ] After save, `RH1-2` lineage shows **Parent: RH1-1** and the root is `RH1`
- [ ] Navigating to `RH1-1` shows `RH1-2` under Children

---

## Transform a record (blank → finished bowl)

- [ ] On `RH1-2`, tap **Edit**
- [ ] Change type to **Rough Bowl**, change status to **Rough Turned**, save
- [ ] Detail page reflects updated type and status (same ID `RH1-2`, no new record)
- [ ] Change type to **Finished Bowl**, status to **Finished**, save
- [ ] Detail page reflects both changes

---

## Photos

- [ ] On any object detail page, the Photos section is visible with an upload control
- [ ] Can upload a photo — it appears in the Photos section after upload
- [ ] Can add a caption to a photo
- [ ] Photos are marked **public** by default
- [ ] Can toggle a photo to **private**
- [ ] Private photos do NOT appear on the public story page (test in incognito after publishing)

---

## Story + publish

- [ ] On `RH1-2`, tap **Edit Story**
- [ ] Can fill in a public title and story text
- [ ] Tap **Save draft** → returns "Saved." confirmation
- [ ] Back on the detail page, status shows **Not published**
- [ ] Return to Edit Story → tap **Publish**
- [ ] Detail page now shows **Published** green badge
- [ ] The public URL link `/p/[slug]` is visible on the detail page
- [ ] Opening that link in a new tab shows the public story page with title + story text

---

## QR routing (critical — two experiences from one URL)

- [ ] While logged in, open `/p/[slug]` for an object you own → redirected immediately to `/objects/[id]` (admin view)
- [ ] In incognito, open the same `/p/[slug]` for a **published** object → public story page renders (no login prompt)
- [ ] In incognito, open `/p/[slug]` for an **unpublished** object → shows "hasn't been published yet" message (not blank, not 404)
- [ ] Private notes entered on the edit page do NOT appear anywhere on the public page text

---

## Search

- [ ] On the home page, typing `RH1` in the search box → source appears in results
- [ ] Typing `RH1-2` → that object appears
- [ ] Typing a partial title → matching objects appear
- [ ] Clearing the search → shows Recent list

---

## Delete with confirmation

- [ ] On any object detail page, scroll to **Danger Zone** at the bottom
- [ ] Tapping **Delete object** once → button changes to **Yes, delete permanently** (and a Cancel option)
- [ ] Tapping **Cancel** → returns to the normal delete button (no deletion occurred)
- [ ] Tapping **Yes, delete permanently** → object deleted, redirected to home
- [ ] The deleted object no longer appears in search results or the Recent list

---

## Error states

- [ ] Navigate to `/objects/00000000-0000-0000-0000-000000000000` → shows a not-found page with a home link (not a blank page, not a crash)
- [ ] Navigate to `/p/definitely-does-not-exist` → shows "could not be found" message (not a crash)
