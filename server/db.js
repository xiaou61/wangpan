const fs = require("fs");
const path = require("path");

const dataDir = path.join(__dirname, "..", "data");
const dbPath = path.join(dataDir, "db.json");
const seedPath = path.join(dataDir, "seed.json");

function ensureDb() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  if (!fs.existsSync(dbPath)) {
    const seed = fs.existsSync(seedPath)
      ? fs.readFileSync(seedPath, "utf8")
      : JSON.stringify({ categories: [], resources: [], visits: [], opens: [], requests: [] }, null, 2);
    fs.writeFileSync(dbPath, seed, "utf8");
  }
}

function normalizeDb(db) {
  return {
    categories: Array.isArray(db.categories) ? db.categories : [],
    resources: Array.isArray(db.resources) ? db.resources : [],
    visits: Array.isArray(db.visits) ? db.visits : [],
    opens: Array.isArray(db.opens) ? db.opens : [],
    requests: Array.isArray(db.requests) ? db.requests : []
  };
}

function readDb() {
  ensureDb();
  const raw = fs.readFileSync(dbPath, "utf8");
  return normalizeDb(JSON.parse(raw));
}

function writeDb(db) {
  ensureDb();
  const normalized = normalizeDb(db);
  const tmpPath = `${dbPath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(normalized, null, 2), "utf8");
  fs.renameSync(tmpPath, dbPath);
  return normalized;
}

function updateDb(mutator) {
  const db = readDb();
  const result = mutator(db);
  writeDb(db);
  return result;
}

module.exports = {
  dbPath,
  readDb,
  updateDb,
  writeDb
};
