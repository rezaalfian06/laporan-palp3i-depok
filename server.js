
const express = require("express");
const cookieSession = require("cookie-session");
const multer = require("multer");
const bcrypt = require("bcryptjs");
const PDFDocument = require("pdfkit");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { createClient } = require("@supabase/supabase-js");

const app = express();
const PORT = process.env.PORT || 3002;
const HOST = process.env.HOST || "0.0.0.0";
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const loginRateLimits = new Map();
const IS_VERCEL = Boolean(process.env.VERCEL);
const MAX_UPLOAD_BYTES = IS_VERCEL ? 4 * 1024 * 1024 : 10 * 1024 * 1024;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET || "laporan-attachments";
const SESSION_SECRET = process.env.SESSION_SECRET;
const usesSupabase = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
if (IS_VERCEL) app.set("trust proxy", 1);

const missingEnvironmentVariables = [];
if (IS_VERCEL) {
  if (!SUPABASE_URL) missingEnvironmentVariables.push("SUPABASE_URL");
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    missingEnvironmentVariables.push("SUPABASE_SERVICE_ROLE_KEY");
  }
  if (!SESSION_SECRET || SESSION_SECRET.length < 32) {
    missingEnvironmentVariables.push("SESSION_SECRET (minimal 32 karakter)");
  }
  if (!process.env.INITIAL_ADMIN_USERNAME) {
    missingEnvironmentVariables.push("INITIAL_ADMIN_USERNAME");
  }
  if (!process.env.INITIAL_ADMIN_PASSWORD ||
      process.env.INITIAL_ADMIN_PASSWORD.length < 12) {
    missingEnvironmentVariables.push("INITIAL_ADMIN_PASSWORD (minimal 12 karakter)");
  }
}

let supabase = null;
let supabaseClientInitializationError = null;
if (usesSupabase) {
  try {
    supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  } catch (error) {
    supabaseClientInitializationError = error;
  }
}

// =====================================
// KONFIGURASI FOLDER
// =====================================
const DATA_DIR = path.join(__dirname, "data");
const UPLOAD_DIR = path.join(__dirname, "uploads");
const PAGES_DIR = path.join(__dirname, "pages");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const REPORTS_FILE = path.join(DATA_DIR, "reports.json");

if (!usesSupabase && !IS_VERCEL) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// =====================================
// MIDDLEWARE
// =====================================
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

app.use(
  cookieSession({
    name: "connect.sid",
    keys: [SESSION_SECRET || crypto.randomBytes(32).toString("hex")],
    httpOnly: true,
    sameSite: "lax",
    secure: IS_VERCEL || process.env.NODE_ENV === "production",
    maxAge: 8 * 60 * 60 * 1000,
  })
);

// =====================================
// FUNGSI DATA PERSISTEN
// =====================================
function tableForFile(filePath) {
  if (filePath === USERS_FILE) return "users";
  if (filePath === REPORTS_FILE) return "reports";
  throw new Error(`Lokasi data tidak dikenal: ${filePath}`);
}

async function readJSON(filePath, defaultValue = []) {
  if (usesSupabase) {
    const table = tableForFile(filePath);
    const records = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await supabase
        .from(table)
        .select("record")
        .order("id")
        .range(offset, offset + 999);
      if (error) throw error;
      records.push(...data.map((row) => row.record));
      if (data.length < 1000) return records;
    }
  }

  try {
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(
        filePath,
        JSON.stringify(defaultValue, null, 2),
        "utf8"
      );
      return defaultValue;
    }

    const content = fs.readFileSync(filePath, "utf8");

    if (!content.trim()) {
      return defaultValue;
    }

    return JSON.parse(content);
  } catch (error) {
    console.error("Gagal membaca JSON:", filePath, error.message);
    throw error;
  }
}

