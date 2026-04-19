# MR !544 Pipeline Issues — ide-phoenix

Dokumentasi lessons learned dari pipeline failure MR !544 (`s68/phb-3267/fix-over-limit-delivery-msisdn-per-ca`). Disimpan supaya pattern serupa bisa dikenali cepat di kemudian hari.

---

## Status

- **MR:** !544 — `[PHB-3267] fix: requires_over_limit_in_delivery? scope per CA`
- **Repo:** `/root/repos/ide-phoenix`
- **Branch:** `s68/phb-3267/fix-over-limit-delivery-msisdn-per-ca`
- **Fix commit:** `a9b9dbbc` (rebased on top of origin/main)
- **Failed job:** `code-quality (unit-test)` → RSpec
- **Failing spec:** `spec/models/order_spec.rb:3264` — "when total MSISDN is exactly 100 returns false"
- **Error message:** `expected false, got true`
- **State:** Resolved — test isolated, pushed, pipeline green

---

## Root Cause

**Shared-context contamination ke dalam MSISDN aggregation.**

Describe block `#requires_over_limit_in_delivery?` mendefinisikan `let(:customer) { create(:customer) }` sebagai customer target perhitungan MSISDN.

File spec yang sama mem-`include_context "with order documents"` + `"with order payment data"`, yang internally pakai shared context `with order` (lihat `spec/support/shared_contexts/master_data_contexts.rb:97-110`) — di sana ada `let(:order)` yang bikin `order + order_item` untuk `customer`.

Shared context `with approved document approval` (line 131-134) punya `before` block yang **force-evaluate** `order` sebelum tiap example. Efeknya:

1. Tiap example di describe ini otomatis membuat satu extra `order + order_item`
2. `order_item` itu ambil `item_quantity` dari `Faker::Number.between(product.msisdn_range[:min], :max)`
3. Untuk product `q_1_9`, range = 1..9 → random 1-9 MSISDN extra
4. Karena shared `order` refer ke `customer` (nama let yang sama), dia attach ke **customer target test**
5. `Order.total_msisdn_for_customer(customer)` jadi kena kontaminasi: nilai test + 1..9

**Contoh numerik pada test "tepat 100":**
- Test bikin parent_order dengan item_quantity = 100
- Shared context bikin extra order_item dengan item_quantity = 1..9
- `total_msisdn_for_customer` = 100 + (1..9) = 101..109
- `101..109 > 100` → returns true (padahal expected false)

Kenapa ini **deterministic fail**, bukan flaky:
- Range 1..9 selalu > 0, jadi sum selalu > 100 → selalu fail
- Test "< 100 (50 qty)": 50 + 1..9 = 51..59 < 100 → lolos kebetulan
- Test "> 100 (101 qty)": 101 + 1..9 = 102..110 > 100 → lolos kebetulan
- Hanya boundary-case `== 100` yang selalu kegeser ke > 100

---

## Solution Applied

Rename `let(:customer)` menjadi `let(:target_customer)` di dalam describe block, update seluruh referensi (~10 tempat: parent_order, parent_order_2, cancelled_order, dan semua `customer: customer` → `customer: target_customer`).

```ruby
# Use a dedicated customer that is NOT the one bound by the shared `with order`
# context — the shared `order` attaches a random-quantity order_item under the
# outer `customer` let, which would otherwise inflate the MSISDN sum here.
let(:target_customer) { create(:customer) }
```

Efeknya:
- Shared `order` tetap bikin extra order_item, tapi di-attach ke `customer` dari shared context (customer berbeda)
- `total_msisdn_for_customer(target_customer)` hanya hitung order yang test ini buat sendiri
- Boundary case `== 100` sekarang benar-benar 100

Commit: `a9b9dbbc` — title `test(order): isolate requires_over_limit_in_delivery? from shared "order" context`.

---

## Prevention Checklist

Sebelum nulis describe block yang mengaggregate data per-entity (customer, order, user, dll):

- [ ] **Cek shared context mana yang di-include di file spec.** `include_context "with X"` sering bawa `let` implicit yang match by name.
- [ ] **Grep shared context buat liat `let` apa saja yang terekspos** — di ide-phoenix: `spec/support/shared_contexts/master_data_contexts.rb`.
- [ ] **Hindari nama `let` yang bentrok** dengan nama-nama generic di shared context: `customer`, `order`, `user`, `product`, `location`. Pakai nama spesifik: `target_customer`, `primary_order`, `test_user`.
- [ ] **Kalau test mengandalkan count/sum** (misal `total_msisdn_for_customer`, `total_price`, `count`), pastikan tidak ada factory/shared context yang force-create entity tambahan under same key.
- [ ] **Cek apakah shared context punya `before` block yang force-evaluate let.** `before { order }` = order selalu dibuat, walaupun test tidak explicit refer ke `order`.
- [ ] **Untuk factory dengan random nilai** (`Faker::Number.between`), pastikan test boundary case tidak sensitif ke noise random.
- [ ] **Baseline sanity check:** setelah bikin describe, jalankan test kosong (`expect(true).to be true`) dulu — kalau ada side effect yang bikin entity extra, langsung ketahuan di DB state.
- [ ] **Kalau boundary test gagal tapi test lain pass**, curiga noise aditif konstan. Cari siapa yang nambahin 1-9 (atau angka kecil lain) ke aggregation.
- [ ] **Jangan pakai `update_column` untuk bypass callback** kecuali yakin side effect callback tidak dibutuhkan — ini shortcut yang bisa sembunyikan bug lain.
- [ ] **Isolasi test dari shared state** dengan prefix `:no_txn` / `:aggregate_failures` kalau perlu, atau bikin helper `let(:isolated_customer)` yang clearly not shared.

---

## Related References

- `spec/support/shared_contexts/master_data_contexts.rb:97-134` — definisi shared `with order`, `with approved document approval`
- `spec/factories/order_items.rb` — `item_quantity` random range
- `app/models/order.rb:786-809` — `total_msisdn_for_customer` + `requires_over_limit_in_delivery?`
- `app/models/order.rb:9` — `FIXED_QUOTA_MSISDN_LIMIT = ENV.fetch(...)` (butuh `stub_const` di test untuk pinning)
