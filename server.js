require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");
const mongoose = require("mongoose");

const Activity = require("./models/Activity");
const Athlete = require("./models/Athlete");

const app = express();
app.use(express.json());
app.use(cors());

const STRAVA_CLIENT_ID = process.env.STRAVA_CLIENT_ID;
const STRAVA_CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET;
const STRAVA_ACTIVITIES_URL = process.env.STRAVA_ACTIVITIES_URL;
const STRAVA_ATHLETE_URL = process.env.STRAVA_ATHLETE_URL;
const STRAVA_AUTH_URL = process.env.STRAVA_AUTH_URL;

mongoose
  .connect(process.env.DATABASE_URL)
  .then(() => console.log("✅ Connected to MongoDB"))
  .catch((err) => console.error("❌ MongoDB connection error:", err));

app.get("/strava/callback", async (req, res) => {
  const { code } = req.query;
  if (!code)
    return res.status(400).json({ error: "Authorization code is missing" });

  console.log(`Redirecting with code: ${code}`);
  res.redirect(`com.adaldosso.runpa://oauthredirect?code=${code}`);
});

app.post("/strava/exchange_token", async (req, res) => {
  const { code } = req.body;
  if (!code)
    return res.status(400).json({ error: "Authorization code is missing" });

  try {
    const qs = new URLSearchParams({
      client_id: STRAVA_CLIENT_ID,
      client_secret: STRAVA_CLIENT_SECRET,
      code,
      grant_type: "authorization_code",
    });

    console.log("🔁 Exchanging token with", qs.toString());

    const response = await axios.post(
      process.env.STRAVA_TOKEN_URL,
      qs.toString(),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    res.json(response.data);
  } catch (error) {
    console.error(
      "❌ Token exchange failed:",
      error.response?.data || error.message
    );
    res
      .status(500)
      .json({
        error: "Failed to exchange token",
        details: error.response?.data,
      });
  }
});

app.post("/strava/refresh_token", async (req, res) => {
  const { refresh_token } = req.body;
  if (!refresh_token)
    return res.status(400).json({ error: "Refresh token is missing" });

  try {
    const response = await axios.post(process.env.STRAVA_TOKEN_URL, {
      client_id: STRAVA_CLIENT_ID,
      client_secret: STRAVA_CLIENT_SECRET,
      refresh_token,
      grant_type: "refresh_token",
    });

    res.json(response.data);
  } catch (error) {
    console.error(
      "❌ Token refresh failed:",
      error.response?.data || error.message
    );
    res
      .status(500)
      .json({
        error: "Failed to refresh token",
        details: error.response?.data,
      });
  }
});

app.get("/strava/activities", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res
      .status(401)
      .json({ error: "Missing or invalid Authorization header" });
  }

  const accessToken = authHeader.split(" ")[1];

  try {
    console.log("📥 Fetching athlete profile...");
    const athleteResponse = await axios.get(STRAVA_ATHLETE_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    await Athlete.updateOne(
      { id: athleteResponse.data.id },
      { $set: athleteResponse.data },
      { upsert: true }
    );

    console.log("📥 Fetching athlete activities...");
    const activitiesResponse = await axios.get(STRAVA_ACTIVITIES_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const activities = activitiesResponse.data;

    for (const activity of activities) {
      await Activity.updateOne(
        { id: activity.id },
        { $set: activity },
        { upsert: true }
      );
    }

    res.json(activities);
  } catch (error) {
    console.error(
      "❌ Failed to fetch activities or athlete data:",
      error.response?.data || error.message
    );
    res.status(500).json({ error: "Failed to fetch data from Strava" });
  }
});

app.get("/strava/web-callback", async (req, res) => {
  const { code } = req.query;
  if (!code)
    return res.status(400).json({ error: "Authorization code is missing" });

  try {
    const qs = new URLSearchParams({
      client_id: STRAVA_CLIENT_ID,
      client_secret: STRAVA_CLIENT_SECRET,
      code,
      grant_type: "authorization_code",
    });

    const response = await axios.post(
      process.env.STRAVA_TOKEN_URL,
      qs.toString(),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    const accessToken = response.data.access_token;
    const redirectUrl = `${process.env.FRONTEND_REDIRECT_URL}?token=${accessToken}`;
    res.redirect(redirectUrl);
  } catch (error) {
    console.error(
      "❌ Web callback error:",
      error.response?.data || error.message
    );
    res.status(500).json({ error: "Failed to exchange token" });
  }
});

app.get("/strava/debug-code", (req, res) => {
  const { code, scope } = req.query;
  if (!code) return res.status(400).send("❌ No code received");

  console.log("✅ Received code:", code);
  res.send(`
    <h1>Code received!</h1>
    <p><strong>code:</strong> ${code}</p>
    <p><strong>scope:</strong> ${scope}</p>
    <p>Use this code in Postman to test <code>/strava/exchange_token</code></p>
  `);
});

app.get("/strava/web-callback-init", (req, res) => {
  const backendUrl = process.env.BACKEND_URL;
  if (!backendUrl)
    return res
      .status(500)
      .send("❌ BACKEND_URL not configured in environment variables");

  const redirectUri = encodeURIComponent(`${backendUrl}/strava/web-callback`);
  const authUrl = `${STRAVA_AUTH_URL}?client_id=${STRAVA_CLIENT_ID}&response_type=code&redirect_uri=${redirectUri}&approval_prompt=auto&scope=read,activity:read`;

  res.redirect(authUrl);
});

app.get("/strava/athletes", async (req, res) => {
  try {
    const athletes = await Athlete.find({}, { _id: 0, __v: 0 });
    const results = [];

    for (const athlete of athletes) {
      const lastActivity = await Activity.findOne(
        {
          "athlete.id": athlete.id,
          start_latlng: { $exists: true, $ne: null },
        },
        {},
        { sort: { start_date: -1 } }
      );

      let last_lat, last_lng;

      if (lastActivity?.start_latlng?.length === 2) {
        [last_lat, last_lng] = lastActivity.start_latlng;
      }

      results.push({
        ...athlete.toObject(),
        last_lat,
        last_lng,
      });
    }

    res.json(results);
  } catch (error) {
    console.error("❌ Failed to fetch athletes with locations:", error.message);
    res.status(500).json({ error: "Failed to fetch athletes with locations" });
  }
});

app.listen(process.env.PORT || 5000, () => {
  console.log(`🚀 Server running on port ${process.env.PORT || 5000}`);
});