async function writeJSON(filePath, data) {
  if (usesSupabase) {
    const table = tableForFile(filePath);
    for (let offset = 0; offset < data.length; offset += 500) {
      const records = data.slice(offset, offset + 500).map((record) => ({
        id: String(record.id),
        record,
      }));
      const { error } = await supabase.from(table).upsert(records);
      if (error) throw error;
    }
    return;
  }

  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

async function saveRecord(filePath, record) {
  if (usesSupabase) {
    const { error } = await supabase
      .from(tableForFile(filePath))
      .upsert({ id: String(record.id), record });
    if (error) throw error;
    return;
  }

  const records = await readJSON(filePath, []);
  const index = records.findIndex((item) => String(item.id) === String(record.id));
  if (index < 0) records.push(record);
  else records[index] = record;
  await writeJSON(filePath, records);
}

async function deleteRecord(filePath, id) {
  if (usesSupabase) {
    const { error } = await supabase
      .from(tableForFile(filePath))
      .delete()
      .eq("id", String(id));
    if (error) throw error;
    return;
  }

  const records = await readJSON(filePath, []);
  await writeJSON(
    filePath,
    records.filter((record) => String(record.id) !== String(id))
  );
}

function isRateLimited(bucket, key, limit, windowMs = RATE_LIMIT_WINDOW_MS) {
  const now = Date.now();
  const entries = bucket.get(key) || [];
  const recentEntries = entries.filter((timestamp) => now - timestamp < windowMs);

  if (recentEntries.length >= limit) {
    bucket.set(key, recentEntries);
    return true;
  }

  recentEntries.push(now);
  bucket.set(key, recentEntries);

  if (bucket.size > 10000) {
    for (const [storedKey, timestamps] of bucket) {
      if (!timestamps.some((timestamp) => now - timestamp < windowMs)) {
        bucket.delete(storedKey);
      }
      if (bucket.size <= 8000) break;
    }
  }

  return false;
}

async function isLoginRateLimited(key, limit) {
  if (!usesSupabase) {
    return isRateLimited(loginRateLimits, key, limit);
  }

  const id = crypto.createHash("sha256").update(key).digest("hex");
  const { data, error } = await supabase
    .from("login_limits")
    .select("record")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;

  const now = Date.now();
  const timestamps = (data?.record?.timestamps || []).filter(
    (timestamp) => now - timestamp < RATE_LIMIT_WINDOW_MS
  );
  const limited = timestamps.length >= limit;
  if (!limited) timestamps.push(now);

  const { error: saveError } = await supabase
    .from("login_limits")
    .upsert({ id, record: { timestamps } });
  if (saveError) throw saveError;
  return limited;
}

function regenerateSession(req) {
  req.session = null;
  req.session = {};
}

function normalizeReportRecord(report) {
  const attachment = report.attachment || {
    filename: report.filename || report.originalName || "",
    name: report.originalName || report.filename || "Lampiran",
    size: report.size || 0,
    mimetype: report.mimetype || "",
  };

  const normalized = {
    id: report.id,
    paName: report.paName || report.title || "",
    kelas: report.kelas || "",
    tanggal: report.tanggal || (report.createdAt ? new Date(report.createdAt).toISOString().slice(0, 10) : ""),
    catatan: report.catatan || report.description || "",
    ownerName: report.ownerName || report.uploadedByName || report.uploadedBy || "",
    ownerUsername: report.ownerUsername || report.uploadedBy || "",
    attachment: attachment.filename ? attachment : null,
    createdAt: report.createdAt || null,
    title: report.title || report.paName || "",
    description: report.description || report.catatan || "",
    filename: attachment.filename || null,
    originalName: attachment.name || report.originalName || null,
    size: attachment.size || 0,
    mimetype: attachment.mimetype || null,
  };

  return normalized;
}

// =====================================
// INISIALISASI DATA DAN AKUN DEMO
// =====================================
async function initializeData() {
  if (!usesSupabase) {
    if (!fs.existsSync(USERS_FILE)) {
      await writeJSON(USERS_FILE, []);
    }

    if (!fs.existsSync(REPORTS_FILE)) {
      await writeJSON(REPORTS_FILE, []);
    }
  }

  const users = await readJSON(USERS_FILE, []);
  let shouldBootstrapAdmin = false;
  if (usesSupabase) {
    const { data: bootstrapState, error } = await supabase
      .from("app_settings")
      .select("id")
      .eq("id", "initial_admin_created")
      .maybeSingle();
    if (error) throw error;
    shouldBootstrapAdmin = !bootstrapState;
  }

  const demoAccounts = usesSupabase
    ? shouldBootstrapAdmin
      ? [{
          username: process.env.INITIAL_ADMIN_USERNAME,
          password: process.env.INITIAL_ADMIN_PASSWORD,
          name: process.env.INITIAL_ADMIN_NAME || "Administrator",
          role: "admin",
        }]
      : []
    : [
        {
          username: "admin",
          password: "admin123",
          name: "Administrator",
          role: "admin",
        },
        {
          username: "user",
          password: "user123",
          name: "Pengguna",
          role: "user",
        },
      ];

  if (
    usesSupabase &&
    shouldBootstrapAdmin &&
    (!demoAccounts[0].username ||
      !demoAccounts[0].password ||
      demoAccounts[0].password.length < 12)
  ) {
    throw new Error(
      "Atur INITIAL_ADMIN_USERNAME dan INITIAL_ADMIN_PASSWORD (minimal 12 karakter) di Vercel."
    );
  }

  for (const demo of demoAccounts) {
    const exists = users.some(
      (u) =>
        String(u.username).toLowerCase() ===
        demo.username.toLowerCase()
    );

    if (!exists) {
      const newUser = {
        id: usesSupabase
          ? `bootstrap-${crypto.createHash("sha256").update(demo.username.toLowerCase()).digest("hex")}`
          : Date.now().toString() + Math.random().toString(36).slice(2, 7),
        username: demo.username,
        password: await bcrypt.hash(demo.password, 10),
        name: demo.name,
        role: demo.role,
        createdAt: new Date().toISOString(),
      };
      users.push(newUser);
      if (usesSupabase) await saveRecord(USERS_FILE, newUser);
    }
  }

  if (usesSupabase && shouldBootstrapAdmin) {
    const { error } = await supabase.from("app_settings").upsert({
      id: "initial_admin_created",
      record: { createdAt: new Date().toISOString() },
    });
    if (error) throw error;
  }

  if (!usesSupabase) {
    await writeJSON(USERS_FILE, users);
  }

  console.log("Data aplikasi siap.");
  if (!usesSupabase) {
    console.log("Lokasi users.json:", USERS_FILE);
    console.log("Akun demo lokal: admin / admin123 dan user / user123");
  }
}

let initializationPromise;
function ensureInitialized() {
  if (!initializationPromise) {
    initializationPromise = initializeData().catch((error) => {
      initializationPromise = null;
      throw error;
    });
  }
  return initializationPromise;
}

app.use(async (req, res, next) => {
  if (req.path === "/api/health") return next();

  if (IS_VERCEL && missingEnvironmentVariables.length) {
    return res.status(503).json({
      status: "error",
      check: "configuration",
      message: "Environment variable Production belum lengkap atau tidak valid.",
      missingEnvironmentVariables,
    });
  }

  try {
    await ensureInitialized();
    next();
  } catch (error) {
    console.error("Gagal menyiapkan penyimpanan aplikasi:", error);
    res.status(503).json({
      message: "Penyimpanan aplikasi belum siap. Periksa konfigurasi database dan storage.",
    });
  }
});

// =====================================
// KONFIGURASI UPLOAD
// =====================================
const allowedExtensions = [
  ".png",
  ".jpg",
  ".jpeg",
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_UPLOAD_BYTES,
  },
  fileFilter: function (req, file, callback) {
    const ext = path.extname(file.originalname).toLowerCase();

    if (!allowedExtensions.includes(ext)) {
      return callback(
        new Error(
          "Format file tidak didukung. Gunakan PNG, JPG, PDF, DOC, DOCX, XLS, atau XLSX."
        )
      );
    }

    callback(null, true);
  },
});

