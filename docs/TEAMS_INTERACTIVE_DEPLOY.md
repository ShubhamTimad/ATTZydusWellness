# Interactive Teams deploy buttons (in-chat, no GitHub redirect)

GitHub **Incoming Webhooks** can only use **Open URL** buttons (they leave Teams).  
True in-chat **Deploy now / Cancel / Retry** needs a one-time **Power Automate / Teams Workflow** that:

1. Receives a signal from GitHub when a deploy is pending  
2. Posts an Adaptive Card and **waits for a button click in Teams**  
3. Calls GitHub to cancel or start deploy  

## Secrets

| Secret | Purpose |
|--------|---------|
| `TEAMS_WEBHOOK_URL` | Status messages (pending text, success, failure) |
| `TEAMS_APPROVAL_FLOW_URL` | HTTP URL of your Power Automate flow (interactive buttons) |
| `GH_PAT` | PAT with **Actions: Read and write** (used by `deploy-control.yml`) |

## 1. Create GitHub PAT

GitHub → Settings → Developer settings → Personal access tokens  
- Fine-grained: this repo, **Actions: Read and write**  
- Add as repo secret `GH_PAT`

## 2. Create Power Automate flow

1. [make.powerautomate.com](https://make.powerautomate.com) → **Create** → **Instant cloud flow**  
2. Trigger: **When an HTTP request is received**  
3. Use this sample JSON schema for the trigger:

```json
{
  "type": "object",
  "properties": {
    "title": { "type": "string" },
    "text": { "type": "string" },
    "run_id": { "type": "string" },
    "run_url": { "type": "string" },
    "repo": { "type": "string" },
    "branch": { "type": "string" },
    "actor": { "type": "string" },
    "sha": { "type": "string" },
    "skip_wait": { "type": "boolean" }
  }
}
```

4. Add action: **Post adaptive card and wait for a response** (Teams)  
   - Post in: **Deploy-alerts**  
   - Card body: use a card with three **Action.Submit** (or Flow buttons) whose submit data is:

| Button | `action` value |
|--------|----------------|
| Deploy now | `deploy_now` |
| Cancel | `cancel` |
| Retry | `retry` |

   Include `run_id` from the trigger in the submit data.

5. After the wait action, **Condition** on the chosen `action`:

**HTTP** (GitHub API) — same for each branch, change `action` input:

- Method: `POST`  
- URI: `https://api.github.com/repos/Timad-Bharat/Asset-Tagging-and-Tracking-Takeda-Web/actions/workflows/deploy-control.yml/dispatches`  
- Headers:  
  - `Authorization`: `Bearer YOUR_GH_PAT`  
  - `Accept`: `application/vnd.github+json`  
  - `Content-Type`: `application/json`  
- Body:

```json
{
  "ref": "develop",
  "inputs": {
    "action": "@{triggerBody()?['action']}",
    "target_run_id": "@{triggerBody()?['run_id']}"
  }
}
```

(Map `action` from the Adaptive Card response, and `run_id` from the HTTP trigger body.)

6. Optional: **Post message** in Deploy-alerts: “Deploy now requested…” / “Deploy cancelled…”

7. **Save** the flow → copy the HTTP **POST URL** → GitHub secret `TEAMS_APPROVAL_FLOW_URL`

## 3. What GitHub does

On pending deploy (not skip-wait), Actions POSTs to `TEAMS_APPROVAL_FLOW_URL` with `run_id`, etc.  
Your flow shows the card; a click stays **in Teams** and triggers `deploy-control.yml`:

- **deploy_now** → cancels waiting run → starts deploy with `skip_wait=true`  
- **cancel** → cancels waiting run  
- **retry** → cancels waiting run → starts a new deploy (with 5-minute wait)

Success/failure messages still go through `TEAMS_WEBHOOK_URL`.

## 4. Test

1. Set `TEAMS_APPROVAL_FLOW_URL` and `GH_PAT`  
2. Run **Deploy develop**  
3. In **Deploy-alerts**, click **Deploy now** — should not open GitHub; a new Actions run should appear with skip wait  
4. Or click **Cancel** — waiting run should stop
