let app;
let startupError;

try {
  app = require("../server");
} catch (error) {
  startupError = error;
  console.error("Gagal memuat aplikasi Express:", error);
}

module.exports = function handler(req, res) {
  if (startupError) {
    return res.status(503).json({
      status: "error",
      check: "startup",
      message: "Aplikasi gagal dimuat. Periksa Runtime Logs Vercel.",
    });
  }

  try {
    return app(req, res);
  } catch (error) {
    console.error("Gagal menjalankan aplikasi Express:", error);
    return res.status(500).json({
      status: "error",
      check: "invocation",
      message: "Terjadi kesalahan saat menjalankan aplikasi.",
    });
  }
};