function createStoredFilename(originalName) {
  const ext = path.extname(originalName).toLowerCase();
  const safeName = path
    .basename(originalName, ext)
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 80);
  return `${crypto.randomUUID()}-${safeName}${ext}`;
}

async function storeUploadedFile(file) {
  const filename = createStoredFilename(file.originalname);
  if (usesSupabase) {
    const { error } = await supabase.storage
      .from(SUPABASE_BUCKET)
      .upload(filename, file.buffer, {
        contentType: file.mimetype,
        upsert: false,
      });
    if (error) throw error;
  } else {
    fs.writeFileSync(path.join(UPLOAD_DIR, filename), file.buffer);
  }

  return {
    filename,
    name: file.originalname,
    size: file.size,
    mimetype: file.mimetype,
  };
}

async function deleteStoredFile(filename) {
  if (!filename) return;
  if (usesSupabase) {
    const { error } = await supabase.storage.from(SUPABASE_BUCKET).remove([filename]);
    if (error) throw error;
    return;
  }

  const filePath = path.join(UPLOAD_DIR, path.basename(filename));
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

async function readStoredFile(filename) {
  if (usesSupabase) {
    const { data, error } = await supabase.storage
      .from(SUPABASE_BUCKET)
      .download(filename);
    if (error) throw error;
    return Buffer.from(await data.arrayBuffer());
  }

  return fs.readFileSync(path.join(UPLOAD_DIR, path.basename(filename)));
}

// =====================================
// MIDDLEWARE AUTENTIKASI
// =====================================
async function requireLogin(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({
      message: "Silakan login terlebih dahulu.",
    });
  }

  try {
    const users = await readJSON(USERS_FILE, []);
    const activeUser = users.find((user) => String(user.id) === String(req.session.user.id));
    if (!activeUser) {
      req.session = null;
      return res.status(401).json({
        message: "Sesi tidak berlaku. Silakan login kembali.",
      });
    }

    req.session.user = {
      id: activeUser.id,
      username: activeUser.username,
      name: activeUser.name || activeUser.username,
      role: activeUser.role,
    };
    next();
  } catch (error) {
    console.error("Gagal memvalidasi sesi:", error);
    res.status(500).json({
      message: "Gagal memvalidasi sesi pengguna.",
    });
  }
}

function requireAdmin(req, res, next) {
  requireLogin(req, res, () => {
    if (req.session.user.role !== "admin") {
      return res.status(403).json({
        message: "Fitur ini hanya dapat diakses oleh admin.",
      });
    }
    next();
  });
}

