# GitLab Workflow

## Prerequisites
- VPN harus connected (lihat knowledge vpn.md)
- `glab` authenticated ke `mygitlab-dev.ioh.co.id`
- Env vars: `$GITLAB_HOST`, `$GITLAB_TOKEN`, `$GITLAB_API`

---

## ⚡ FAST FLOWS — Gunakan ini, jangan improvisasi

### Merge MR (paling umum)
```bash
# 1. Cek VPN
curl -sk -o /dev/null -w "%{http_code}" --connect-timeout 5 https://mygitlab-dev.ioh.co.id
# Kalau bukan 302 → connect VPN dulu (lihat vpn.md)

# 2. Cek MR list
glab mr list

# 3. Merge
glab mr merge <MR_IID> --squash --remove-source-branch
```
**Selesai. 3 langkah. Jangan lebih.**

### Review MR
```bash
glab mr view <MR_IID>   # baca deskripsi
glab mr diff <MR_IID>   # baca diff
glab mr comment <MR_IID> --message "review text"
glab mr approve <MR_IID>  # kalau approve
```

### Respond to Review Comment (FULL AUTO)
```bash
# 1. Fix kode, commit, push
# 2. Reply discussion
curl -X POST "$GITLAB_API/projects/$PROJECT_ID/merge_requests/$MR_IID/discussions/$DISCUSSION_ID/notes" \
  -H "PRIVATE-TOKEN: $GITLAB_TOKEN" -H "Content-Type: application/json" \
  -d '{"body":"Fixed. [jelaskan perubahan]"}'
# 3. Resolve
curl -X PUT "$GITLAB_API/projects/$PROJECT_ID/merge_requests/$MR_IID/discussions/$DISCUSSION_ID" \
  -H "PRIVATE-TOKEN: $GITLAB_TOKEN" -H "Content-Type: application/json" \
  -d '{"resolved":true}'
```

---

## ⚠️ Rules — WAJIB Diikuti

- **SELALU gunakan `glab` CLI untuk MR operations** — jangan curl kalau glab bisa
- **JANGAN spawn Agent subagent untuk GitLab tasks** — lakukan langsung dengan Bash + glab
- **JANGAN polling loop** — cek sekali, kalau gagal stop dan report ke user
- **Satu task = satu VPN session** — connect, kerjakan, disconnect. Tidak boleh biarkan VPN nyala

---

## glab CLI — Full Reference

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

# Merge MR
glab mr merge <MR_IID> --squash --remove-source-branch
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
