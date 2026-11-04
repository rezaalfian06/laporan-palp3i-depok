const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const { createClient } = require("@supabase/supabase-js");

const root = path.join(__dirname, "..");
const dataDirectory = path.join(root, "data");
const uploadDirectory = path.join(root, "uploads");
const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const bucket = process.env.SUPABASE_BUCKET || "laporan-attachments";
const adminUsername = String(process.env.INITIAL_ADMIN_USERNAME || "").trim();
const adminPassword = String(process.env.INITIAL_ADMIN_PASSWORD || "");

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY wajib diatur.");
}
if (!adminUsername || adminPassword.length < 12) {
  throw new Error(
    "Atur INITIAL_ADMIN_USERNAME dan INITIAL_ADMIN_PASSWORD (minimal 12 karakter)."
  );
}

function readData(filename) {
  const filePath = path.join(dataDirectory, filename);
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, "utf8");
  return content.trim() ? JSON.parse(content) : [];
}

async function main() {
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const users = readData("users.json");
  const reports = readData("reports.json");
  const adminIndex = users.findIndex(
    (user) => String(user.username).toLowerCase() === adminUsername.toLowerCase()
  );
  const admin = {
    id: adminIndex >= 0 ? users[adminIndex].id : crypto.randomUUID(),
    username: adminUsername,
    password: await bcrypt.hash(adminPassword, 10),
    name: process.env.INITIAL_ADMIN_NAME || "Administrator",
    role: "admin",
    createdAt: adminIndex >= 0
      ? users[adminIndex].createdAt || new Date().toISOString()
      : new Date().toISOString(),
  };
  if (adminIndex >= 0) users[adminIndex] = admin;
  else users.push(admin);

  for (const user of users) {
    if (user !== admin) {
      const password = String(user.password || "");
      if (!password) {
        throw new Error(`Pengguna ${user.username || "(tanpa username)"} tidak memiliki password.`);
      }
      if (!password.startsWith("$2")) {
        user.password = await bcrypt.hash(password, 10);
      }
    }
  }

  for (const report of reports) {
    const attachment = report.attachment || {};
    const filename = attachment.filename || report.filename || "";
    if (!filename) continue;

    const filePath = path.join(uploadDirectory, path.basename(filename));
    if (!fs.existsSync(filePath)) {
      throw new Error(`File lampiran tidak ditemukan: ${path.basename(filename)}`);
    }

    const { error } = await supabase.storage
      .from(bucket)
      .upload(path.basename(filename), fs.readFileSync(filePath), {
        contentType: attachment.mimetype || report.mimetype || "application/octet-stream",
        upsert: true,
      });
    if (error) throw error;
  }

  const userRows = users.map((record) => ({ id: String(record.id), record }));
  const reportRows = reports.map((record) => ({ id: String(record.id), record }));

  for (let offset = 0; offset < userRows.length; offset += 500) {
    const { error } = await supabase.from("users").upsert(userRows.slice(offset, offset + 500));
    if (error) throw error;
  }
  for (let offset = 0; offset < reportRows.length; offset += 500) {
    const { error } = await supabase.from("reports").upsert(reportRows.slice(offset, offset + 500));
    if (error) throw error;
  }

  const { error: settingsError } = await supabase.from("app_settings").upsert({
    id: "initial_admin_created",
    record: { createdAt: new Date().toISOString() },
  });
  if (settingsError) throw settingsError;

  console.log(`Migrasi selesai: ${userRows.length} pengguna, ${reportRows.length} laporan.`);
}

main().catch((error) => {
  console.error("Migrasi gagal:", error.message);
  process.exitCode = 1;
});