app.get("/api/health", async (req, res) => {
  if (missingEnvironmentVariables.length) {
    return res.status(503).json({
      status: "error",
      check: "configuration",
      message: "Environment variable Production belum lengkap atau tidak valid.",
      missingEnvironmentVariables,
    });
  }
  if (supabaseClientInitializationError) {
    console.error("Gagal membuat client Supabase:", supabaseClientInitializationError);
    return res.status(503).json({
      status: "error",
      check: "configuration",
      message: "Client Supabase gagal dibuat. Periksa format URL dan service-role key.",
    });
  }

  try {
    if (usesSupabase) {
      const { error: databaseError } = await supabase
        .from("app_settings")
        .select("id")
        .limit(1);
      if (databaseError) throw databaseError;

      const { error } = await supabase.storage.getBucket(SUPABASE_BUCKET);
      if (error) throw error;
    }

    res.json({
      status: "ok",
      storage: usesSupabase ? "supabase" : "local",
      maxUploadMb: MAX_UPLOAD_BYTES / (1024 * 1024),
    });
  } catch (error) {
    console.error("Pemeriksaan penyimpanan gagal:", error);
    res.status(503).json({
      status: "error",
      check: "database_or_storage",
      message: "Koneksi database atau bucket privat belum siap. Periksa schema dan nama bucket.",
    });
  }
});

// =====================================
// HALAMAN UTAMA
// =====================================
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/admin", (req, res) => {
  if (req.session.user) {
    return res.redirect(req.session.user.role === "admin" ? "/admin/dashboard" : "/user/dashboard");
  }
  res.sendFile(path.join(__dirname, "public", "admin-login.html"));
});

app.get("/user", (req, res) => {
  if (req.session.user) {
    return res.redirect(req.session.user.role === "admin" ? "/admin/dashboard" : "/user/dashboard");
  }
  res.sendFile(path.join(__dirname, "public", "user-login.html"));
});

app.get("/admin/dashboard", (req, res) => {
  if (!req.session.user) {
    return res.redirect("/admin");
  }
  if (req.session.user.role !== "admin") {
    return res.redirect("/user/dashboard");
  }
  res.sendFile(path.join(PAGES_DIR, "admin-dashboard.html"));
});

app.get("/user/dashboard", (req, res) => {
  if (!req.session.user) {
    return res.redirect("/user");
  }
  if (req.session.user.role !== "user") {
    return res.redirect("/admin/dashboard");
  }
  res.sendFile(path.join(PAGES_DIR, "user-dashboard.html"));
});

// =====================================
// LOGIN
// =====================================
app.post("/api/login", async (req, res) => {
  try {
    const username = String(req.body.username || "").trim();
    const password = String(req.body.password || "");
    const role = String(req.body.role || "");
    const clientIp = req.ip || req.socket.remoteAddress || "unknown";

    if (await isLoginRateLimited(clientIp, 10)) {
      return res.status(429).json({
        message: "Terlalu banyak percobaan login. Coba lagi dalam 15 menit.",
      });
    }

    const users = await readJSON(USERS_FILE, []);

    const foundUser = users.find(
      (u) =>
        String(u.username).toLowerCase() === username.toLowerCase()
    );

    if (!foundUser) {
      return res.status(401).json({
        message: "Username atau password tidak valid.",
      });
    }

    let passwordValid = false;
    const storedPassword = String(foundUser.password || "");

    if (storedPassword.startsWith("$2")) {
      passwordValid = await bcrypt.compare(
        password,
        storedPassword
      );
    } else {
      // Kompatibilitas sementara dengan data lama.
      passwordValid = password === storedPassword;
    }

    if (!passwordValid || foundUser.role !== role || !["admin", "user"].includes(foundUser.role)) {
      return res.status(401).json({
        message: "Username, password, atau jenis akun tidak valid.",
      });
    }

    await regenerateSession(req);
    req.session.user = {
      id: foundUser.id,
      username: foundUser.username,
      name: foundUser.name || foundUser.username,
      role: foundUser.role,
    };
    return res.json({
      message: "Login berhasil.",
      user: req.session.user,
    });
  } catch (error) {
    console.error("Kesalahan login:", error);

    res.status(500).json({
      message: "Terjadi kesalahan pada server saat login.",
    });
  }
});

// =====================================
// LOGOUT
// =====================================
app.post("/api/logout", (req, res) => {
  req.session = null;
  res.clearCookie("connect.sid");
  res.clearCookie("connect.sid.sig");
  res.json({
    message: "Logout berhasil.",
  });
});

// =====================================
// CEK USER YANG SEDANG LOGIN
// =====================================
app.get("/api/me", async (req, res) => {
  if (!req.session.user) {
    return res.json({
      user: null,
    });
  }

  try {
    const users = await readJSON(USERS_FILE, []);
    const activeUser = users.find((user) => String(user.id) === String(req.session.user.id));
    if (!activeUser) {
      req.session = null;
      return res.json({ user: null });
    }

    req.session.user = {
      id: activeUser.id,
      username: activeUser.username,
      name: activeUser.name || activeUser.username,
      role: activeUser.role,
    };
    return res.json({ user: req.session.user });
  } catch (error) {
    console.error("Gagal membaca sesi aktif:", error);
    return res.status(500).json({
      message: "Gagal memeriksa sesi pengguna.",
    });
  }
});

