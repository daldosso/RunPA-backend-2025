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

// Funzione di Reverse Geocoding
async function reverseGeocode(lat, lon) {
  try {
    const response = await axios.get(
      "https://nominatim.openstreetmap.org/reverse",
      {
        params: {
          format: "json",
          lat,
          lon,
          zoom: 10,
          addressdetails: 1,
        },
        headers: {
          "User-Agent": "RunPA-App/1.0",
        },
      }
    );

    const { address } = response.data;

    return {
      city: address.city || address.town || address.village || null,
      state: address.state || null,
      country: address.country || null,
    };
  } catch (error) {
    console.error("❌ Reverse geocoding failed:", error.message);
    return {
      city: null,
      state: null,
      country: null,
    };
  }
}

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
    res.status(500).json({
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
    res.status(500).json({
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
      let location = {
        city: activity.location_city || null,
        state: activity.location_state || null,
        country: activity.location_country || null,
      };

      if (!location.city && activity.start_latlng?.length === 2) {
        const [lat, lon] = activity.start_latlng;
        const reverseLocation = await reverseGeocode(lat, lon);
        location = {
          city: reverseLocation.city,
          state: reverseLocation.state,
          country: reverseLocation.country,
        };
      }

      await Activity.updateOne(
        { id: activity.id },
        {
          $set: {
            ...activity,
            location,
          },
        },
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

const haversineDistance = (coords1, coords2) => {
  const toRad = (value) => (value * Math.PI) / 180;

  const [lat1, lon1] = coords1;
  const [lat2, lon2] = coords2;

  const R = 6371; // Earth radius in km
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

app.get("/strava/farthest-activities", async (req, res) => {
  try {
    const athletes = await Athlete.find({}, { _id: 0, __v: 0 });
    const aronaCoords = [45.7585, 8.5569];

    const results = [];

    for (const athlete of athletes) {
      const activities = await Activity.find(
        { "athlete.id": athlete.id, start_latlng: { $exists: true } },
        {
          id: 1,
          name: 1,
          distance: 1,
          start_latlng: 1,
          start_date: 1,
          location: 1,
        }
      );

      let farthestActivity = null;
      let maxDistance = -1;

      for (const activity of activities) {
        if (
          activity.start_latlng &&
          Array.isArray(activity.start_latlng) &&
          activity.start_latlng.length === 2
        ) {
          const distance = haversineDistance(
            aronaCoords,
            activity.start_latlng
          );

          if (distance > maxDistance) {
            maxDistance = distance;
            farthestActivity = {
              id: activity.id,
              name: activity.name,
              distance: activity.distance,
              start_latlng: activity.start_latlng,
              start_date: activity.start_date,
              distance_from_arona_km: distance,
              location: activity.location || null, // <- qui includiamo location
            };
          }
        }
      }

      results.push({
        athlete: {
          id: athlete.id,
          firstname: athlete.firstname,
          lastname: athlete.lastname,
          profile: athlete.profile || null,
        },
        farthest_activity: farthestActivity,
      });
    }

    res.json(results);
  } catch (error) {
    console.error("❌ Failed to fetch farthest activities:", error.message);
    res
      .status(500)
      .json({ error: "Failed to fetch farthest activities for athletes" });
  }
});

app.listen(process.env.PORT || 5000, () => {
  console.log(`🚀 Server running on port ${process.env.PORT || 5000}`);
});
