# GitLab Workflow

## Prerequisites
- VPN harus connected — cek dengan `vpn-check` (script di /usr/local/bin/)
- `glab` sudah authenticated ke `mygitlab-dev.ioh.co.id`
- Env vars sudah di .bashrc: `$GITLAB_HOST`, `$GITLAB_TOKEN`, `$GITLAB_API`
- Token: di `~/.config/glab-cli/config.yml` key `token`

## Repo lokal
- ide-phoenix: `/root/repos/ide-phoenix`
- ide-landing: `/root/repos/ide-landing` (kalau ada)

---

## ⚡ FAST FLOWS — Gunakan ini, jangan improvisasi

### 0. Wajib di awal setiap task GitLab
```bash
vpn-check || (sudo systemctl start openconnect && echo "Approve Silverfort di HP dulu")
# Tunggu user konfirmasi sudah approve, lalu verifikasi: vpn-check
```

### Buat MR (one-liner)
```bash
# Di folder repo yang sudah ada perubahan:
mr-create "feat: judul MR" main
# Script otomatis: VPN check, ambil commit log, generate description, push MR
```

### Merge MR (paling umum)
```bash
# 1. Cek VPN
vpn-check
# Kalau tidak konek → start VPN dulu

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

---

## Rebase Conflict Patterns — ide-phoenix

Pola-pola rebase yang ditemukan di ide-phoenix. Update saat nemu kasus baru.

---

### Pattern 1: Local Diverged dari Remote (MR !546)

**Kapan terjadi:** Branch sudah pernah di-rebase secara lokal di sesi sebelumnya, tapi hasilnya tidak di-push. Remote branch masih punya commit lama dengan hash berbeda.

**Symptom:**
- `git rebase origin/main` di lokal langsung bilang "up to date" (karena lokal sudah rebased)
- Tapi remote branch masih tertinggal beberapa commit di belakang main
- GitLab bisa report `has_conflicts: False` meski branch stale (karena file yang disentuh tidak overlap)
- `git log --oneline origin/main...local-branch` vs `origin/fix/branch-name` berbeda hash untuk commit yang sama

**Diagnostic:**
```bash
# Bandingkan local vs remote tip
git log --oneline origin/<branch-name> -3
git log --oneline <branch-name> -3

# Cek merge-base remote vs main
git merge-base origin/<branch-name> origin/main
# Kalau hasilnya bukan tip origin/main → remote masih stale

# Konfirmasi via GitLab API
curl -s "$GITLAB_API/projects/$PROJECT_ID/merge_requests/$MR_IID" \
  -H "PRIVATE-TOKEN: $GITLAB_TOKEN" | python3 -c \
  "import json,sys; d=json.load(sys.stdin); print('conflicts:', d.get('has_conflicts'), '| status:', d.get('merge_status'))"
```

**Quick Resolution:**
```bash
# 1. Fetch fresh
git fetch origin

# 2. Reset local ke state remote (bukan lokal yang sudah diverge)
git checkout <branch-name>
git reset --hard origin/<branch-name>

# 3. Rebase dari kondisi remote yang bersih
git rebase origin/main
# Kalau conflict → resolve manual, lalu: git add <file> && git rebase --continue

# 4. Force push
git push --force-with-lease origin <branch-name>

# 5. Disconnect VPN setelah selesai
sudo systemctl stop openconnect
```

**Kenapa `--force-with-lease` dan bukan `--force`:**
`--force-with-lease` gagal kalau ada commit di remote yang belum kita pull — safety net supaya tidak overwrite perubahan orang lain.

---

### Pattern 2: Stale Branch, File Overlap (TBD — MR !548)

*Belum diobservasi langsung. Update section ini saat encounter MR !548.*

**Dugaan penyebab:** Branch lama yang menyentuh file yang juga diubah di main (misal `routes.rb`, `application.rb`, migration files) — kemungkinan besar akan conflict nyata saat rebase.

**File di ide-phoenix yang sering jadi conflict magnet:**
- `config/routes.rb` — banyak MR tambah routes bersamaan
- `config/locales/en.yml` + `id.yml` — i18n keys sering bentrok
- `db/schema.rb` — auto-generated, sering out-of-sync
- `app/models/order.rb` — file besar, banyak yang menyentuh

**Strategi resolve file-file ini:**
```bash
# routes.rb: gabungkan kedua blok route, jangan pilih salah satu
# locales: merge kedua set key, pastikan tidak ada duplikasi
# schema.rb: SELALU pakai versi setelah rake db:migrate, jangan manual edit
# order.rb: baca kedua versi dengan teliti, gabungkan intent bukan syntax
```

---

### Pattern 3: Rebase Loop / Repeated Conflict (TBD — MR !549)

*Belum diobservasi langsung. Update section ini saat encounter MR !549.*

**Dugaan penyebab:** Branch dengan banyak commit kecil yang masing-masing menyentuh file yang sama. Saat rebase, tiap commit bisa conflict satu per satu.

**Mitigasi:**
```bash
# Squash semua commit di branch jadi satu sebelum rebase
git rebase -i origin/main
# → pilih 'squash' untuk semua commit kecuali yang pertama
# → resolve conflict sekali saja, push
```

---

### Checklist Rebase di ide-phoenix

Sebelum mulai rebase apapun:

- [ ] `git fetch origin` — pastikan origin state fresh
- [ ] Cek merge-base: `git merge-base origin/<branch> origin/main` — harus == tip main
- [ ] Cek apakah local branch == remote branch (hash sama?)
- [ ] Kalau local diverge → `git reset --hard origin/<branch>` dulu baru rebase
- [ ] Konfirmasi conflict status via GitLab API sebelum report ke user
- [ ] Setelah push `--force-with-lease`, verifikasi via `glab mr view <IID>` bahwa `merge_status: can_be_merged`
- [ ] Disconnect VPN setelah selesai