// =====================================
// DAFTAR LAPORAN
// =====================================
app.get("/api/reports", requireLogin, async (req, res) => {
  try {
    const storedReports = await readJSON(REPORTS_FILE, []);
    const visibleReports = req.session.user.role === "admin"
      ? storedReports
      : storedReports.filter((report) =>
          (report.ownerUsername || report.uploadedBy) === req.session.user.username
        );
    const reports = visibleReports.map(normalizeReportRecord);
    const payload = reports;
    payload.reports = reports;

    res.json(payload);
  } catch (error) {
    console.error("Gagal membaca daftar laporan:", error);
    res.status(500).json({
      message: "Gagal membaca daftar laporan.",
    });
  }
});

// =====================================
// UPLOAD LAPORAN
// Admin dan user yang login dapat upload.
// =====================================
app.post(
  "/api/reports",
  requireLogin,
  upload.fields([{ name: "file", maxCount: 1 }, { name: "lampiran", maxCount: 1 }]),
  async (req, res) => {
    const uploadedFile = req.files?.file?.[0] || req.files?.lampiran?.[0] || req.file;
    let reportSaved = false;
    let storedAttachment = null;
    try {
      const paName = String(req.body.paName || req.body.title || "").trim();
      const kelas = String(req.body.kelas || "").trim();
      const tanggal = String(req.body.tanggal || "").trim();
      const catatan = String(req.body.catatan || req.body.description || "").trim();

      if (!paName || !kelas || !tanggal || !catatan) {
        return res.status(400).json({
          message: "Semua field wajib diisi, termasuk PA, kelas, tanggal, dan catatan.",
        });
      }

      const reports = await readJSON(REPORTS_FILE, []);
      storedAttachment = uploadedFile ? await storeUploadedFile(uploadedFile) : null;
      const report = {
        id: crypto.randomUUID(),
        paName,
        kelas,
        tanggal,
        catatan,
        ownerName: req.session.user.name,
        ownerUsername: req.session.user.username,
        attachment: storedAttachment,
        title: paName,
        description: catatan,
        originalName: storedAttachment ? storedAttachment.name : "",
        filename: storedAttachment ? storedAttachment.filename : "",
        mimetype: storedAttachment ? storedAttachment.mimetype : "",
        size: storedAttachment ? storedAttachment.size : 0,
        uploadedBy: req.session.user.username,
        uploadedByName: req.session.user.name,
        createdAt: new Date().toISOString(),
      };

      reports.unshift(report);
      if (usesSupabase) await saveRecord(REPORTS_FILE, report);
      else await writeJSON(REPORTS_FILE, reports);
      reportSaved = true;

      res.status(201).json({
        message: "Laporan berhasil diunggah.",
        report: normalizeReportRecord(report),
      });
    } catch (error) {
      console.error("Gagal menyimpan laporan:", error);
      if (!reportSaved && storedAttachment) {
        try {
          await deleteStoredFile(storedAttachment.filename);
        } catch (cleanupError) {
          console.error("Gagal membersihkan lampiran sementara:", cleanupError);
        }
      }

      res.status(500).json({
        message: "Gagal menyimpan data laporan.",
      });
    }
  }
);

