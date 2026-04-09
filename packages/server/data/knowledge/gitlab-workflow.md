# GitLab Workflow

## Prerequisites
- VPN harus connected (lihat knowledge vpn.md)
- `glab` authenticated ke `mygitlab-dev.ioh.co.id`
- Env vars: `$GITLAB_HOST`, `$GITLAB_TOKEN`, `$GITLAB_API`

## glab CLI Commands

### MR Operations
```bash
# List open MRs
glab mr list

# View MR detail
glab mr view <MR_IID>

# View MR diff
glab mr diff <MR_IID>

# Create MR
glab mr create --title "feat: description" --description "..." --target-branch develop

# Comment on MR
glab mr comment <MR_IID> --message "review text"

# Approve MR
glab mr approve <MR_IID>
```

### CI/CD
```bash
# View pipeline status
glab ci view <PIPELINE_ID>

# View CI status for current branch
glab ci status
```

## GitLab API (curl)

### Reply to Discussion Thread
```bash
curl -X POST "$GITLAB_API/projects/$PROJECT_ID/merge_requests/$MR_IID/discussions/$DISCUSSION_ID/notes" \
  -H "PRIVATE-TOKEN: $GITLAB_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"body":"reply message"}'
```

### Resolve Discussion
```bash
curl -X PUT "$GITLAB_API/projects/$PROJECT_ID/merge_requests/$MR_IID/discussions/$DISCUSSION_ID" \
  -H "PRIVATE-TOKEN: $GITLAB_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"resolved":true}'
```

### List Unresolved Discussions
```bash
curl -s "$GITLAB_API/projects/$PROJECT_ID/merge_requests/$MR_IID/discussions" \
  -H "PRIVATE-TOKEN: $GITLAB_TOKEN" | jq '.[] | select(.notes[].resolved == false)'
```

### Create MR via API
```bash
curl -X POST "$GITLAB_API/projects/$PROJECT_ID/merge_requests" \
  -H "PRIVATE-TOKEN: $GITLAB_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"source_branch":"feat/x","target_branch":"develop","title":"feat: description"}'
```

## Git Workflow

### Bikin Branch & Push
```bash
git fetch origin
git checkout -b feat/short-description origin/develop
# ... code ...
git add -A
git commit -m "feat: description"
git push -u origin feat/short-description
```

### Responding to Review Comments
1. Baca comment context (file, line)
2. Fix kode kalo perlu
3. Commit & push fix DULU
4. Reply ke discussion thread (curl API)
5. Resolve discussion (curl API)
