require("dotenv").config();

const dns = require("dns");
dns.setDefaultResultOrder("ipv4first");

const http = require("http");
const connectDB = require("./config/db");
const { attach: attachChatSocket } = require("./realtime/chatSocket");
const app = require("./app");

const REQUIRED_ENV = ["MONGO_URI", "JWT_SECRET"];
if (process.env.NODE_ENV === "production") REQUIRED_ENV.push("CLIENT_URL");
const missingEnv = REQUIRED_ENV.filter((key) => !process.env[key]);
if (missingEnv.length) {
  console.error(`Missing required environment variables: ${missingEnv.join(", ")}`);
  process.exit(1);
}

connectDB();

const PORT = process.env.PORT || 5000;

const server = http.createServer(app);
attachChatSocket(server);

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
