const { MongoStore } = require("wwebjs-mongo");
const mongoose = require("mongoose");

const db = async () => {
  let db = null;
  if (db) {
    return { db };
  }

  const dbURI = process.env.MONDO_URI;
  try {
    db = await mongoose.connect(dbURI, { dbName: "sessions" });
    return { db };
  } catch (err) {
    return {
      db,
      error: err,
    };
  }
};

const wwebjsStore = async () => {
  try {
    const response = await db();
    const store = new MongoStore({ mongoose: mongoose });
    return store;
  } catch (err) {
    return { error: err };
  }
};

module.exports = {
  wwebjsStore,
};