app.put(
  "/api/reports/:id",
  requireLogin,
  upload.fields([{ name: "file", maxCount: 1 }, { name: "lampiran", maxCount: 1 }]),
  async (req, res) => {
    const uploadedFile = req.files?.file?.[0] || req.files?.lampiran?.[0] || req.file;
    let reportSaved = false;
    let storedAttachment = null;
    try {
      const reports = await readJSON(REPORTS_FILE, []);
      const report = reports.find((item) => String(item.id) === req.params.id);

      if (!report) {
        return res.status(404).json({
          message: "Laporan tidak ditemukan.",
        });
      }

      if (
        req.session.user.role !== "admin" &&
        (report.ownerUsername || report.uploadedBy) !== req.session.user.username
      ) {
        return res.status(403).json({
          message: "Anda hanya dapat mengubah laporan milik sendiri.",
        });
      }

      const paName = String(req.body.paName || req.body.title || "").trim();
      const kelas = String(req.body.kelas || "").trim();
      const tanggal = String(req.body.tanggal || "").trim();
      const catatan = String(req.body.catatan || req.body.description || "").trim();

      if (!paName || !kelas || !tanggal || !catatan) {
        return res.status(400).json({
          message: "Semua field wajib diisi, termasuk PA, kelas, tanggal, dan catatan.",
        });
      }

      const oldAttachment = report.attachment || {};
      const oldFilename = oldAttachment.filename || report.filename || "";
      storedAttachment = uploadedFile ? await storeUploadedFile(uploadedFile) : null;
      const attachment = storedAttachment
        ? storedAttachment
        : oldFilename
          ? {
              filename: oldFilename,
              name: oldAttachment.name || report.originalName || oldFilename,
              size: oldAttachment.size || report.size || 0,
              mimetype: oldAttachment.mimetype || report.mimetype || "",
            }
          : null;

      Object.assign(report, {
        paName,
        kelas,
        tanggal,
        catatan,
        attachment,
        title: paName,
        description: catatan,
        originalName: attachment ? attachment.name : "",
        filename: attachment ? attachment.filename : "",
        mimetype: attachment ? attachment.mimetype : "",
        size: attachment ? attachment.size : 0,
      });

      if (usesSupabase) await saveRecord(REPORTS_FILE, report);
      else await writeJSON(REPORTS_FILE, reports);
      reportSaved = true;

      let message = "Laporan berhasil diperbarui.";
      if (storedAttachment && oldFilename && oldFilename !== storedAttachment.filename) {
        try {
          await deleteStoredFile(oldFilename);
        } catch (cleanupError) {
          console.error("Gagal menghapus lampiran lama:", cleanupError);
          message = "Laporan diperbarui, tetapi lampiran lama gagal dihapus.";
        }
      }

      res.json({
        message,
        report: normalizeReportRecord(report),
      });
    } catch (error) {
      console.error("Gagal memperbarui laporan:", error);
      if (!reportSaved && storedAttachment) {
        try {
          await deleteStoredFile(storedAttachment.filename);
        } catch (cleanupError) {
          console.error("Gagal membersihkan lampiran sementara:", cleanupError);
        }
      }

      res.status(500).json({
        message: "Gagal memperbarui data laporan.",
      });
    }
  }
);

// =====================================
// DOWNLOAD / LIHAT FILE LAPORAN
// Hanya user yang sudah login.
// =====================================
app.get("/api/reports/:id/file", requireLogin, async (req, res) => {
  try {
    const reports = await readJSON(REPORTS_FILE, []);
    const report = reports.find((r) => r.id === req.params.id);

    if (!report) {
      return res.status(404).json({
        message: "Laporan tidak ditemukan.",
      });
    }

    if (
      req.session.user.role !== "admin" &&
      (report.ownerUsername || report.uploadedBy) !== req.session.user.username
    ) {
      return res.status(403).json({
        message: "Anda tidak memiliki akses ke lampiran laporan ini.",
      });
    }

    const attachment = report.attachment || {};
    const filename = attachment.filename || report.filename || "";
    const originalName = attachment.name || report.originalName || filename;

    if (!filename) {
      return res.status(404).json({
        message: "File laporan tidak ditemukan di server.",
      });
    }

    const file = await readStoredFile(filename);
    res.attachment(originalName);
    res.type(attachment.mimetype || report.mimetype || "application/octet-stream");
    res.send(file);
  } catch (error) {
    console.error("Gagal mengunduh file:", error);

    if (error.code === "ENOENT" || Number(error.statusCode) === 404) {
      return res.status(404).json({
        message: "File laporan tidak ditemukan di penyimpanan.",
      });
    }

    res.status(500).json({
      message: "Gagal mengunduh file.",
    });
  }
});

app.get("/api/reports/:id/preview", requireLogin, async (req, res) => {
  try {
    const reports = await readJSON(REPORTS_FILE, []);
    const report = reports.find((r) => r.id === req.params.id);

    if (!report) {
      return res.status(404).json({
        message: "Laporan tidak ditemukan.",
      });
    }

    if (
      req.session.user.role !== "admin" &&
      (report.ownerUsername || report.uploadedBy) !== req.session.user.username
    ) {
      return res.status(403).json({
        message: "Anda tidak memiliki akses ke lampiran laporan ini.",
      });
    }

    const attachment = report.attachment || {};
    const filename = attachment.filename || report.filename || "";
    const extension = path.extname(filename).toLowerCase();
    const previewTypes = {
      ".pdf": "application/pdf",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".png": "image/png",
    };
    const contentType = previewTypes[extension];

    if (!filename || !contentType) {
      return res.status(404).json({
        message: "Pratinjau file tidak tersedia.",
      });
    }

    const file = await readStoredFile(filename);
    res.set("X-Content-Type-Options", "nosniff");
    res.type(contentType).send(file);
  } catch (error) {
    console.error("Gagal menampilkan pratinjau file:", error);
    if (error.code === "ENOENT" || Number(error.statusCode) === 404) {
      return res.status(404).json({
        message: "Pratinjau file tidak tersedia.",
      });
    }
    res.status(500).json({
      message: "Gagal menampilkan pratinjau file.",
    });
  }
});

