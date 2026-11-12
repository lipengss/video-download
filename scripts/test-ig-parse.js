const { InstagramEngine } = require("../engine/instagram");
const url = process.argv[2] || "https://www.instagram.com/p/DfiEh7ojQDb/";

const engine = new InstagramEngine();
engine
  .parse(url)
  .then((r) => {
    console.log("engine", r.engine, "items", r.media.length);
    for (const m of r.media) {
      console.log(m.type, m.fileName, m.bestFormatId.slice(0, 80) + "...");
    }
  })
  .catch((e) => {
    console.error("FAIL:", e.message);
    process.exit(1);
  });
