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

## Akun demo
- Admin: username `admin`, password `admin123`
- User: username `user`, password `user123`

Login Admin dan User menggunakan username dan password, lalu diarahkan ke dashboard masing-masing. Admin dapat melihat, membuat, mengedit, dan menghapus semua laporan, ekspor CSV, serta membuat dan menghapus akun. Hanya Admin yang dapat mengelola akun; User hanya dapat melihat dan mengelola laporan miliknya sendiri. Konfirmasi penghapusan laporan dan akun ditampilkan dalam dialog khusus di dalam aplikasi. Gunakan pencarian, filter kelas, pengurutan tanggal, dan halaman arsip untuk menemukan laporan. Ekspor CSV mengikuti pencarian dan filter yang sedang aktif. Gunakan tombol **Edit** pada kartu laporan untuk memperbarui data; lampiran lama tetap tersimpan jika tidak memilih lampiran pengganti.
Lampiran mendukung PDF, JPG/JPEG, PNG, DOC/DOCX, dan XLS/XLSX sampai 10 MB. PDF dan gambar dapat dipratinjau dari riwayat laporan; semua lampiran dapat diunduh kembali. Setiap laporan juga dapat diekspor menjadi file PDF atau gambar JPG/JPEG dari tombol pada kartu laporan.

Data disimpan lokal di folder `data/` dan file lampiran di `uploads/` pada komputer yang menjalankan server. Cadangkan kedua folder tersebut secara berkala. Jangan langsung mempublikasikan aplikasi ke internet tanpa konfigurasi keamanan tambahan. Atur `SESSION_SECRET` yang panjang dan acak sebelum deployment. Untuk produksi, gunakan database dan session store yang persisten.

Akun demo dibuat saat server dimulai jika username-nya belum ada. Password akun yang sudah tersimpan tidak diatur ulang. Ganti password akun demo sebelum digunakan di lingkungan nyata.