app.get("/api/reports/:id/pdf", requireLogin, async (req, res) => {
  try {
    const reports = await readJSON(REPORTS_FILE, []);
    const report = reports.find((item) => item.id === req.params.id);

    if (!report) {
      return res.status(404).json({
        message: "Laporan tidak ditemukan.",
      });
    }

    if (
      req.session.user.role !== "admin" &&
      (report.ownerUsername || report.uploadedBy) !== req.session.user.username
    ) {
      return res.status(403).json({
        message: "Anda tidak memiliki akses ke laporan ini.",
      });
    }

    const normalized = normalizeReportRecord(report);
    const document = new PDFDocument({
      size: "A4",
      margins: { top: 52, bottom: 52, left: 56, right: 56 },
      info: {
        Title: `Laporan PA - ${normalized.paName}`,
        Author: normalized.ownerName,
      },
    });
    const filename = `laporan-pa-${normalized.id}.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    document.pipe(res);

    document.fillColor("#1769aa").fontSize(11).font("Helvetica-Bold")
      .text("LP3I DEPOK  |  LAPORAN PEMBIMBING AKADEMIK");
    document.moveDown(0.7);
    document.fillColor("#102a43").fontSize(22).font("Helvetica-Bold")
      .text("Laporan Pembimbing Akademik");
    document.moveDown(0.2);
    document.fillColor("#64748b").fontSize(10).font("Helvetica")
      .text(`Dibuat pada ${new Date().toLocaleDateString("id-ID")}`);
    document.moveDown(1.2);

    const details = [
      ["Nama Pembimbing Akademik", normalized.paName],
      ["Kelas", normalized.kelas],
      ["Tanggal laporan", normalized.tanggal],
      ["Dibuat oleh", normalized.ownerName],
    ];

    for (const [label, value] of details) {
      document.fillColor("#64748b").fontSize(9).font("Helvetica-Bold").text(label.toUpperCase());
      document.fillColor("#1e293b").fontSize(12).font("Helvetica").text(value || "-");
      document.moveDown(0.65);
    }

    document.moveDown(0.4);
    document.strokeColor("#dbe4ee").moveTo(56, document.y).lineTo(539, document.y).stroke();
    document.moveDown(0.8);
    document.fillColor("#102a43").fontSize(13).font("Helvetica-Bold").text("Catatan laporan");
    document.moveDown(0.35);
    document.fillColor("#334155").fontSize(11).font("Helvetica")
      .text(normalized.catatan || "-", { width: 483, lineGap: 4 });

    if (normalized.attachment) {
      document.moveDown(1);
      document.fillColor("#102a43").fontSize(11).font("Helvetica-Bold").text("Lampiran");
      document.fillColor("#334155").fontSize(10).font("Helvetica")
        .text(`${normalized.attachment.name} (${(normalized.attachment.size / 1024).toFixed(0)} KB)`);
    }

    document.end();
  } catch (error) {
    console.error("Gagal mengekspor laporan PDF:", error);
    if (!res.headersSent) {
      res.status(500).json({
        message: "Gagal membuat file PDF laporan.",
      });
    } else {
      res.destroy(error);
    }
  }
});

// =====================================
// HAPUS LAPORAN
// Admin dapat menghapus semua laporan; user hanya miliknya.
// =====================================
app.delete("/api/reports/:id", requireLogin, async (req, res) => {
  try {
    const reports = await readJSON(REPORTS_FILE, []);
    const report = reports.find((r) => r.id === req.params.id);

    if (!report) {
      return res.status(404).json({
        message: "Laporan tidak ditemukan.",
      });
    }

    if (
      req.session.user.role !== "admin" &&
      (report.ownerUsername || report.uploadedBy) !== req.session.user.username
    ) {
      return res.status(403).json({
        message: "Anda hanya dapat menghapus laporan milik sendiri.",
      });
    }

    if (usesSupabase) await deleteRecord(REPORTS_FILE, report.id);
    else {
      const updatedReports = reports.filter((r) => r.id !== req.params.id);
      await writeJSON(REPORTS_FILE, updatedReports);
    }

    const attachment = report.attachment || {};
    const filename = attachment.filename || report.filename || "";
    if (filename) {
      try {
        await deleteStoredFile(filename);
      } catch (cleanupError) {
        console.error("Laporan dihapus, tetapi lampiran gagal dihapus:", cleanupError);
        return res.json({
          message: "Laporan dihapus, tetapi lampiran gagal dihapus dari penyimpanan.",
        });
      }
    }

    res.json({
      message: "Laporan berhasil dihapus.",
    });
  } catch (error) {
    console.error("Gagal menghapus laporan:", error);

    res.status(500).json({
      message: "Gagal menghapus laporan.",
    });
  }
});

// =====================================
// DAFTAR PENGGUNA
// Hanya admin.
// =====================================
app.get("/api/users", requireAdmin, async (req, res) => {
  try {
    const users = await readJSON(USERS_FILE, []);

    const safeUsers = users.map((u) => ({
      id: u.id,
      username: u.username,
      name: u.name || u.username,
      role: u.role || "user",
      createdAt: u.createdAt || null,
    }));

    const payload = safeUsers;
    payload.users = safeUsers;
    res.json(payload);
  } catch (error) {
    console.error("Gagal membaca daftar pengguna:", error);
    res.status(500).json({
      message: "Gagal membaca daftar pengguna.",
    });
  }
});

// =====================================
// TAMBAH PENGGUNA
// Hanya admin.
// =====================================
app.post("/api/users", requireAdmin, async (req, res) => {
  try {
    const username = String(req.body.username || "").trim();
    const password = String(req.body.password || "");
    const name = String(req.body.name || username).trim();
    const role = String(req.body.role || "user").toLowerCase();

    if (!username || !password) {
      return res.status(400).json({
        message: "Username dan password wajib diisi.",
      });
    }

    if (username.length < 3 || password.length < 6) {
      return res.status(400).json({
        message: "Username minimal 3 karakter dan password minimal 6 karakter.",
      });
    }

    if (!["admin", "user"].includes(role)) {
      return res.status(400).json({
        message: "Role harus admin atau user.",
      });
    }

    const users = await readJSON(USERS_FILE, []);

    const exists = users.some(
      (u) =>
        String(u.username).toLowerCase() === username.toLowerCase()
    );

    if (exists) {
      return res.status(409).json({
        message: "Username sudah digunakan.",
      });
    }

    const newUser = {
      id: crypto.randomUUID(),
      username,
      password: await bcrypt.hash(password, 10),
      name,
      role,
      createdAt: new Date().toISOString(),
    };

    users.push(newUser);
    if (usesSupabase) await saveRecord(USERS_FILE, newUser);
    else await writeJSON(USERS_FILE, users);

    res.status(201).json({
      message: "Pengguna berhasil ditambahkan.",
      user: {
        id: newUser.id,
        username: newUser.username,
        name: newUser.name,
        role: newUser.role,
      },
    });
  } catch (error) {
    console.error("Gagal menambah pengguna:", error);

    res.status(500).json({
      message: "Gagal menambahkan pengguna.",
    });
  }
});

// =====================================
// HAPUS PENGGUNA
// Hanya admin.
// =====================================
app.delete("/api/users/:id", requireAdmin, async (req, res) => {
  try {
    const users = await readJSON(USERS_FILE, []);
    const target = users.find((u) => String(u.id) === req.params.id);

    if (!target) {
      return res.status(404).json({
        message: "Pengguna tidak ditemukan.",
      });
    }

    if (target.username === req.session.user.username) {
      return res.status(400).json({
        message: "Admin tidak dapat menghapus akun yang sedang digunakan.",
      });
    }

    if (usesSupabase) await deleteRecord(USERS_FILE, target.id);
    else {
      const remainingUsers = users.filter((u) => String(u.id) !== req.params.id);
      await writeJSON(USERS_FILE, remainingUsers);
    }

    res.json({
      message: "Pengguna berhasil dihapus.",
    });
  } catch (error) {
    console.error("Gagal menghapus pengguna:", error);

    res.status(500).json({
      message: "Gagal menghapus pengguna.",
    });
  }
});

// =====================================
// ERROR UPLOAD DAN ERROR UMUM
// =====================================
app.use((error, req, res, next) => {
  console.error("Error aplikasi:", error.message);

  if (error instanceof multer.MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({
        message: `Ukuran file maksimal ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB.`,
      });
    }

    return res.status(400).json({
      message: "Upload gagal: " + error.message,
    });
  }

  if (error) {
    return res.status(400).json({
      message: error.message || "Terjadi kesalahan.",
    });
  }

  next();
});

// =====================================
// JALANKAN SERVER
// =====================================
if (require.main === module) {
  const server = app.listen(PORT, HOST, () => {
    console.log("------------------------------------");
    console.log("Laporan PA LP3I Depok berjalan");
    console.log(`Di komputer ini: http://localhost:${PORT}`);
    const networkAddresses = Object.values(os.networkInterfaces())
      .flatMap((addresses) => addresses || [])
      .filter((address) => address.family === "IPv4" && !address.internal)
      .map((address) => `http://${address.address}:${PORT}`);
    if (networkAddresses.length) {
      console.log("Dari perangkat lain di jaringan yang sama:");
      networkAddresses.forEach((address) => console.log(`  ${address}`));
    } else {
      console.log("Alamat IP jaringan lokal tidak ditemukan.");
    }
    console.log("------------------------------------");
  });

  server.on("error", (error) => {
    if (error.code === "EADDRINUSE") {
      console.log(`Port ${PORT} sudah digunakan.`);
      console.log(`Aplikasi mungkin sudah berjalan. Buka: http://localhost:${PORT}`);
      return;
    }

    console.error("Server gagal dijalankan:", error.message);
    process.exitCode = 1;
  });
}

module.exports = app;
