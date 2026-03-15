import { createServerApp } from "./app.js";

const PORT = Number.parseInt(process.env.PORT ?? "3000", 10);
const { app, ready } = createServerApp();

await ready;
await app.listen({
  port: PORT,
  host: "0.0.0.0"
});
