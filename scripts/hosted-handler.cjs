let startup;
module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const url = new URL(req.url, "http://localhost");
  const route = url.searchParams.get("route") || url.pathname.slice(5);
  if (!/^(workspace|auth\/(login|refresh|logout)|actions\/(request|approve|reject|cancel|policy|type))$/.test(route)) {
    res.statusCode = 404;
    return res.end();
  }
  url.searchParams.delete("route");
  req.url = "/api/" + route + url.search;
  let app;
  try {
    process.env.DAYBOOK_SCHEMA_PATH = "db/schema.sql";
    startup ??= require("../server.cjs").createApp().then(async ({ app }) => {
      await app.init();
      return app;
    });
    app = await startup;
  } catch (error) {
    startup = undefined;
    console.error("Daybook initialization failed", error.code || error.name);
    res.statusCode = 503;
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify({ message: "The leave service is unavailable." }));
  }
  return app.getHttpAdapter().getInstance()(req, res);
};
