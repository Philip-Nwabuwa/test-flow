import { loadEnv } from "./env.js";
import { createApp } from "./app.js";

const env = loadEnv();
const { app } = createApp(env);

app.listen(env.API_PORT, () => {
  console.log(`API listening on ${env.API_PORT}`);
});
