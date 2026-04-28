const fs = require("fs");

function ensureDataFiles(dataDir, registrationsPath, configPath) {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  if (!fs.existsSync(registrationsPath)) {
    fs.writeFileSync(registrationsPath, JSON.stringify({ users: {} }, null, 2));
  }
  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, JSON.stringify({ leaderboardChannelId: null }, null, 2));
  }
}

function readJson(filePath, fallback) {
  try {
    const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!data || typeof data !== "object") {
      return fallback;
    }
    return data;
  } catch (error) {
    return fallback;
  }
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

module.exports = {
  ensureDataFiles,
  readJson,
  writeJson
};
