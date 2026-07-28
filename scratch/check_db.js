const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('c:/Users/user/Documents/GitHub/autostream/database.sqlite');

db.all("SELECT * FROM autolive_series", [], (err, rows) => {
  if (err) console.error(err);
  console.log("--- AUTOLIVE SERIES ---");
  console.log(rows);
});

db.all("SELECT * FROM streams ORDER BY created_at DESC LIMIT 5", [], (err, rows) => {
  if (err) console.error(err);
  console.log("--- STREAMS ---");
  console.log(rows);
  db.close();
});
