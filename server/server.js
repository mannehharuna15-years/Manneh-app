// Manneh backend proxy
// Keeps your Gemini API key on the server so it's never exposed to users.
//
// Setup:
//   1. npm install
//   2. Copy .env.example to .env and add your GEMINI_API_KEY
//   3. npm start
//
// Deploy this anywhere that runs Node (Render, Railway, Fly.io, a VPS, etc).
// Then point BACKEND_URL in public/index.html at wherever this ends up living.

const express = require("express");
const cors = require("cors");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());

const API_KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

if (!API_KEY) {
  console.error("Missing GEMINI_API_KEY — set it in your .env file.");
  process.exit(1);
}

// Basic in-memory rate limiting per IP (swap for a real store in production)
const requestLog = new Map();
const RATE_LIMIT = 20; // requests
const RATE_WINDOW_MS = 60 * 1000; // per minute

function isRateLimited(ip) {
  const now = Date.now();
  const timestamps = (requestLog.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  timestamps.push(now);
  requestLog.set(ip, timestamps);
  return timestamps.length > RATE_LIMIT;
}

app.post("/api/chat", async (req, res) => {
  const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
  if (isRateLimited(ip)) {
    return res.status(429).json({ error: "Too many requests — slow down a little." });
  }

  const { history } = req.body;
  if (!Array.isArray(history) || history.length === 0) {
    return res.status(400).json({ error: "Missing conversation history." });
  }

  const contents = history.map((m) => ({
    role: m.role === "user" ? "user" : "model",
    parts: [{ text: String(m.text || "").slice(0, 8000) }], // basic length guard
  }));

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents }),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({ error: data?.error?.message || "Gemini request failed." });
    }

    const reply =
      data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") ||
      "(No response text returned.)";

    res.json({ reply });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error contacting Gemini." });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Manneh backend running on port ${PORT}`));
