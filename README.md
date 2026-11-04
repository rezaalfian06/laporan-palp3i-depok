# Laporan PA LP3I Depok

## Menjalankan aplikasi di komputer utama
Komputer utama menyimpan data dan menjalankan server. Komputer ini harus tetap menyala dan terhubung ke jaringan saat aplikasi dipakai.

1. Install Node.js versi 20 atau lebih baru (disarankan versi LTS) dari https://nodejs.org jika belum ada.
2. Ekstrak folder aplikasi di komputer utama.
3. Buka Terminal pada folder yang berisi `package.json`.
4. Jalankan:
   ```bash
   npm install
   npm start
   ```
5. Buka http://localhost:3002 di browser komputer utama, lalu pilih halaman login Admin atau User.

Terminal akan menampilkan alamat jaringan, misalnya `http://192.168.1.10:3002`. Di laptop atau komputer lain yang terhubung ke Wi-Fi/jaringan yang sama, buka alamat IP yang ditampilkan (bukan `localhost`). Jika Windows meminta izin firewall, izinkan Node.js pada jaringan **Private**. Jangan izinkan akses jaringan Public.

Komputer lain hanya perlu browser; tidak perlu memasang Node.js atau menjalankan server. Gunakan satu komputer utama agar semua pengguna melihat data dan lampiran yang sama. Data berada di folder `data/` dan `uploads/` pada komputer utama. Jika aplikasi disalin dan dijalankan sebagai server di beberapa komputer, masing-masing salinan memiliki data sendiri.

Untuk memakai aplikasi dari luar jaringan yang sama, diperlukan hosting atau VPN yang dikonfigurasi dengan aman. Jangan membuka port aplikasi langsung ke internet.

Jika muncul pesan bahwa port sudah digunakan, aplikasi kemungkinan sudah berjalan. Buka http://localhost:3002 di browser dan jangan jalankan `npm start` lagi. Untuk memulai ulang, hentikan proses server lama dengan `Ctrl+C`, kemudian jalankan `npm start`.

## Deployment ke Vercel
Aplikasi ini memakai Express. Di Vercel, data akun/laporan disimpan di Supabase, lampiran di Supabase Storage privat, dan sesi login memakai cookie bertanda tangan. Folder `data/` dan `uploads/` hanya digunakan saat aplikasi berjalan lokal; keduanya bukan penyimpanan produksi.

### 1. Siapkan Supabase
1. Buat project di https://supabase.com dan tunggu sampai database siap.
2. Buka **SQL Editor**, tempel isi file `supabase-schema.sql`, lalu jalankan. Skrip ini membuat tabel, mengaktifkan Row Level Security, dan membuat bucket lampiran privat bernama `laporan-attachments`.
3. Buka **Project Settings → API** dan salin **Project URL** serta **service_role key**. Jangan gunakan atau bagikan service role key di browser, repositori, atau chat; key ini hanya untuk environment variable server.

### 2. Hubungkan Vercel
1. Push project ini ke GitHub, lalu di Vercel pilih **Add New → Project** dan import repositori.
2. Pada **Project Settings → Environment Variables**, tambahkan:
   - `SUPABASE_URL` — Project URL dari Supabase.
   - `SUPABASE_SERVICE_ROLE_KEY` — service role key dari Supabase.
   - `SUPABASE_BUCKET` — `laporan-attachments` (opsional jika memakai nama default).
   - `SESSION_SECRET` — string acak minimal 32 karakter. Buat di komputer dengan `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`.
   - `INITIAL_ADMIN_USERNAME` — username admin pertama.
   - `INITIAL_ADMIN_PASSWORD` — password admin pertama, minimal 12 karakter.
   - `INITIAL_ADMIN_NAME` — nama admin (opsional).
3. Atur variabel untuk **Production**. Jika juga ingin memakai Preview Deployment, sebaiknya gunakan project Supabase terpisah agar data uji tidak bercampur dengan data produksi.
4. Deploy atau tekan **Redeploy** setelah semua environment variable tersimpan.
5. Setelah deployment berhasil, buka `https://alamat-project-anda.vercel.app/api/health`. Respons `{"status":"ok","storage":"supabase",...}` menandakan aplikasi terhubung. Buka `/admin` untuk login menggunakan kredensial admin yang Anda atur. Buat akun user dari dashboard admin.

Jangan masukkan kredensial ke source code atau commit file `.env`. Vercel tidak menyediakan disk persisten untuk file unggahan; bucket Supabase privat memastikan lampiran hanya dapat diambil melalui endpoint aplikasi setelah pemeriksaan akses. Batas upload saat online adalah **4 MB per file**, mengikuti batas request Vercel; saat lokal batasnya 10 MB.

### Memindahkan data lokal yang sudah ada
Jika sudah memiliki akun/laporan di `data/users.json`, `data/reports.json`, dan file di `uploads/`, jalankan migrasi dari komputer Anda setelah SQL dan bucket dibuat. Atur sementara environment variable `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_BUCKET`, `INITIAL_ADMIN_USERNAME`, dan `INITIAL_ADMIN_PASSWORD` pada terminal PowerShell, lalu jalankan:

```powershell
node scripts/migrate-to-supabase.js
```

Skrip memindahkan akun, laporan, dan lampiran, serta mengatur ulang password admin yang cocok dengan `INITIAL_ADMIN_USERNAME` ke password awal yang Anda tentukan. Jangan kirim atau tempel service role key ke pihak lain. Setelah migrasi selesai, pasang nilai environment yang sama di Vercel dan deploy ulang.

## Akun demo
- Akun berikut hanya dibuat untuk instalasi lokal; akun ini tidak dibuat otomatis saat deployment Vercel.
- Admin: username `admin`, password `admin123`
- User: username `user`, password `user123`

Login Admin dan User menggunakan username dan password, lalu diarahkan ke dashboard masing-masing. Admin dapat melihat, membuat, mengedit, dan menghapus semua laporan, ekspor CSV, serta membuat dan menghapus akun. Hanya Admin yang dapat mengelola akun; User hanya dapat melihat dan mengelola laporan miliknya sendiri. Konfirmasi penghapusan laporan dan akun ditampilkan dalam dialog khusus di dalam aplikasi. Gunakan pencarian, filter kelas, pengurutan tanggal, dan halaman arsip untuk menemukan laporan. Ekspor CSV mengikuti pencarian dan filter yang sedang aktif. Gunakan tombol **Edit** pada kartu laporan untuk memperbarui data; lampiran lama tetap tersimpan jika tidak memilih lampiran pengganti.
Lampiran mendukung PDF, JPG/JPEG, PNG, DOC/DOCX, dan XLS/XLSX sampai 10 MB saat lokal atau 4 MB saat online di Vercel. PDF dan gambar dapat dipratinjau dari riwayat laporan; semua lampiran dapat diunduh kembali. Setiap laporan juga dapat diekspor menjadi file PDF atau gambar JPG/JPEG dari tombol pada kartu laporan.

Saat berjalan lokal, data disimpan di folder `data/` dan lampiran di `uploads/`; cadangkan kedua folder tersebut secara berkala. Pada deployment Vercel, gunakan langkah Supabase di atas. Buat password admin yang kuat dan simpan kredensial dengan aman.

Akun demo dibuat saat server dimulai jika username-nya belum ada. Password akun yang sudah tersimpan tidak diatur ulang. Ganti password akun demo sebelum digunakan di lingkungan nyata.
